import {
  chatSendRequestSchema,
  dayConfirmVoteRequestSchema,
  daySelectVoteRequestSchema,
  guardProtectRequestSchema,
  hunterShootRequestSchema,
  joinLobbyRequestSchema,
  reconnectPlayerRequestSchema,
  seerInspectRequestSchema,
  takeoverPlayerRequestSchema,
  witchSubmitActionRequestSchema,
  wolfConfirmVoteRequestSchema,
  wolfSendMessageRequestSchema,
  wolfSelectTargetRequestSchema
} from "@werewolf/shared";
import { z } from "zod";
import {
  alreadyJoined,
  executeIdempotentAction,
  handlePlayerActionRequest,
  invalidRequest,
  parseActionPayload,
  playerLifecycleActionScope,
  type GameSocket,
  type SocketHandlerContext,
  type TakeoverLifecycleMetadata
} from "./context.js";

const emptyActionSchema = z.object({}).strict();

export function registerPlayerHandlers(socket: GameSocket, context: SocketHandlerContext): void {
  const {
    actionLedger,
    clearOfflineTimer,
    emitChatMessage,
    emitLobbyViews,
    emitPublicGameState,
    io,
    nightActionPaused,
    runtime,
    syncPhaseClock,
    takeoverActionIds
  } = context;

  function bindPlayerSocket(playerId: string): void {
    socket.data.playerId = playerId;
    socket.join(`player:${playerId}`);
  }

  function replaceSocket(replacedSocketId: string | null): void {
    if (!replacedSocketId) return;
    const replacedSocket = io.sockets.sockets.get(replacedSocketId);
    replacedSocket?.emit("player:session-replaced", { message: "此玩家已在另一个页面恢复连接" });
    replacedSocket?.disconnect(true);
  }

  function rebindPlayerSession(credentials: Parameters<typeof runtime.room.reconnect>[0]) {
    if (socket.data.pendingTakeoverRequestId) return alreadyJoined();

    const result = runtime.room.reconnect(credentials, socket.id);
    if (!result.ok) return result;

    const playerId = result.data.session.lobby.selfId;
    clearOfflineTimer(playerId);
    bindPlayerSocket(playerId);
    replaceSocket(result.data.replacedSocketId);
    return { ok: true as const, data: result.data.session };
  }

  function emitPlayerSessionState(): void {
    emitLobbyViews();
    socket.emit("game:public-state", runtime.getPublicGameState());
  }

  socket.on("player:join", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    try {
      const action = parseActionPayload(joinLobbyRequestSchema, rawPayload);
      executeIdempotentAction(
        actionLedger,
        playerLifecycleActionScope,
        "player:join",
        action,
        ack,
        () => {
          if (socket.data.playerId || socket.data.pendingTakeoverRequestId) return alreadyJoined();
          const result = runtime.room.join(action.payload, socket.id);
          if (!result.ok) return result;
          bindPlayerSocket(result.data.lobby.selfId);
          return result;
        },
        emitPlayerSessionState,
        (result) => {
          if (!result.ok) return null;
          const rebound = rebindPlayerSession(result.data.credentials);
          return rebound.ok ? null : rebound;
        },
        emitPlayerSessionState
      );
    } catch (error) {
      ack(invalidRequest(error));
    }
  });

  socket.on("player:reconnect", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    try {
      const action = parseActionPayload(reconnectPlayerRequestSchema, rawPayload);
      executeIdempotentAction(
        actionLedger,
        playerLifecycleActionScope,
        "player:reconnect",
        action,
        ack,
        () => {
          if (socket.data.playerId || socket.data.pendingTakeoverRequestId) return alreadyJoined();
          return rebindPlayerSession(action.payload);
        },
        emitPlayerSessionState,
        (result) => {
          if (!result.ok) return null;
          const rebound = rebindPlayerSession(result.data.credentials);
          return rebound.ok ? null : rebound;
        },
        emitPlayerSessionState
      );
    } catch (error) {
      ack(invalidRequest(error));
    }
  });

  socket.on("player:request-takeover", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    try {
      const action = parseActionPayload(takeoverPlayerRequestSchema, rawPayload);
      executeIdempotentAction(
        actionLedger,
        playerLifecycleActionScope,
        "player:request-takeover",
        action,
        ack,
        () => {
          if (socket.data.playerId || socket.data.pendingTakeoverRequestId) return alreadyJoined();
          const result = runtime.room.requestTakeover(action.payload, socket.id);
          if (!result.ok) return result;
          socket.data.pendingTakeoverRequestId = result.data.requestId;
          if (action.actionId) {
            socket.data.pendingTakeoverActionId = action.actionId;
            takeoverActionIds.set(result.data.requestId, action.actionId);
          }
          return result;
        },
        () => {
          syncPhaseClock();
          emitLobbyViews();
          emitPublicGameState();
        },
        (result, metadata) => {
          if (!result.ok) return null;
          const takeoverMetadata = asTakeoverLifecycleMetadata(metadata);
          if (takeoverMetadata?.state === "approved") {
            if (!takeoverMetadata.session) return null;
            if (
              socket.data.pendingTakeoverRequestId
              && socket.data.pendingTakeoverRequestId !== takeoverMetadata.requestId
            ) return alreadyJoined();
            delete socket.data.pendingTakeoverRequestId;
            delete socket.data.pendingTakeoverActionId;
            const rebound = rebindPlayerSession(takeoverMetadata.session.credentials);
            if (!rebound.ok) return rebound;
            socket.emit("player:takeover-approved", takeoverMetadata.session);
            return null;
          }
          if (takeoverMetadata?.state === "rejected") {
            if (socket.data.playerId) return alreadyJoined();
            if (
              socket.data.pendingTakeoverRequestId
              && socket.data.pendingTakeoverRequestId !== takeoverMetadata.requestId
            ) return alreadyJoined();
            delete socket.data.pendingTakeoverRequestId;
            delete socket.data.pendingTakeoverActionId;
            socket.emit("player:takeover-rejected", { message: "主机拒绝了设备接管申请" });
            return null;
          }
          if (socket.data.playerId) return alreadyJoined();
          if (
            socket.data.pendingTakeoverRequestId
            && socket.data.pendingTakeoverRequestId !== result.data.requestId
          ) return alreadyJoined();
          const rebound = runtime.room.reattachTakeoverRequest(
            result.data.requestId,
            action.payload,
            socket.id
          );
          if (!rebound.ok) return rebound;
          socket.data.pendingTakeoverRequestId = result.data.requestId;
          if (action.actionId) socket.data.pendingTakeoverActionId = action.actionId;
          return null;
        },
        () => {
          syncPhaseClock();
          emitLobbyViews();
          emitPublicGameState();
        },
        (result) => result.ok ? {
          kind: "takeover",
          requestId: result.data.requestId,
          state: "pending"
        } satisfies TakeoverLifecycleMetadata : undefined
      );
    } catch (error) {
      ack(invalidRequest(error));
    }
  });

  socket.on("player:confirm-role", (rawPayloadOrAck, maybeAck) => {
    const ack = typeof rawPayloadOrAck === "function" ? rawPayloadOrAck : maybeAck;
    if (typeof ack !== "function") return;
    const rawPayload = typeof rawPayloadOrAck === "function" ? {} : rawPayloadOrAck;
    handlePlayerActionRequest(
      socket.data.playerId,
      rawPayload,
      emptyActionSchema,
      "player:confirm-role",
      actionLedger,
      ack,
      (playerId) => runtime.room.confirmRole(playerId),
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("wolf:select-target", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerActionRequest(
      socket.data.playerId,
      rawPayload,
      wolfSelectTargetRequestSchema,
      "wolf:select-target",
      actionLedger,
      ack,
      (playerId, payload) => {
        const paused = nightActionPaused();
        return paused ?? runtime.room.selectWolfTarget(playerId, payload.target);
      },
      emitLobbyViews
    );
  });

  socket.on("wolf:confirm-vote", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerActionRequest(
      socket.data.playerId,
      rawPayload,
      wolfConfirmVoteRequestSchema,
      "wolf:confirm-vote",
      actionLedger,
      ack,
      (playerId, payload) => {
        const paused = nightActionPaused();
        return paused ?? runtime.room.confirmWolfVote(playerId, payload.confirmed);
      },
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("wolf:send-message", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerActionRequest(
      socket.data.playerId,
      rawPayload,
      wolfSendMessageRequestSchema,
      "wolf:send-message",
      actionLedger,
      ack,
      (playerId, payload) => {
        const paused = nightActionPaused();
        return paused ?? runtime.room.sendWolfMessage(playerId, payload);
      },
      emitLobbyViews
    );
  });

  socket.on("chat:send", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerActionRequest(
      socket.data.playerId,
      rawPayload,
      chatSendRequestSchema,
      "chat:send",
      actionLedger,
      ack,
      (playerId, payload) => {
        const paused = nightActionPaused();
        return paused ?? runtime.room.sendChat(playerId, payload);
      },
      (result) => {
        // The result is replayed without entering this callback, so a retry
        // cannot broadcast a second copy of the same chat message.
        if (result.ok) emitChatMessage(result.data);
      }
    );
  });

  socket.on("seer:inspect", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerActionRequest(
      socket.data.playerId,
      rawPayload,
      seerInspectRequestSchema,
      "seer:inspect",
      actionLedger,
      ack,
      (playerId, payload) => {
        const paused = nightActionPaused();
        return paused ?? runtime.room.inspectAsSeer(playerId, payload.target);
      },
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("witch:submit-action", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerActionRequest(
      socket.data.playerId,
      rawPayload,
      witchSubmitActionRequestSchema,
      "witch:submit-action",
      actionLedger,
      ack,
      (playerId, payload) => {
        const paused = nightActionPaused();
        return paused ?? runtime.room.submitWitchAction(playerId, payload);
      },
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("guard:protect", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerActionRequest(
      socket.data.playerId,
      rawPayload,
      guardProtectRequestSchema,
      "guard:protect",
      actionLedger,
      ack,
      (playerId, payload) => {
        const paused = nightActionPaused();
        return paused ?? runtime.room.protectAsGuard(playerId, payload.target);
      },
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("hunter:shoot", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerActionRequest(
      socket.data.playerId,
      rawPayload,
      hunterShootRequestSchema,
      "hunter:shoot",
      actionLedger,
      ack,
      (playerId, payload) => {
        const paused = nightActionPaused();
        return paused ?? runtime.room.shootAsHunter(playerId, payload.target);
      },
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("player:finish-speaking", (rawPayloadOrAck, maybeAck) => {
    const ack = typeof rawPayloadOrAck === "function" ? rawPayloadOrAck : maybeAck;
    if (typeof ack !== "function") return;
    const rawPayload = typeof rawPayloadOrAck === "function" ? {} : rawPayloadOrAck;
    handlePlayerActionRequest(
      socket.data.playerId,
      rawPayload,
      emptyActionSchema,
      "player:finish-speaking",
      actionLedger,
      ack,
      (playerId) => {
        const paused = nightActionPaused();
        return paused ?? runtime.room.finishSpeaking(playerId);
      },
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("day:select-vote", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerActionRequest(
      socket.data.playerId,
      rawPayload,
      daySelectVoteRequestSchema,
      "day:select-vote",
      actionLedger,
      ack,
      (playerId, payload) => {
        const paused = nightActionPaused();
        return paused ?? runtime.room.selectDayVote(playerId, payload.target);
      },
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("day:confirm-vote", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerActionRequest(
      socket.data.playerId,
      rawPayload,
      dayConfirmVoteRequestSchema,
      "day:confirm-vote",
      actionLedger,
      ack,
      (playerId, payload) => {
        const paused = nightActionPaused();
        return paused ?? runtime.room.confirmDayVote(playerId, payload.confirmed);
      },
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });
}

function asTakeoverLifecycleMetadata(value: unknown): TakeoverLifecycleMetadata | null {
  if (!value || typeof value !== "object") return null;
  const metadata = value as Partial<TakeoverLifecycleMetadata>;
  if (metadata.kind !== "takeover" || typeof metadata.requestId !== "string") return null;
  if (metadata.state !== "pending" && metadata.state !== "approved" && metadata.state !== "rejected") {
    return null;
  }
  return metadata as TakeoverLifecycleMetadata;
}
