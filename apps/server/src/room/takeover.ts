import { findPlayer } from "./state.js";
import { roomFailures as failures } from "../room-failures.js";
import { createReconnectToken, hashReconnectToken } from "./tokens.js";
import { createSession, getHostView } from "./views.js";
import type { InternalTakeoverRequest, GameState, RoomViewContext, TakeoverResolution } from "./state.js";
import type { PlayerSession, TakeoverPlayerRequest, TakeoverReceipt, RoomActionResult } from "@werewolf/shared";
import { nicknameSchema } from "@werewolf/shared";
import { randomUUID } from "node:crypto";

export function requestTakeover(
  state: GameState,
  input: TakeoverPlayerRequest,
  socketId: string,
  now: Date,
  credentials: { roomCode: string; joinToken: string }
): RoomActionResult<TakeoverReceipt> {
  if (state.phase !== "lobby") return failures.gameAlreadyStarted();
  if (input.roomCode !== credentials.roomCode || input.joinToken !== credentials.joinToken) {
    return failures.invalidCredentials();
  }
  if (state.players.some((player) => player.socketId === socketId) || state.takeoverRequests.some((request) => request.socketId === socketId))
    return failures.alreadyJoined();

  const nickname = nicknameSchema.parse(input.nickname);
  const player = state.players.find((candidate) => candidate.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase());
  if (!player || player.controller === "bot" || player.connection === "departed") {
    return failures.playerNotFound();
  }
  if (state.takeoverRequests.some((request) => request.playerId === player.id)) {
    return failures.takeoverAlreadyPending();
  }

  const request: InternalTakeoverRequest = {
    id: randomUUID(),
    playerId: player.id,
    nickname: player.nickname,
    requestedAt: now.toISOString(),
    socketId
  };
  state.takeoverRequests.push(request);
  state.revision += 1;
  return { ok: true, data: { requestId: request.id, nickname: request.nickname } };
}

export function reattachTakeoverRequest(
  state: GameState,
  requestId: string,
  input: TakeoverPlayerRequest,
  socketId: string,
  credentials: { roomCode: string; joinToken: string }
): RoomActionResult<TakeoverReceipt> {
  if (state.phase !== "lobby") return failures.gameAlreadyStarted();
  if (input.roomCode !== credentials.roomCode || input.joinToken !== credentials.joinToken) {
    return failures.invalidCredentials();
  }
  if (state.players.some((player) => player.socketId === socketId)) {
    return failures.alreadyJoined();
  }
  if (state.takeoverRequests.some((request) => request.socketId === socketId && request.id !== requestId)) {
    return failures.alreadyJoined();
  }

  const request = state.takeoverRequests.find((candidate) => candidate.id === requestId);
  if (!request) return failures.takeoverRequestNotFound();

  const player = findPlayer(state, request.playerId);
  if (!player || player.controller === "bot" || player.connection === "departed") {
    return failures.playerNotFound();
  }
  if (player.nickname.toLocaleLowerCase() !== input.nickname.toLocaleLowerCase()) {
    return failures.invalidCredentials();
  }

  if (request.socketId !== socketId) {
    request.socketId = socketId;
    state.revision += 1;
  }
  return { ok: true, data: { requestId: request.id, nickname: request.nickname } };
}

export function resolveTakeover(state: GameState, requestId: string, approved: boolean, context: RoomViewContext): RoomActionResult<TakeoverResolution> {
  const index = state.takeoverRequests.findIndex((request) => request.id === requestId);
  if (index < 0) return failures.takeoverRequestNotFound();
  const pendingRequest = state.takeoverRequests[index]!;
  if (approved && state.players.some((candidate) => candidate.id !== pendingRequest.playerId && candidate.socketId === pendingRequest.socketId))
    return failures.alreadyJoined();
  const [request] = state.takeoverRequests.splice(index, 1);
  const player = findPlayer(state, request!.playerId);
  if (!player || player.connection === "departed") return failures.playerNotFound();

  let session: PlayerSession | null = null;
  let replacedSocketId: string | null = null;
  if (approved) {
    const reconnectToken = createReconnectToken();
    replacedSocketId = player.socketId && player.socketId !== request!.socketId ? player.socketId : null;
    player.reconnectTokenHash = hashReconnectToken(reconnectToken);
    player.socketId = request!.socketId;
    player.connection = "online";
    session = createSession(state, player.id, reconnectToken, context);
  }

  state.revision += 1;
  return {
    ok: true,
    data: {
      view: getHostView(state, context),
      approved,
      requestSocketId: request!.socketId,
      replacedSocketId,
      session
    }
  };
}

export function cancelTakeoverRequests(state: GameState, socketId: string, preservedRequestId: string | null = null): boolean {
  const previousLength = state.takeoverRequests.length;
  state.takeoverRequests = state.takeoverRequests.filter((request) => request.socketId !== socketId || request.id === preservedRequestId);
  if (state.takeoverRequests.length === previousLength) return false;
  state.revision += 1;
  return true;
}
