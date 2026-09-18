import { chatModeSchema, roleConfigurationSchema } from "@werewolf/shared";
import type { ChatMessage, WolfChatMessage } from "@werewolf/shared";
import type { LobbyRoomSnapshot, GameState } from "./state.js";
import { randomUUID } from "node:crypto";

export function createSnapshot(state: GameState, roomCode: string, joinToken: string): LobbyRoomSnapshot {
  return {
    version: 3,
    roomCode,
    joinToken,
    revision: state.revision,
    phase: state.phase,
    nightStage: state.nightStage,
    wolfVoteLocked: state.wolfVoteLocked,
    wolfAttackTargetId: state.wolfAttackTargetId,
    witchActionSubmitted: state.witchActionSubmitted,
    dawnDeathIds: [...state.dawnDeathIds],
    ...(state.chatPersistence ? {} : { chatMessages: state.chatMessages.map((message) => ({ ...message })) }),
    chatSequence: state.chatSequence,
    gameSessionId: state.gameSessionId,
    gameSessionStartedAt: state.gameSessionStartedAt,
    speechOrderIds: [...state.speechOrderIds],
    currentSpeakerIndex: state.currentSpeakerIndex,
    dayVoteResult: state.dayVoteResult?.map((ballot) => ({ ...ballot })) ?? null,
    exiledPlayerId: state.exiledPlayerId,
    currentSpeakerFinished: state.currentSpeakerFinished,
    pendingWitchAction: state.pendingWitchAction ? { ...state.pendingWitchAction } : null,
    guardTargetId: state.guardTargetId,
    lastGuardTargetId: state.lastGuardTargetId,
    guardActionSubmitted: state.guardActionSubmitted,
    pendingHunterResolution: state.pendingHunterResolution ? { ...state.pendingHunterResolution } : null,
    hunterShotPlayerId: state.hunterShotPlayerId,
    hunterActionSubmitted: state.hunterActionSubmitted,
    revealedIdiotId: state.revealedIdiotId,
    chatMode: state.chatMode,
    dayNumber: state.dayNumber,
    gameOutcome: state.gameOutcome,
    gameRecords: state.gameRecords.map((record) => ({ ...record })),
    roleConfiguration: { ...state.roleConfiguration },
    players: state.players.map(({ socketId: _socketId, reconnectTokenHash, ...player }) => ({
      ...player,
      reconnectTokenHash: reconnectTokenHash.toString("base64")
    }))
  };
}

export function restoreSnapshot(state: GameState, snapshot: LobbyRoomSnapshot): void {
  if (![1, 2, 3].includes(snapshot.version)) throw new Error("unsupported room snapshot version");
  state.revision = snapshot.revision;
  state.phase = snapshot.phase;
  state.nightStage = snapshot.nightStage;
  state.wolfVoteLocked = snapshot.wolfVoteLocked;
  state.wolfAttackTargetId = snapshot.wolfAttackTargetId;
  state.witchActionSubmitted = snapshot.witchActionSubmitted;
  state.dawnDeathIds = [...snapshot.dawnDeathIds];
  state.roleConfiguration = roleConfigurationSchema.parse(snapshot.roleConfiguration);
  state.chatMode = chatModeSchema.parse(snapshot.chatMode);
  const snapshotMessages: ChatMessage[] =
    snapshot.chatMessages?.map((message) => ({ ...message })) ??
    snapshot.wolfMessages?.map((message: WolfChatMessage, index) => ({
      id: message.id,
      sequence: index + 1,
      channel: "wolf-private" as const,
      day: snapshot.dayNumber,
      phase: "first-night" as const,
      sender: { kind: "player" as const, ...message.sender },
      content:
        message.kind === "target-suggestion" && message.target
          ? { kind: "target-suggestion" as const, target: message.target }
          : message.kind === "quick"
            ? {
                kind: "quick" as const,
                code: message.text === "赞同" ? ("agree" as const) : message.text === "反对" ? ("disagree" as const) : ("no-kill" as const)
              }
            : { kind: "text" as const, text: message.text },
      createdAt: message.createdAt
    })) ??
    [];
  state.gameSessionId = snapshot.gameSessionId ?? (snapshot.phase === "lobby" ? null : randomUUID());
  const existingSession = state.gameSessionId ? (state.chatPersistence?.getSession?.(state.gameSessionId) ?? null) : null;
  state.gameSessionStartedAt =
    snapshot.gameSessionStartedAt ?? existingSession?.startedAt ?? snapshotMessages[0]?.createdAt ?? (state.gameSessionId ? new Date().toISOString() : null);
  if (state.chatPersistence && state.gameSessionId) {
    state.chatPersistence.createSession({
      id: state.gameSessionId,
      roomCode: snapshot.roomCode,
      startedAt: state.gameSessionStartedAt!,
      roleConfiguration: { ...state.roleConfiguration },
      chatMode: state.chatMode
    });
    if (snapshotMessages.length > 0) {
      state.chatPersistence.importMessages(state.gameSessionId, snapshotMessages);
    }
    state.chatMessages = state.chatPersistence.loadRecentForRecovery(state.gameSessionId, 300);
    if (snapshot.gameOutcome) {
      state.chatPersistence.finishSession(state.gameSessionId, {
        outcome: snapshot.gameOutcome,
        endedAt: new Date().toISOString()
      });
    }
  } else {
    state.chatMessages = snapshotMessages;
  }
  state.chatSequence = Math.max(
    snapshot.chatSequence ?? 0,
    state.chatMessages.reduce((maximum, message) => Math.max(maximum, message.sequence), 0)
  );
  state.speechOrderIds = [...snapshot.speechOrderIds];
  state.currentSpeakerIndex = snapshot.currentSpeakerIndex;
  state.dayVoteResult = snapshot.dayVoteResult?.map((ballot) => ({ ...ballot })) ?? null;
  state.exiledPlayerId = snapshot.exiledPlayerId;
  state.currentSpeakerFinished = snapshot.currentSpeakerFinished ?? false;
  state.pendingWitchAction = snapshot.pendingWitchAction ? { ...snapshot.pendingWitchAction } : null;
  state.guardTargetId = snapshot.guardTargetId ?? null;
  state.lastGuardTargetId = snapshot.lastGuardTargetId ?? null;
  state.guardActionSubmitted = snapshot.guardActionSubmitted ?? false;
  state.pendingHunterResolution = snapshot.pendingHunterResolution ? { ...snapshot.pendingHunterResolution } : null;
  state.hunterShotPlayerId = snapshot.hunterShotPlayerId ?? null;
  state.hunterActionSubmitted = snapshot.hunterActionSubmitted ?? false;
  state.revealedIdiotId = snapshot.revealedIdiotId ?? null;
  state.dayNumber = snapshot.dayNumber;
  state.gameOutcome = snapshot.gameOutcome;
  state.gameRecords = snapshot.gameRecords.map((record) => ({ ...record }));
  state.players = snapshot.players.map(({ lastWolfMessageAtMs, ...player }) => {
    const controller = player.controller ?? "human";
    return {
      ...player,
      controller,
      botKind: controller === "bot" ? (player.botKind ?? "deterministic") : null,
      botProfileId: controller === "bot" && player.botKind === "llm" ? (player.botProfileId ?? null) : null,
      aiConfigurationLocked: player.aiConfigurationLocked ?? false,
      aiBotProfileRevision: player.aiBotProfileRevision ?? null,
      aiModelProfileId: player.aiModelProfileId ?? null,
      aiModelProfileRevision: player.aiModelProfileRevision ?? null,
      aiModelChainRevision: player.aiModelChainRevision ?? null,
      lastChatMessageAtMs: player.lastChatMessageAtMs ?? lastWolfMessageAtMs ?? null,
      idiotRevealed: player.idiotRevealed ?? false,
      socketId: null,
      connection: player.connection === "departed" ? "departed" : controller === "bot" ? "online" : "offline",
      reconnectTokenHash: Buffer.from(player.reconnectTokenHash, "base64")
    };
  });
}
