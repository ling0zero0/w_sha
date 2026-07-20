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
import {
  handleHostAction,
  invalidHostSession,
  invalidRequest,
  type GameSocket,
  type SocketHandlerContext
} from "./context.js";

export function registerHostHandlers(socket: GameSocket, context: SocketHandlerContext): void {
  const {
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
    syncPhaseClock
  } = context;

  socket.on("host:refresh-join", (ack) => {
    if (typeof ack !== "function") return;
    if (!socket.data.isHost) return ack(invalidHostSession());
    const view = runtime.room.refreshJoinToken();
    ack({ ok: true, data: view });
    emitLobbyViews();
  });

  socket.on("host:move-player", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handleHostAction(socket.data.isHost, ack, () => {
      const payload = hostMovePlayerRequestSchema.parse(rawPayload);
      return runtime.room.movePlayer(payload.playerId, payload.direction);
    }, emitLobbyViews);
  });

  socket.on("host:remove-player", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    if (!socket.data.isHost) return ack(invalidHostSession());
    try {
      const payload = hostPlayerRequestSchema.parse(rawPayload);
      const result = runtime.room.removePlayer(payload.playerId);
      if (!result.ok) return ack(result);

      if (result.data.socketId) {
        io.to(result.data.socketId).emit("player:removed", { message: "你已被主机移出房间" });
        io.sockets.sockets.get(result.data.socketId)?.disconnect(true);
      }
      ack({ ok: true, data: result.data.view });
      emitLobbyViews();
    } catch (error) {
      ack(invalidRequest(error));
    }
  });

  socket.on("host:depart-player", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    if (!socket.data.isHost) return ack(invalidHostSession());
    try {
      const payload = hostPlayerRequestSchema.parse(rawPayload);
      const result = runtime.departPlayer(payload.playerId);
      if (!result.ok) return ack(result);

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

      ack({ ok: true, data: result.data.view });
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    } catch (error) {
      ack(invalidRequest(error));
    }
  });

  socket.on("host:correct-player-life", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    if (!socket.data.isHost) return ack(invalidHostSession());
    try {
      const payload = hostCorrectPlayerLifeRequestSchema.parse(rawPayload);
      const result = runtime.correctPlayerLife(payload.playerId, payload.alive);
      if (!result.ok) return ack(result);
      ack({ ok: true, data: result.data.view });
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    } catch (error) {
      ack(invalidRequest(error));
    }
  });

  socket.on("host:resolve-takeover", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    if (!socket.data.isHost) return ack(invalidHostSession());
    try {
      const payload = hostResolveTakeoverRequestSchema.parse(rawPayload);
      const result = runtime.room.resolveTakeover(payload.requestId, payload.approved);
      if (!result.ok) return ack(result);

      const requestSocket = io.sockets.sockets.get(result.data.requestSocketId);
      if (requestSocket?.data.pendingTakeoverRequestId === payload.requestId) {
        delete requestSocket.data.pendingTakeoverRequestId;
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

      ack({ ok: true, data: result.data.view });
      emitLobbyViews();
    } catch (error) {
      ack(invalidRequest(error));
    }
  });

  socket.on("host:update-role-configuration", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handleHostAction(socket.data.isHost, ack, () => {
      const payload = roleConfigurationSchema.parse(rawPayload);
      return runtime.room.updateRoleConfiguration(payload);
    }, emitHostLobbyView);
  });

  socket.on("host:update-chat-mode", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handleHostAction(socket.data.isHost, ack, () => {
      const payload = hostUpdateChatModeRequestSchema.parse(rawPayload);
      return runtime.room.updateChatMode(payload.chatMode);
    }, emitLobbyViews);
  });

  socket.on("host:add-bot", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handleHostAction(socket.data.isHost, ack, () => {
      const payload = hostAddBotRequestSchema.parse(rawPayload);
      return runtime.room.addBot(payload);
    }, emitLobbyViews);
  });

  socket.on("host:start-game", (ack) => {
    if (typeof ack !== "function") return;
    handleHostAction(socket.data.isHost, ack, () => runtime.room.startGame(), () => {
      if (automaticPhaseProgression) syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    });
  });

  socket.on("host:continue-from-dawn", (ack) => {
    if (typeof ack !== "function") return;
    handleHostAction(socket.data.isHost, ack, () => runtime.room.continueFromDawn(), () => {
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    });
  });

  socket.on("host:continue-from-exile", (ack) => {
    if (typeof ack !== "function") return;
    handleHostAction(socket.data.isHost, ack, () => runtime.room.continueFromExile(), () => {
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    });
  });

  socket.on("host:play-again", (ack) => {
    if (typeof ack !== "function") return;
    handleHostAction(socket.data.isHost, ack, () => runtime.room.playAgain(), () => {
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    });
  });

  socket.on("host:return-to-lobby", (ack) => {
    if (typeof ack !== "function") return;
    handleHostAction(socket.data.isHost, ack, () => runtime.room.returnToLobby(), () => {
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    });
  });

  socket.on("host:pause-phase", (ack) => {
    if (typeof ack !== "function") return;
    handleHostAction(socket.data.isHost, ack, () => runtime.pausePhase(), () => {
      clearPhaseTimer();
      notifyBots(true);
      emitPublicGameState();
      emitLobbyViews();
    });
  });

  socket.on("host:resume-phase", (ack) => {
    if (typeof ack !== "function") return;
    handleHostAction(socket.data.isHost, ack, () => runtime.resumePhase(), () => {
      schedulePhaseTimeout();
      notifyBots(true);
      emitPublicGameState();
      emitLobbyViews();
    });
  });

  socket.on("host:adjust-phase-time", (rawPayload, ack) => {
    if (typeof ack !== "function") return;
    handleHostAction(socket.data.isHost, ack, () => {
      const payload = hostAdjustPhaseTimeRequestSchema.parse(rawPayload);
      return runtime.adjustPhaseTime(payload.deltaMs);
    }, () => {
      schedulePhaseTimeout();
      emitPublicGameState();
    });
  });

  socket.on("host:force-end-phase", (ack) => {
    if (typeof ack !== "function") return;
    handleHostAction(socket.data.isHost, ack, () => runtime.forceEndPhase(), () => {
      clearPhaseTimer();
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    });
  });

  socket.on("host:skip-night-phase", (ack) => {
    if (typeof ack !== "function") return;
    handleHostAction(socket.data.isHost, ack, () => runtime.skipNightPhase(), () => {
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    });
  });

  socket.on("host:skip-day-phase", (ack) => {
    if (typeof ack !== "function") return;
    handleHostAction(socket.data.isHost, ack, () => runtime.skipDayPhase(), () => {
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    });
  });
}
