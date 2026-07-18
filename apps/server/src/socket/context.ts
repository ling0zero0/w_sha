import type {
  ClientToServerEvents,
  PlayerId,
  RoomActionAck,
  RoomActionFailure,
  ServerToClientEvents
} from "@werewolf/shared";
import type { Server, Socket } from "socket.io";
import { ZodError } from "zod";
import type { GameRuntime } from "../runtime.js";

export interface SocketData {
  isHost: boolean;
  playerId?: PlayerId;
}

export type GameSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export interface SocketHandlerContext {
  automaticPhaseProgression: boolean;
  io: GameSocketServer;
  runtime: GameRuntime;
  clearOfflineTimer: (playerId: PlayerId) => void;
  clearPhaseTimer: () => void;
  emitHostLobbyView: () => void;
  emitLobbyViews: () => void;
  emitPublicGameState: () => void;
  nightActionPaused: () => RoomActionFailure | null;
  schedulePhaseTimeout: () => void;
  syncPhaseClock: () => void;
}

export function invalidRequest(error: unknown): RoomActionFailure {
  return {
    ok: false,
    code: "INVALID_REQUEST",
    message: error instanceof ZodError ? "请求数据无效" : "操作失败"
  };
}

export function invalidHostSession(): RoomActionFailure {
  return {
    ok: false,
    code: "INVALID_HOST_SESSION",
    message: "主机控制会话无效"
  };
}

export function handleHostAction<T>(
  isHost: boolean,
  ack: RoomActionAck<T>,
  action: () => { ok: true; data: T } | RoomActionFailure,
  afterSuccess: () => void
): void {
  if (!isHost) return ack(invalidHostSession());
  try {
    const result = action();
    ack(result);
    if (result.ok) afterSuccess();
  } catch (error) {
    ack(invalidRequest(error));
  }
}

export function handlePlayerViewAction<T>(
  playerId: PlayerId | undefined,
  ack: RoomActionAck<T>,
  action: () => { ok: true; data: T } | RoomActionFailure,
  afterSuccess: () => void
): void {
  if (!playerId) return ack({
    ok: false,
    code: "INVALID_RECONNECT_CREDENTIALS",
    message: "玩家会话无效，请重新连接"
  });
  try {
    const result = action();
    ack(result);
    if (result.ok) afterSuccess();
  } catch (error) {
    ack(invalidRequest(error));
  }
}
