import {
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
import {
  handlePlayerViewAction,
  invalidRequest,
  type GameSocket,
  type SocketHandlerContext
} from "./context.js";

export function registerPlayerHandlers(socket: GameSocket, context: SocketHandlerContext): void {
  const {
    clearOfflineTimer,
    emitLobbyViews,
    emitPublicGameState,
    io,
    nightActionPaused,
    runtime,
    syncPhaseClock
  } = context;

  socket.on("player:join", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    try {
      const payload = joinLobbyRequestSchema.parse(rawPayload);
      const result = runtime.room.join(payload, socket.id);
      if (!result.ok) return ack(result);

      socket.data.playerId = result.data.lobby.selfId;
      socket.join(`player:${result.data.lobby.selfId}`);
      ack(result);
      emitLobbyViews();
      socket.emit("game:public-state", runtime.getPublicGameState());
    } catch (error) {
      ack(invalidRequest(error));
    }
  });

  socket.on("player:reconnect", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    try {
      const payload = reconnectPlayerRequestSchema.parse(rawPayload);
      const result = runtime.room.reconnect(payload, socket.id);
      if (!result.ok) return ack(result);

      const playerId = result.data.session.lobby.selfId;
      clearOfflineTimer(playerId);
      socket.data.playerId = playerId;
      socket.join(`player:${playerId}`);

      if (result.data.replacedSocketId) {
        const replacedSocket = io.sockets.sockets.get(result.data.replacedSocketId);
        replacedSocket?.emit("player:session-replaced", { message: "此玩家已在另一个页面恢复连接" });
        replacedSocket?.disconnect(true);
      }

      ack({ ok: true, data: result.data.session });
      emitLobbyViews();
      socket.emit("game:public-state", runtime.getPublicGameState());
    } catch (error) {
      ack(invalidRequest(error));
    }
  });

  socket.on("player:request-takeover", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    try {
      const payload = takeoverPlayerRequestSchema.parse(rawPayload);
      const result = runtime.room.requestTakeover(payload, socket.id);
      ack(result);
      if (result.ok) {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    } catch (error) {
      ack(invalidRequest(error));
    }
  });

  socket.on("player:confirm-role", (ack) => {
    if (typeof ack !== "function") return;
    const playerId = socket.data.playerId;
    if (!playerId) return ack({
      ok: false,
      code: "INVALID_RECONNECT_CREDENTIALS",
      message: "玩家会话无效，请重新连接"
    });
    try {
      const result = runtime.room.confirmRole(playerId);
      ack(result);
      if (result.ok) {
        syncPhaseClock();
        emitLobbyViews();
        emitPublicGameState();
      }
    } catch (error) {
      ack(invalidRequest(error));
    }
  });

  socket.on("wolf:select-target", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerViewAction(socket.data.playerId, ack, () => {
      const paused = nightActionPaused();
      if (paused) return paused;
      const payload = wolfSelectTargetRequestSchema.parse(rawPayload);
      return runtime.room.selectWolfTarget(socket.data.playerId!, payload.target);
    }, emitLobbyViews);
  });

  socket.on("wolf:confirm-vote", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerViewAction(socket.data.playerId, ack, () => {
      const paused = nightActionPaused();
      if (paused) return paused;
      const payload = wolfConfirmVoteRequestSchema.parse(rawPayload);
      return runtime.room.confirmWolfVote(socket.data.playerId!, payload.confirmed);
    }, () => {
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    });
  });

  socket.on("wolf:send-message", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerViewAction(socket.data.playerId, ack, () => {
      const paused = nightActionPaused();
      if (paused) return paused;
      const payload = wolfSendMessageRequestSchema.parse(rawPayload);
      return runtime.room.sendWolfMessage(socket.data.playerId!, payload);
    }, emitLobbyViews);
  });

  socket.on("seer:inspect", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerViewAction(socket.data.playerId, ack, () => {
      const paused = nightActionPaused();
      if (paused) return paused;
      const payload = seerInspectRequestSchema.parse(rawPayload);
      return runtime.room.inspectAsSeer(socket.data.playerId!, payload.target);
    }, () => {
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    });
  });

  socket.on("witch:submit-action", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerViewAction(socket.data.playerId, ack, () => {
      const paused = nightActionPaused();
      if (paused) return paused;
      const payload = witchSubmitActionRequestSchema.parse(rawPayload);
      return runtime.room.submitWitchAction(socket.data.playerId!, payload);
    }, () => {
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    });
  });

  socket.on("guard:protect", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerViewAction(socket.data.playerId, ack, () => {
      const paused = nightActionPaused();
      if (paused) return paused;
      const payload = guardProtectRequestSchema.parse(rawPayload);
      return runtime.room.protectAsGuard(socket.data.playerId!, payload.target);
    }, () => {
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    });
  });

  socket.on("hunter:shoot", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerViewAction(socket.data.playerId, ack, () => {
      const paused = nightActionPaused();
      if (paused) return paused;
      const payload = hunterShootRequestSchema.parse(rawPayload);
      return runtime.room.shootAsHunter(socket.data.playerId!, payload.target);
    }, () => {
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    });
  });

  socket.on("player:finish-speaking", (ack) => {
    if (typeof ack !== "function") return;
    handlePlayerViewAction(socket.data.playerId, ack, () => {
      const paused = nightActionPaused();
      if (paused) return paused;
      return runtime.room.finishSpeaking(socket.data.playerId!);
    }, () => {
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    });
  });

  socket.on("day:select-vote", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerViewAction(socket.data.playerId, ack, () => {
      const paused = nightActionPaused();
      if (paused) return paused;
      const payload = daySelectVoteRequestSchema.parse(rawPayload);
      return runtime.room.selectDayVote(socket.data.playerId!, payload.target);
    }, () => {
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    });
  });

  socket.on("day:confirm-vote", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handlePlayerViewAction(socket.data.playerId, ack, () => {
      const paused = nightActionPaused();
      if (paused) return paused;
      const payload = dayConfirmVoteRequestSchema.parse(rawPayload);
      return runtime.room.confirmDayVote(socket.data.playerId!, payload.confirmed);
    }, () => {
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    });
  });
}
