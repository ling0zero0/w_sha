import {
  hostAddBotRequestSchema,
  hostAdjustPhaseTimeRequestSchema,
  hostCorrectPlayerLifeRequestSchema,
  hostMovePlayerRequestSchema,
  hostPlayerRequestSchema,
  hostResolveTakeoverRequestSchema,
  hostUpdateChatModeRequestSchema,
  roleConfigurationSchema
} from "@werewolf/shared";
import { z } from "zod";
import {
  handleHostActionRequest,
  playerLifecycleActionScope,
  type GameSocket,
  type SocketHandlerContext
} from "./context.js";

const emptyActionSchema = z.object({}).strict();

export function registerHostHandlers(socket: GameSocket, context: SocketHandlerContext): void {
  const {
    actionLedger,
    automaticPhaseProgression,
    clearOfflineTimer,
    clearPhaseTimer,
    emitHostLobbyView,
    emitLobbyViews,
    emitPublicGameState,
    io,
    notifyBots,
    runtime,
    schedulePhaseTimeout,
    syncPhaseClock,
    takeoverActionIds
  } = context;

  socket.on("host:refresh-join", (rawPayloadOrAck, maybeAck) => {
    const ack = typeof rawPayloadOrAck === "function" ? rawPayloadOrAck : maybeAck;
    if (typeof ack !== "function") return;
    const rawPayload = typeof rawPayloadOrAck === "function" ? {} : rawPayloadOrAck;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      emptyActionSchema,
      "host:refresh-join",
      actionLedger,
      ack,
      () => ({ ok: true, data: runtime.room.refreshJoinToken() }),
      emitLobbyViews
    );
  });

  socket.on("host:move-player", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      hostMovePlayerRequestSchema,
      "host:move-player",
      actionLedger,
      ack,
      (payload) => runtime.room.movePlayer(payload.playerId, payload.direction),
      emitLobbyViews
    );
  });

  socket.on("host:remove-player", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      hostPlayerRequestSchema,
      "host:remove-player",
      actionLedger,
      ack,
      (payload) => {
        const result = runtime.room.removePlayer(payload.playerId);
        if (!result.ok) return result;
        if (result.data.socketId) {
          io.to(result.data.socketId).emit("player:removed", { message: "你已被主机移出房间" });
          io.sockets.sockets.get(result.data.socketId)?.disconnect(true);
        }
        return { ok: true, data: result.data.view };
      },
      emitLobbyViews
    );
  });

  socket.on("host:depart-player", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      hostPlayerRequestSchema,
      "host:depart-player",
      actionLedger,
      ack,
      (payload) => {
        const result = runtime.departPlayer(payload.playerId);
        if (!result.ok) return result;
        clearOfflineTimer(payload.playerId);
        for (const takeoverSocketId of result.data.takeoverSocketIds) {
          io.to(takeoverSocketId).emit("player:takeover-rejected", {
            message: "该玩家已被主机判定离场，接管申请已取消"
          });
        }
        if (result.data.socketId) {
          io.to(result.data.socketId).emit("player:departed", {
            message: "主机已将你判定为离场"
          });
          io.sockets.sockets.get(result.data.socketId)?.disconnect(true);
        }
        return { ok: true, data: result.data.view };
      },
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("host:correct-player-life", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      hostCorrectPlayerLifeRequestSchema,
      "host:correct-player-life",
      actionLedger,
      ack,
      (payload) => {
        const result = runtime.correctPlayerLife(payload.playerId, payload.alive);
        return result.ok ? { ok: true, data: result.data.view } : result;
      },
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("host:resolve-takeover", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    let resolvedRequestId: string | null = null;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      hostResolveTakeoverRequestSchema,
      "host:resolve-takeover",
      actionLedger,
      ack,
      (payload) => {
        resolvedRequestId = payload.requestId;
        const result = runtime.room.resolveTakeover(payload.requestId, payload.approved);
        if (!result.ok) return result;
        const takeoverActionId = takeoverActionIds.get(payload.requestId);
        if (takeoverActionId) {
          actionLedger.setMetadata(playerLifecycleActionScope, takeoverActionId, {
            kind: "takeover",
            requestId: payload.requestId,
            state: result.data.approved ? "approved" : "rejected",
            session: result.data.session
          });
          takeoverActionIds.delete(payload.requestId);
        }
        const requestSocket = io.sockets.sockets.get(result.data.requestSocketId);
        if (requestSocket?.data.pendingTakeoverRequestId === resolvedRequestId) {
          delete requestSocket.data.pendingTakeoverRequestId;
          delete requestSocket.data.pendingTakeoverActionId;
        }
        if (result.data.approved && result.data.session) {
          const playerId = result.data.session.lobby.selfId;
          clearOfflineTimer(playerId);
          if (requestSocket) {
            requestSocket.data.playerId = playerId;
            requestSocket.join(`player:${playerId}`);
            requestSocket.emit("player:takeover-approved", result.data.session);
            requestSocket.emit("game:public-state", runtime.getPublicGameState());
          }
          if (result.data.replacedSocketId) {
            const replacedSocket = io.sockets.sockets.get(result.data.replacedSocketId);
            replacedSocket?.emit("player:session-replaced", { message: "主机已批准其他设备接管此玩家" });
            replacedSocket?.disconnect(true);
          }
        } else {
          requestSocket?.emit("player:takeover-rejected", { message: "主机拒绝了设备接管申请" });
        }
        return { ok: true, data: result.data.view };
      },
      emitLobbyViews
    );
  });

  socket.on("host:update-role-configuration", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      roleConfigurationSchema,
      "host:update-role-configuration",
      actionLedger,
      ack,
      (payload) => runtime.room.updateRoleConfiguration(payload),
      emitHostLobbyView
    );
  });

  socket.on("host:update-chat-mode", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      hostUpdateChatModeRequestSchema,
      "host:update-chat-mode",
      actionLedger,
      ack,
      (payload) => runtime.room.updateChatMode(payload.chatMode),
      emitLobbyViews
    );
  });

  socket.on("host:add-bot", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      hostAddBotRequestSchema,
      "host:add-bot",
      actionLedger,
      ack,
      (payload) => runtime.room.addBot(payload),
      emitLobbyViews
    );
  });

  socket.on("host:start-game", (rawPayloadOrAck, maybeAck) => {
    const ack = typeof rawPayloadOrAck === "function" ? rawPayloadOrAck : maybeAck;
    if (typeof ack !== "function") return;
    const rawPayload = typeof rawPayloadOrAck === "function" ? {} : rawPayloadOrAck;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      emptyActionSchema,
      "host:start-game",
      actionLedger,
      ack,
      () => runtime.room.startGame(),
      (result) => {
        if (automaticPhaseProgression && result.ok) syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("host:continue-from-dawn", (rawPayloadOrAck, maybeAck) => {
    const ack = typeof rawPayloadOrAck === "function" ? rawPayloadOrAck : maybeAck;
    if (typeof ack !== "function") return;
    const rawPayload = typeof rawPayloadOrAck === "function" ? {} : rawPayloadOrAck;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      emptyActionSchema,
      "host:continue-from-dawn",
      actionLedger,
      ack,
      () => runtime.room.continueFromDawn(),
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("host:continue-from-exile", (rawPayloadOrAck, maybeAck) => {
    const ack = typeof rawPayloadOrAck === "function" ? rawPayloadOrAck : maybeAck;
    if (typeof ack !== "function") return;
    const rawPayload = typeof rawPayloadOrAck === "function" ? {} : rawPayloadOrAck;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      emptyActionSchema,
      "host:continue-from-exile",
      actionLedger,
      ack,
      () => runtime.room.continueFromExile(),
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("host:play-again", (rawPayloadOrAck, maybeAck) => {
    const ack = typeof rawPayloadOrAck === "function" ? rawPayloadOrAck : maybeAck;
    if (typeof ack !== "function") return;
    const rawPayload = typeof rawPayloadOrAck === "function" ? {} : rawPayloadOrAck;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      emptyActionSchema,
      "host:play-again",
      actionLedger,
      ack,
      () => runtime.room.playAgain(),
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("host:return-to-lobby", (rawPayloadOrAck, maybeAck) => {
    const ack = typeof rawPayloadOrAck === "function" ? rawPayloadOrAck : maybeAck;
    if (typeof ack !== "function") return;
    const rawPayload = typeof rawPayloadOrAck === "function" ? {} : rawPayloadOrAck;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      emptyActionSchema,
      "host:return-to-lobby",
      actionLedger,
      ack,
      () => runtime.room.returnToLobby(),
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("host:pause-phase", (rawPayloadOrAck, maybeAck) => {
    const ack = typeof rawPayloadOrAck === "function" ? rawPayloadOrAck : maybeAck;
    if (typeof ack !== "function") return;
    const rawPayload = typeof rawPayloadOrAck === "function" ? {} : rawPayloadOrAck;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      emptyActionSchema,
      "host:pause-phase",
      actionLedger,
      ack,
      () => runtime.pausePhase(),
      () => {
        clearPhaseTimer();
        notifyBots(true);
        emitPublicGameState();
        emitLobbyViews();
      }
    );
  });

  socket.on("host:resume-phase", (rawPayloadOrAck, maybeAck) => {
    const ack = typeof rawPayloadOrAck === "function" ? rawPayloadOrAck : maybeAck;
    if (typeof ack !== "function") return;
    const rawPayload = typeof rawPayloadOrAck === "function" ? {} : rawPayloadOrAck;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      emptyActionSchema,
      "host:resume-phase",
      actionLedger,
      ack,
      () => runtime.resumePhase(),
      () => {
        schedulePhaseTimeout();
        notifyBots(true);
        emitPublicGameState();
        emitLobbyViews();
      }
    );
  });

  socket.on("host:adjust-phase-time", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      hostAdjustPhaseTimeRequestSchema,
      "host:adjust-phase-time",
      actionLedger,
      ack,
      (payload) => runtime.adjustPhaseTime(payload.deltaMs),
      () => {
        schedulePhaseTimeout();
        emitPublicGameState();
      }
    );
  });

  socket.on("host:force-end-phase", (rawPayloadOrAck, maybeAck) => {
    const ack = typeof rawPayloadOrAck === "function" ? rawPayloadOrAck : maybeAck;
    if (typeof ack !== "function") return;
    const rawPayload = typeof rawPayloadOrAck === "function" ? {} : rawPayloadOrAck;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      emptyActionSchema,
      "host:force-end-phase",
      actionLedger,
      ack,
      () => runtime.forceEndPhase(),
      () => {
        clearPhaseTimer();
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("host:skip-night-phase", (rawPayloadOrAck, maybeAck) => {
    const ack = typeof rawPayloadOrAck === "function" ? rawPayloadOrAck : maybeAck;
    if (typeof ack !== "function") return;
    const rawPayload = typeof rawPayloadOrAck === "function" ? {} : rawPayloadOrAck;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      emptyActionSchema,
      "host:skip-night-phase",
      actionLedger,
      ack,
      () => runtime.skipNightPhase(),
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });

  socket.on("host:skip-day-phase", (rawPayloadOrAck, maybeAck) => {
    const ack = typeof rawPayloadOrAck === "function" ? rawPayloadOrAck : maybeAck;
    if (typeof ack !== "function") return;
    const rawPayload = typeof rawPayloadOrAck === "function" ? {} : rawPayloadOrAck;
    handleHostActionRequest(
      socket.data.isHost,
      rawPayload,
      emptyActionSchema,
      "host:skip-day-phase",
      actionLedger,
      ack,
      () => runtime.skipDayPhase(),
      () => {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    );
  });
}
