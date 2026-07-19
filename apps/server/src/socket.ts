import {
  clientPingSchema,
  type ClientToServerEvents,
  type PlayerId,
  type RoomActionFailure,
  type ServerToClientEvents
} from "@werewolf/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createServiceStatus } from "./app.js";
import type { GameRuntime } from "./runtime.js";
import type { TimedStage } from "./room.js";
import type { GameSocketServer, SocketData, SocketHandlerContext } from "./socket/context.js";
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
  stageTimingOverrides: Partial<Record<TimedStage, { minimumMs: number; maximumMs: number }>> = {}
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

  const handlerContext: SocketHandlerContext = {
    automaticPhaseProgression,
    io,
    runtime,
    clearOfflineTimer,
    clearPhaseTimer,
    emitHostLobbyView,
    emitLobbyViews,
    emitPublicGameState,
    nightActionPaused,
    schedulePhaseTimeout,
    syncPhaseClock
  };

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
