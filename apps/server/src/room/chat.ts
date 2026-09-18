import { findPlayer } from "./state.js";
import { roomFailures as failures } from "../room-failures.js";
import { canSendPublicChat } from "./day-procedure.js";
import { getActiveWolf } from "./night-resolution.js";
import { toNightCandidate, type ChatHistoryReader, type GameState } from "./state.js";
import type { ChatMessage, ChatSendRequest, ChatChannel, PlayerId, RoomActionResult } from "@werewolf/shared";
import { randomUUID } from "node:crypto";

export function getChatHistory(
  state: GameState,
  reader: ChatHistoryReader,
  afterSequence: number,
  limit: number
): RoomActionResult<{
  sessionId: string;
  messages: ChatMessage[];
  latestSequence: number;
  hasMore: boolean;
}> {
  if (!state.gameSessionId) return failures.invalidPhaseControl();
  const storeReader =
    reader.kind === "host"
      ? reader
      : {
          kind: "player" as const,
          canReadWolfPrivate: state.players.some(
            (player) => player.id === reader.playerId && player.role === "wolf" && player.alive && player.connection !== "departed"
          )
        };
  if (reader.kind === "player" && !state.players.some((player) => player.id === reader.playerId && player.connection !== "departed"))
    return failures.playerNotFound();

  const page = state.chatPersistence
    ? state.chatPersistence.queryAfter(state.gameSessionId, storeReader, afterSequence, limit)
    : queryInMemoryChatHistory(state, storeReader, afterSequence, limit);
  return {
    ok: true,
    data: {
      sessionId: state.gameSessionId,
      ...page
    }
  };
}

export function sendChat(state: GameState, playerId: PlayerId, input: ChatSendRequest, now: Date): RoomActionResult<ChatMessage> {
  const player = findPlayer(state, playerId);
  if (!player || player.connection === "departed") return failures.playerNotFound();
  if (input.channel === "wolf-private") {
    if (!getActiveWolf(state, playerId) || state.wolfVoteLocked) return failures.invalidNightAction();
  } else if (!canSendPublicChat(state, player)) {
    return failures.invalidPhaseControl();
  }
  if (player.lastChatMessageAtMs !== null && now.getTime() - player.lastChatMessageAtMs < 1_000) {
    return failures.chatRateLimited();
  }

  let content: ChatMessage["content"];
  if ("target" in input.content) {
    const targetId = input.content.target;
    const target = toNightCandidate(state, targetId);
    if (!target || !state.players.some((candidate) => candidate.id === targetId && candidate.connection !== "departed")) return failures.playerNotFound();
    content = { kind: "target-suggestion", target };
  } else {
    content = input.content;
  }

  const nextSequence = state.chatSequence + 1;
  const message: ChatMessage = {
    id: randomUUID(),
    sequence: nextSequence,
    channel: input.channel,
    day: state.dayNumber,
    phase: state.phase,
    sender: {
      kind: "player",
      id: player.id,
      number: player.number,
      nickname: player.nickname
    },
    content,
    createdAt: now.toISOString()
  };
  if (!state.gameSessionId) return failures.invalidPhaseControl();
  state.chatPersistence?.appendMessage(state.gameSessionId, message);
  state.chatSequence = nextSequence;
  state.chatMessages.push(message);
  state.chatMessages = state.chatMessages.slice(-300);
  player.lastChatMessageAtMs = now.getTime();
  state.revision += 1;
  return { ok: true, data: message };
}

export function getChannelMessages(state: GameState, channel: ChatChannel): ChatMessage[] {
  return state.chatMessages.filter((message) => message.channel === channel).slice(-100);
}

export function getPublicChatMessages(state: GameState): ChatMessage[] {
  return state.chatMessages.filter((message) => message.channel === "day-public" || message.channel === "system").slice(-100);
}

export function queryInMemoryChatHistory(
  state: GameState,
  reader: { kind: "host" } | { kind: "player"; canReadWolfPrivate: boolean },
  afterSequence: number,
  limit: number
): {
  messages: ChatMessage[];
  latestSequence: number;
  hasMore: boolean;
} {
  const readable = state.chatMessages.filter((message) => {
    if (message.channel === "day-public" || message.channel === "system") return true;
    return reader.kind === "player" && reader.canReadWolfPrivate;
  });
  const remaining = readable.filter((message) => message.sequence > afterSequence);
  return {
    messages: remaining.slice(0, limit),
    latestSequence: state.chatSequence,
    hasMore: remaining.length > limit
  };
}
