import type {
  ActionId,
  ChatMessage,
  ClientToServerEvents,
  PlayerId,
  RoomActionAck,
  RoomActionFailure,
  RoomActionResult,
  PlayerSession,
  ServerToClientEvents
} from "@werewolf/shared";
import type { Server, Socket } from "socket.io";
import { actionIdSchema } from "@werewolf/shared";
import { z, ZodError, type ZodType } from "zod";
import type { GameRuntime } from "../runtime.js";
import { ActionLedger, actionFingerprint } from "./action-ledger.js";

export const playerLifecycleActionScope = "player:lifecycle";

export interface TakeoverLifecycleMetadata {
  kind: "takeover";
  requestId: string;
  state: "pending" | "approved" | "rejected";
  session?: PlayerSession | null;
}

export interface SocketData {
  isHost: boolean;
  pendingTakeoverActionId?: ActionId;
  playerId?: PlayerId;
  pendingTakeoverRequestId?: string;
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
  actionLedger: ActionLedger;
  io: GameSocketServer;
  runtime: GameRuntime;
  takeoverActionIds: Map<string, ActionId>;
  clearOfflineTimer: (playerId: PlayerId) => void;
  clearPhaseTimer: () => void;
  emitHostLobbyView: () => void;
  emitChatMessage: (message: ChatMessage) => void;
  emitLobbyViews: () => void;
  emitPublicGameState: () => void;
  nightActionPaused: () => RoomActionFailure | null;
  notifyBots: (force?: boolean) => void;
  schedulePhaseTimeout: () => void;
  syncPhaseClock: () => void;
}

export interface ParsedAction<T> {
  actionId: ActionId | null;
  payload: T;
}

const actionEnvelopeSchema = z.object({
  actionId: actionIdSchema
}).passthrough();

export function parseActionPayload<T>(schema: ZodType<T>, rawPayload: unknown): ParsedAction<T> {
  if (isObject(rawPayload) && "actionId" in rawPayload) {
    const envelope = actionEnvelopeSchema.parse(rawPayload);
    const { actionId, ...payload } = envelope;
    return { actionId, payload: schema.parse(payload) };
  }
  return { actionId: null, payload: schema.parse(rawPayload) };
}

export function executeIdempotentAction<T>(
  ledger: ActionLedger,
  scope: string,
  event: string,
  action: ParsedAction<unknown>,
  ack: RoomActionAck<T>,
  execute: () => RoomActionResult<T>,
  afterSuccess: (result: RoomActionResult<T>) => void,
  onReplay?: (result: RoomActionResult<T>, metadata: unknown) => RoomActionFailure | null,
  afterReplay?: (result: RoomActionResult<T>) => void,
  metadata?: (result: RoomActionResult<T>) => unknown
): void {
  const fingerprint = action.actionId ? actionFingerprint(action.payload) : null;
  if (action.actionId && fingerprint) {
    const lookup = ledger.lookup(scope, event, action.actionId, fingerprint);
    if (lookup.kind === "conflict") return ack(invalidActionIdConflict());
    if (lookup.kind === "replay") {
      const replayResult = lookup.result as RoomActionResult<T>;
      const replayFailure = onReplay?.(replayResult, lookup.metadata) ?? null;
      if (replayFailure) return ack(replayFailure);
      ack(replayResult);
      if (replayResult.ok) afterReplay?.(replayResult);
      return;
    }
  }

  try {
    const result = execute();
    if (action.actionId && fingerprint) {
      ledger.record(scope, event, action.actionId, fingerprint, result, metadata?.(result));
    }
    ack(result);
    if (result.ok) afterSuccess(result);
  } catch (error) {
    ack(invalidRequest(error));
  }
}

export function handleHostActionRequest<T, P>(
  isHost: boolean,
  rawPayload: unknown,
  schema: ZodType<P>,
  event: string,
  ledger: ActionLedger,
  ack: RoomActionAck<T>,
  action: (payload: P) => RoomActionResult<T>,
  afterSuccess: (result: RoomActionResult<T>) => void
): void {
  if (!isHost) return ack(invalidHostSession());
  try {
    const parsed = parseActionPayload(schema, rawPayload);
    executeIdempotentAction(ledger, "host", event, parsed, ack, () => action(parsed.payload), afterSuccess);
  } catch (error) {
    ack(invalidRequest(error));
  }
}

export function handlePlayerActionRequest<T, P>(
  playerId: PlayerId | undefined,
  rawPayload: unknown,
  schema: ZodType<P>,
  event: string,
  ledger: ActionLedger,
  ack: RoomActionAck<T>,
  action: (playerId: PlayerId, payload: P) => RoomActionResult<T>,
  afterSuccess: (result: RoomActionResult<T>) => void
): void {
  if (!playerId) return ack({
    ok: false,
    code: "INVALID_RECONNECT_CREDENTIALS",
    message: "玩家会话无效，请重新连接"
  });
  try {
    const parsed = parseActionPayload(schema, rawPayload);
    executeIdempotentAction(
      ledger,
      `player:${playerId}`,
      event,
      parsed,
      ack,
      () => action(playerId, parsed.payload),
      afterSuccess
    );
  } catch (error) {
    ack(invalidRequest(error));
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function invalidActionIdConflict(): RoomActionFailure {
  return {
    ok: false,
    code: "ACTION_ID_CONFLICT",
    message: "actionId 已被用于另一项操作"
  };
}

export function alreadyJoined(): RoomActionFailure {
  return {
    ok: false,
    code: "ALREADY_JOINED",
    message: "此连接已经绑定玩家或正在申请接管"
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
