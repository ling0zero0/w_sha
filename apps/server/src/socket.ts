import {
  chatHistoryRequestSchema,
  clientPingSchema,
  type ChatMessage,
  type ClientToServerEvents,
  type PlayerId,
  type RoomActionFailure,
  type ServerToClientEvents
} from "@werewolf/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createServiceStatus } from "./app.js";
import { executeBotIntent } from "./bot-executor.js";
import { BotManager } from "./bot-manager.js";
import type { GameRuntime } from "./runtime.js";
import type { AiConfigStore } from "./ai/ai-config-store.js";
import type { ProviderRegistry } from "./ai/provider-registry.js";
import { LlmBotAdapter } from "./ai/llm-bot-adapter.js";
import { DeterministicBotAdapter } from "./bot-manager.js";
import type { TimedStage } from "./room.js";
import {
  invalidRequest,
  type GameSocketServer,
  type SocketData,
  type SocketHandlerContext
} from "./socket/context.js";
import { registerHostHandlers } from "./socket/host-handlers.js";
import { registerPlayerHandlers } from "./socket/player-handlers.js";

const reconnectGraceMs = 15_000;

const stageTiming: Record<TimedStage, { minimumMs: number; maximumMs: number }> = {
  "role-reveal": { minimumMs: 5_000, maximumMs: 120_000 },
  wolf: { minimumMs: 10_000, maximumMs: 90_000 },
  seer: { minimumMs: 5_000, maximumMs: 30_000 },
  guard: { minimumMs: 5_000, maximumMs: 30_000 },
  witch: { minimumMs: 5_000, maximumMs: 30_000 },
  hunter: { minimumMs: 5_000, maximumMs: 30_000 },
  dawn: { minimumMs: 8_000, maximumMs: 8_000 },
  "last-words": { minimumMs: 10_000, maximumMs: 60_000 },
  "day-speech": { minimumMs: 10_000, maximumMs: 60_000 },
  "day-vote": { minimumMs: 8_000, maximumMs: 30_000 },
  "exile-result": { minimumMs: 8_000, maximumMs: 8_000 }
};

export function attachSocketServer(
  server: HttpServer,
  logger: FastifyBaseLogger,
  runtime: GameRuntime,
  persistSnapshot: () => void = () => undefined,
  automaticPhaseProgression = false,
  stageTimingOverrides: Partial<Record<TimedStage, { minimumMs: number; maximumMs: number }>> = {},
  aiServices?: { store: AiConfigStore; providers: ProviderRegistry }
) {
  if (automaticPhaseProgression) runtime.room.enableDeferredStageAdvancement();
  const activeStageTiming = { ...stageTiming, ...stageTimingOverrides };
  const io: GameSocketServer = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(server, {
    cors: { origin: true, credentials: false }
  });
  const offlineTimers = new Map<PlayerId, NodeJS.Timeout>();
  let botManager: BotManager | null = null;
  let phaseTimer: NodeJS.Timeout | null = null;
  let scheduledStageKey: string | null = runtime.isPhasePaused() ? runtime.room.getTimedStageKey() : null;

  function clearPhaseTimer(): void {
    if (phaseTimer) clearTimeout(phaseTimer);
    phaseTimer = null;
  }

  function schedulePhaseTimeout(): void {
    clearPhaseTimer();
    const stage = runtime.room.getTimedStage();
    const stageKey = runtime.room.getTimedStageKey();
    const clock = runtime.phaseClock.view();
    if (!stage || !stageKey || clock.status !== "running") return;
    const timing = activeStageTiming[stage];
    const minimumRemainingThreshold = timing.maximumMs - timing.minimumMs;
    const completed = runtime.room.isTimedStageComplete();
    const delayMs = completed
      ? Math.max(0, clock.remainingMs - minimumRemainingThreshold)
      : clock.remainingMs;
    phaseTimer = setTimeout(() => {
      phaseTimer = null;
      if (runtime.room.getTimedStageKey() !== stageKey) return;
      const currentClock = runtime.phaseClock.view();
      const minimumReached = currentClock.remainingMs <= minimumRemainingThreshold;
      if (runtime.room.isTimedStageComplete() && minimumReached) {
        runtime.room.advanceCompletedTimedStage();
      } else if (currentClock.remainingMs === 0) {
        runtime.room.skipCurrentTimedStage();
      } else {
        schedulePhaseTimeout();
        return;
      }
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
    }, delayMs);
    phaseTimer.unref();
  }

  function syncPhaseClock(): void {
    const stage = runtime.room.getTimedStage();
    const stageKey = runtime.room.getTimedStageKey();
    if (!stage || !stageKey) {
      scheduledStageKey = null;
      clearPhaseTimer();
      if (runtime.phaseClock.view().status !== "idle") runtime.phaseClock.forceEnd();
      return;
    }
    if (stageKey !== scheduledStageKey) {
      scheduledStageKey = stageKey;
      runtime.phaseClock.start(activeStageTiming[stage].maximumMs);
    }
    schedulePhaseTimeout();
  }

  function nightActionPaused(): RoomActionFailure | null {
    return runtime.isPhasePaused() ? {
      ok: false,
      code: "INVALID_PHASE_CONTROL",
      message: "当前阶段已暂停，暂时不能操作"
    } : null;
  }

  function clearOfflineTimer(playerId: PlayerId): void {
    const timer = offlineTimers.get(playerId);
    if (timer) clearTimeout(timer);
    offlineTimers.delete(playerId);
  }

  function emitLobbyViews(): void {
    persistSnapshot();
    emitHostLobbyView();
    for (const playerId of runtime.room.getPlayerIds()) {
      const view = runtime.room.getPlayerView(playerId);
      if (view) io.to(`player:${playerId}`).emit("player:state", view);
    }
    botManager?.notify();
  }

  function emitHostLobbyView(): void {
    persistSnapshot();
    io.to("host").emit("host:state", runtime.room.getHostView());
  }

  function emitPublicGameState(): void {
    persistSnapshot();
    const state = runtime.getPublicGameState();
    io.to("host").emit("game:public-state", state);
    for (const playerId of runtime.room.getPlayerIds()) {
      io.to(`player:${playerId}`).emit("game:public-state", state);
    }
  }

  function emitChatMessage(message: ChatMessage): void {
    persistSnapshot();
    if (message.channel === "day-public" || message.channel === "system") {
      io.to("host").emit("chat:message", message);
    }
    for (const playerId of runtime.room.getChatRecipientIds(message.channel)) {
      io.to(`player:${playerId}`).emit("chat:message", message);
    }
    botManager?.notify();
  }

  const handlerContext: SocketHandlerContext = {
    automaticPhaseProgression,
    io,
    runtime,
    clearOfflineTimer,
    clearPhaseTimer,
    emitChatMessage,
    emitHostLobbyView,
    emitLobbyViews,
    emitPublicGameState,
    nightActionPaused,
    notifyBots: (force = false) => botManager?.notify(force),
    schedulePhaseTimeout,
    syncPhaseClock
  };

  botManager = new BotManager({
    room: runtime.room,
    execute: (playerId, intent, expectedRevision) => {
      const result = executeBotIntent(
        runtime.room,
        playerId,
        intent,
        expectedRevision,
        runtime.isPhasePaused()
      );
      if (!result.accepted) return false;
      if (result.chatMessage) emitChatMessage(result.chatMessage);
      syncPhaseClock();
      emitLobbyViews();
      emitPublicGameState();
      return true;
    },
    adapterFactory: (kind, playerId, botProfileId) => {
      if (kind !== "llm" || !botProfileId || !aiServices) {
        return new DeterministicBotAdapter(kind);
      }
      return new LlmBotAdapter({
        playerId,
        botProfileId,
        gameId: () => runtime.room.getGameSessionId() ?? runtime.room.roomCode,
        store: aiServices.store,
        providers: aiServices.providers,
        onFallback: (reason, modelErrorCode) => logger.warn(
          { playerId, reason, modelErrorCode },
          "LLM bot used deterministic fallback"
        )
      });
    },
    onError: (error, playerId) => {
      logger.warn({ error, playerId }, "bot decision failed");
    }
  });
  botManager.notify();
  server.once("close", () => {
    void botManager?.dispose();
  });

  io.on("connection", (socket) => {
    socket.data.isHost = socket.handshake.auth.hostSession === runtime.hostSession;
    if (socket.data.isHost) socket.join("host");

    logger.info({ socketId: socket.id, isHost: socket.data.isHost }, "socket connected");
    socket.emit("system:ready", createServiceStatus());
    if (socket.data.isHost) {
      socket.emit("host:state", runtime.room.getHostView());
      socket.emit("game:public-state", runtime.getPublicGameState());
    }

    socket.on("system:ping", (rawPayload) => {
      const result = clientPingSchema.safeParse(rawPayload);
      if (!result.success) {
        logger.warn({ socketId: socket.id }, "invalid socket ping ignored");
        return;
      }
      socket.emit("system:pong", { sentAt: result.data.sentAt, receivedAt: Date.now() });
    });

    socket.on("chat:history", (rawPayload, ack) => {
      if (typeof ack !== "function") return;
      try {
        const payload = chatHistoryRequestSchema.parse(rawPayload);
        const reader = socket.data.isHost
          ? { kind: "host" as const }
          : socket.data.playerId
            ? { kind: "player" as const, playerId: socket.data.playerId }
            : null;
        if (!reader) {
          return ack({
            ok: false,
            code: "INVALID_RECONNECT_CREDENTIALS",
            message: "玩家会话无效，请重新连接"
          });
        }
        ack(runtime.room.getChatHistory(reader, payload.afterSequence, payload.limit));
      } catch (error) {
        ack(invalidRequest(error));
      }
    });

    registerPlayerHandlers(socket, handlerContext);
    registerHostHandlers(socket, handlerContext);

    socket.on("disconnect", (reason) => {
      const changedPlayer = runtime.room.setReconnecting(socket.id);
      const removedTakeoverRequest = runtime.room.cancelTakeoverRequests(socket.id);
      if (changedPlayer) {
        emitLobbyViews();
        clearOfflineTimer(changedPlayer);
        const timer = setTimeout(() => {
          offlineTimers.delete(changedPlayer);
          if (runtime.room.setOffline(changedPlayer, socket.id)) {
            if (runtime.room.isCurrentSpeaker(changedPlayer)) {
              runtime.room.skipCurrentDayStage();
              syncPhaseClock();
              emitPublicGameState();
            }
            emitLobbyViews();
          }
        }, reconnectGraceMs);
        timer.unref();
        offlineTimers.set(changedPlayer, timer);
      }
      if (!changedPlayer && removedTakeoverRequest) emitLobbyViews();
      logger.info({ socketId: socket.id, reason }, "socket disconnected");
    });
  });

  return io;
}
