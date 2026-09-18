import { evaluateGameOutcome } from "../game/rules.js";
import { createReconnectToken, hashReconnectToken } from "./tokens.js";
import type {
  BotKind,
  ChatMessage,
  ChatMode,
  DayVoteTarget,
  GameRecord,
  HostLobbyView,
  LobbyPlayer,
  PlayerId,
  PlayerSession,
  Role,
  RoleConfiguration,
  TakeoverRequest,
  WolfChatMessage,
  WolfVoteTarget
} from "@werewolf/shared";
import { randomUUID } from "node:crypto";

export interface InternalPlayer extends LobbyPlayer {
  socketId: string | null;
  reconnectTokenHash: Buffer;
  role: Role | null;
  roleConfirmed: boolean;
  wolfVoteTarget: WolfVoteTarget;
  wolfVoteConfirmed: boolean;
  seerInspectedPlayerId: PlayerId | null;
  witchAntidoteAvailable: boolean;
  witchPoisonAvailable: boolean;
  lastChatMessageAtMs: number | null;
  alive: boolean;
  dayVoteTarget: DayVoteTarget;
  dayVoteConfirmed: boolean;
  idiotRevealed: boolean;
  aiConfigurationLocked: boolean;
  aiBotProfileRevision: number | null;
  aiModelProfileId: string | null;
  aiModelProfileRevision: number | null;
  aiModelChainRevision: string | null;
}

export interface BotConfigurationLock {
  locked: boolean;
  botProfileRevision: number | null;
  modelProfileId: string | null;
  modelProfileRevision: number | null;
  modelChainRevision: string | null;
}

export interface PendingHunterResolution {
  hunterId: PlayerId;
  origin: "night" | "exile";
}

export interface InternalTakeoverRequest extends TakeoverRequest {
  socketId: string;
}

export type RoomPhase = "lobby" | "role-reveal" | "first-night" | "dawn" | "last-words" | "day-speech" | "day-vote" | "exile-result" | "game-over";

export type NightStage = "wolf" | "seer" | "guard" | "witch" | "complete";

export type ChatHistoryReader = { kind: "host" } | { kind: "player"; playerId: PlayerId };

export interface RoomChatPersistence {
  createSession(input: { id: string; roomCode: string; startedAt: string; roleConfiguration: RoleConfiguration; chatMode: ChatMode }): void;
  getSession?(sessionId: string): {
    id: string;
    roomCode: string;
    startedAt: string;
    roleConfiguration: RoleConfiguration;
    chatMode: ChatMode;
  } | null;
  finishSession(
    sessionId: string,
    input: {
      endedAt: string;
      outcome: "good-win" | "wolf-win" | "draw" | "terminated";
    }
  ): void;
  appendMessage(sessionId: string, message: ChatMessage): void;
  importMessages(sessionId: string, messages: ChatMessage[]): void;
  loadRecentForRecovery(sessionId: string, limit?: number): ChatMessage[];
  queryAfter(
    sessionId: string,
    reader: { kind: "host" } | { kind: "player"; canReadWolfPrivate: boolean },
    afterSequence: number,
    limit: number
  ): {
    messages: ChatMessage[];
    latestSequence: number;
    hasMore: boolean;
  };
}

export type TimedStage = "role-reveal" | "wolf" | "seer" | "guard" | "witch" | "hunter" | "dawn" | "last-words" | "day-speech" | "day-vote" | "exile-result";

export interface LobbyRoomSnapshot {
  version: 1 | 2 | 3;
  roomCode: string;
  joinToken: string;
  revision: number;
  phase: HostLobbyView["phase"];
  nightStage: "wolf" | "seer" | "guard" | "witch" | "complete";
  wolfVoteLocked: boolean;
  wolfAttackTargetId: PlayerId | null;
  witchActionSubmitted: boolean;
  dawnDeathIds: PlayerId[];
  chatMessages?: ChatMessage[];
  chatSequence?: number;
  gameSessionId?: string | null;
  gameSessionStartedAt?: string | null;
  wolfMessages?: WolfChatMessage[];
  speechOrderIds: PlayerId[];
  currentSpeakerIndex: number;
  dayVoteResult: Array<{ voterId: PlayerId; targetId: PlayerId | null }> | null;
  exiledPlayerId: PlayerId | null;
  currentSpeakerFinished?: boolean;
  pendingWitchAction?: { saved: boolean; poisonTargetId: PlayerId | null } | null;
  guardTargetId?: PlayerId | null;
  lastGuardTargetId?: PlayerId | null;
  guardActionSubmitted?: boolean;
  pendingHunterResolution?: PendingHunterResolution | null;
  hunterShotPlayerId?: PlayerId | null;
  hunterActionSubmitted?: boolean;
  revealedIdiotId?: PlayerId | null;
  chatMode?: ChatMode;
  dayNumber: number;
  gameOutcome: "good-win" | "wolf-win" | "draw" | "terminated" | null;
  gameRecords: GameRecord[];
  roleConfiguration: RoleConfiguration;
  players: Array<
    Omit<
      InternalPlayer,
      | "socketId"
      | "reconnectTokenHash"
      | "controller"
      | "botKind"
      | "botProfileId"
      | "aiConfigurationLocked"
      | "aiBotProfileRevision"
      | "aiModelProfileId"
      | "aiModelProfileRevision"
      | "aiModelChainRevision"
    > & {
      reconnectTokenHash: string;
      lastWolfMessageAtMs?: number | null;
      controller?: "human" | "bot";
      botKind?: BotKind | null;
      botProfileId?: LobbyPlayer["botProfileId"];
      aiConfigurationLocked?: boolean;
      aiBotProfileRevision?: number | null;
      aiModelProfileId?: string | null;
      aiModelProfileRevision?: number | null;
      aiModelChainRevision?: string | null;
    }
  >;
}

export interface GameState {
  revision: number;
  players: InternalPlayer[];
  takeoverRequests: InternalTakeoverRequest[];
  phase: RoomPhase;
  nightStage: NightStage;
  wolfVoteLocked: boolean;
  wolfAttackTargetId: PlayerId | null;
  witchActionSubmitted: boolean;
  dawnDeathIds: PlayerId[];
  chatMessages: ChatMessage[];
  chatSequence: number;
  gameSessionId: string | null;
  gameSessionStartedAt: string | null;
  speechOrderIds: PlayerId[];
  currentSpeakerIndex: number;
  dayVoteResult: Array<{ voterId: PlayerId; targetId: PlayerId | null }> | null;
  exiledPlayerId: PlayerId | null;
  currentSpeakerFinished: boolean;
  pendingWitchAction: { saved: boolean; poisonTargetId: PlayerId | null } | null;
  guardTargetId: PlayerId | null;
  lastGuardTargetId: PlayerId | null;
  guardActionSubmitted: boolean;
  pendingHunterResolution: PendingHunterResolution | null;
  hunterShotPlayerId: PlayerId | null;
  hunterActionSubmitted: boolean;
  revealedIdiotId: PlayerId | null;
  chatMode: ChatMode;
  dayNumber: number;
  gameOutcome: "good-win" | "wolf-win" | "draw" | "terminated" | null;
  gameRecords: GameRecord[];
  deferCompletedStages: boolean;
  chatPersistence: RoomChatPersistence | null;
  roleConfiguration: RoleConfiguration;
}

export interface RoomViewContext {
  roomCode: string;
  joinUrl: string;
  localAddress: string;
}

export interface ReconnectOutcome {
  session: PlayerSession;
  replacedSocketId: string | null;
}

export interface TakeoverResolution {
  view: HostLobbyView;
  approved: boolean;
  requestSocketId: string;
  replacedSocketId: string | null;
  session: PlayerSession | null;
}

export interface PlayerDeparture {
  view: HostLobbyView;
  player: LobbyPlayer;
  socketId: string | null;
  takeoverSocketIds: string[];
}

export function createGameState(options: { deferCompletedStages: boolean; chatPersistence: RoomChatPersistence | null }): GameState {
  return {
    revision: 0,
    players: [],
    takeoverRequests: [],
    phase: "lobby",
    nightStage: "wolf",
    wolfVoteLocked: false,
    wolfAttackTargetId: null,
    witchActionSubmitted: false,
    dawnDeathIds: [],
    chatMessages: [],
    chatSequence: 0,
    gameSessionId: null,
    gameSessionStartedAt: null,
    speechOrderIds: [],
    currentSpeakerIndex: -1,
    dayVoteResult: null,
    exiledPlayerId: null,
    currentSpeakerFinished: false,
    pendingWitchAction: null,
    guardTargetId: null,
    lastGuardTargetId: null,
    guardActionSubmitted: false,
    pendingHunterResolution: null,
    hunterShotPlayerId: null,
    hunterActionSubmitted: false,
    revealedIdiotId: null,
    chatMode: "ordered",
    dayNumber: 1,
    gameOutcome: null,
    gameRecords: [],
    deferCompletedStages: options.deferCompletedStages,
    chatPersistence: options.chatPersistence,
    roleConfiguration: {
      wolf: 0,
      villager: 0,
      seer: 0,
      witch: 0,
      guard: 0,
      hunter: 0,
      idiot: 0
    }
  };
}

export function createHumanPlayer(state: GameState, input: { nickname: string; socketId: string; reconnectToken: string }): InternalPlayer {
  return {
    id: randomUUID(),
    number: state.players.length + 1,
    nickname: input.nickname,
    connection: "online",
    controller: "human",
    botKind: null,
    botProfileId: null,
    socketId: input.socketId,
    reconnectTokenHash: hashReconnectToken(input.reconnectToken),
    role: null,
    roleConfirmed: false,
    wolfVoteTarget: null,
    wolfVoteConfirmed: false,
    seerInspectedPlayerId: null,
    witchAntidoteAvailable: true,
    witchPoisonAvailable: true,
    lastChatMessageAtMs: null,
    alive: true,
    dayVoteTarget: null,
    dayVoteConfirmed: false,
    idiotRevealed: false,
    aiConfigurationLocked: false,
    aiBotProfileRevision: null,
    aiModelProfileId: null,
    aiModelProfileRevision: null,
    aiModelChainRevision: null
  };
}

export function createBotPlayer(state: GameState, input: { nickname: string; botKind: BotKind; botProfileId: LobbyPlayer["botProfileId"] }): InternalPlayer {
  return {
    id: randomUUID(),
    number: state.players.length + 1,
    nickname: input.nickname,
    connection: "online",
    controller: "bot",
    botKind: input.botKind,
    botProfileId: input.botProfileId,
    socketId: null,
    reconnectTokenHash: hashReconnectToken(createReconnectToken()),
    role: null,
    roleConfirmed: false,
    wolfVoteTarget: null,
    wolfVoteConfirmed: false,
    seerInspectedPlayerId: null,
    witchAntidoteAvailable: true,
    witchPoisonAvailable: true,
    lastChatMessageAtMs: null,
    alive: true,
    dayVoteTarget: null,
    dayVoteConfirmed: false,
    idiotRevealed: false,
    aiConfigurationLocked: false,
    aiBotProfileRevision: null,
    aiModelProfileId: null,
    aiModelProfileRevision: null,
    aiModelChainRevision: null
  };
}

export function recordGameEvent(state: GameState, type: GameRecord["type"], detail: string): void {
  state.gameRecords.push({ type, day: state.dayNumber, detail });
}

export function finishCurrentSession(state: GameState, outcome: "good-win" | "wolf-win" | "draw" | "terminated", now: Date): void {
  if (!state.gameSessionId) return;
  state.chatPersistence?.finishSession(state.gameSessionId, {
    outcome,
    endedAt: now.toISOString()
  });
}

export function evaluateWinner(state: GameState): void {
  if (state.gameOutcome) return;
  const outcome = evaluateGameOutcome(state.players);
  if (!outcome) return;
  finishCurrentSession(state, outcome, new Date());
  state.gameOutcome = outcome;
  state.phase = "game-over";
}

export function advanceAfterRoleConfirmation(state: GameState): void {
  const progress = getRoleConfirmationProgress(state);
  if (state.phase === "role-reveal" && progress.total > 0 && progress.confirmed === progress.total) {
    if (!state.deferCompletedStages) state.phase = "first-night";
  }
}

export function startNextNight(state: GameState): void {
  state.dayNumber += 1;
  state.phase = "first-night";
  state.nightStage = "wolf";
  state.wolfVoteLocked = false;
  state.wolfAttackTargetId = null;
  state.witchActionSubmitted = false;
  state.dawnDeathIds = [];
  state.speechOrderIds = [];
  state.currentSpeakerIndex = -1;
  state.dayVoteResult = null;
  state.exiledPlayerId = null;
  state.currentSpeakerFinished = false;
  state.pendingWitchAction = null;
  state.lastGuardTargetId = state.guardTargetId;
  state.guardTargetId = null;
  state.guardActionSubmitted = false;
  state.pendingHunterResolution = null;
  state.hunterShotPlayerId = null;
  state.hunterActionSubmitted = false;
  for (const player of state.players) {
    player.wolfVoteTarget = null;
    player.wolfVoteConfirmed = false;
    player.seerInspectedPlayerId = null;
    player.lastChatMessageAtMs = null;
    player.dayVoteTarget = null;
    player.dayVoteConfirmed = false;
  }
}

export function resetGameState(state: GameState): void {
  state.dayNumber = 1;
  state.nightStage = "wolf";
  state.wolfVoteLocked = false;
  state.wolfAttackTargetId = null;
  state.witchActionSubmitted = false;
  state.dawnDeathIds = [];
  state.chatMessages = [];
  state.chatSequence = 0;
  state.gameSessionId = null;
  state.gameSessionStartedAt = null;
  state.speechOrderIds = [];
  state.currentSpeakerIndex = -1;
  state.dayVoteResult = null;
  state.exiledPlayerId = null;
  state.currentSpeakerFinished = false;
  state.pendingWitchAction = null;
  state.guardTargetId = null;
  state.lastGuardTargetId = null;
  state.guardActionSubmitted = false;
  state.pendingHunterResolution = null;
  state.hunterShotPlayerId = null;
  state.hunterActionSubmitted = false;
  state.revealedIdiotId = null;
  state.gameOutcome = null;
  state.gameRecords = [];
  for (const player of state.players) {
    player.wolfVoteTarget = null;
    player.wolfVoteConfirmed = false;
    player.seerInspectedPlayerId = null;
    player.lastChatMessageAtMs = null;
    player.dayVoteTarget = null;
    player.dayVoteConfirmed = false;
    player.idiotRevealed = false;
  }
}

export function beginGameState(state: GameState, participants: InternalPlayer[], roles: Role[], gameSessionId: string, gameSessionStartedAt: string): void {
  participants.forEach((player, index) => {
    player.role = roles[index]!;
    player.roleConfirmed = false;
    player.wolfVoteTarget = null;
    player.wolfVoteConfirmed = false;
    player.seerInspectedPlayerId = null;
    player.witchAntidoteAvailable = true;
    player.witchPoisonAvailable = true;
    player.lastChatMessageAtMs = null;
    player.alive = true;
    player.dayVoteTarget = null;
    player.dayVoteConfirmed = false;
    player.idiotRevealed = false;
  });
  state.takeoverRequests = [];
  state.phase = "role-reveal";
  state.nightStage = "wolf";
  state.wolfVoteLocked = false;
  state.wolfAttackTargetId = null;
  state.witchActionSubmitted = false;
  state.dawnDeathIds = [];
  state.chatMessages = [];
  state.chatSequence = 0;
  state.gameSessionId = gameSessionId;
  state.gameSessionStartedAt = gameSessionStartedAt;
  state.speechOrderIds = [];
  state.currentSpeakerIndex = -1;
  state.dayVoteResult = null;
  state.exiledPlayerId = null;
  state.currentSpeakerFinished = false;
  state.pendingWitchAction = null;
  state.guardTargetId = null;
  state.lastGuardTargetId = null;
  state.guardActionSubmitted = false;
  state.pendingHunterResolution = null;
  state.hunterShotPlayerId = null;
  state.hunterActionSubmitted = false;
  state.revealedIdiotId = null;
  state.gameRecords = [];
}

export function renumberPlayers(state: GameState): void {
  state.players.forEach((player, index) => {
    player.number = index + 1;
  });
}

export function getRoleConfirmationProgress(state: GameState): { confirmed: number; total: number } {
  const participants = state.players.filter((player) => player.connection !== "departed" && player.role);
  return {
    confirmed: participants.filter((player) => player.roleConfirmed).length,
    total: participants.length
  };
}

export function findPlayer(state: GameState, playerId: PlayerId): InternalPlayer | undefined {
  return state.players.find((player) => player.id === playerId);
}

export function isLivePlayer(player: InternalPlayer | undefined | null): player is InternalPlayer {
  return Boolean(player) && player!.alive && player!.connection !== "departed";
}

export function findNightActor(state: GameState, playerId: PlayerId, role: "seer" | "guard" | "witch"): InternalPlayer | undefined {
  if (state.phase !== "first-night" || state.nightStage !== role) return undefined;
  const player = findPlayer(state, playerId);
  if (!isLivePlayer(player) || player.role !== role) return undefined;
  return player;
}

export function toNightCandidate(state: GameState, playerId: PlayerId): { id: PlayerId; number: number; nickname: string } | null {
  const player = findPlayer(state, playerId);
  return player ? { id: player.id, number: player.number, nickname: player.nickname } : null;
}

export function getNightStage(state: GameState): "wolf" | "seer" | "guard" | "witch" | null {
  if (state.phase !== "first-night" || state.nightStage === "complete") return null;
  return state.nightStage;
}

export function getTimedStage(state: GameState): TimedStage | null {
  if (state.pendingHunterResolution) return "hunter";
  return (
    getNightStage(state) ??
    (["role-reveal", "dawn", "last-words", "day-speech", "day-vote", "exile-result"].includes(state.phase) ? (state.phase as TimedStage) : null)
  );
}

export function publicPlayers(state: GameState): LobbyPlayer[] {
  return state.players.map(
    ({
      socketId: _socketId,
      reconnectTokenHash: _tokenHash,
      role: _role,
      roleConfirmed: _roleConfirmed,
      wolfVoteTarget: _wolfVoteTarget,
      wolfVoteConfirmed: _wolfVoteConfirmed,
      seerInspectedPlayerId: _seerInspectedPlayerId,
      witchAntidoteAvailable: _witchAntidoteAvailable,
      witchPoisonAvailable: _witchPoisonAvailable,
      lastChatMessageAtMs: _lastChatMessageAtMs,
      dayVoteTarget: _dayVoteTarget,
      dayVoteConfirmed: _dayVoteConfirmed,
      idiotRevealed: _idiotRevealed,
      ...player
    }) => player
  );
}

export function getBotSeats(state: GameState): Array<{
  playerId: PlayerId;
  botKind: BotKind;
  botProfileId: LobbyPlayer["botProfileId"];
  lockedConfiguration: BotConfigurationLock;
}> {
  return state.players.flatMap((player) =>
    player.controller === "bot" && player.botKind
      ? [
          {
            playerId: player.id,
            botKind: player.botKind,
            botProfileId: player.botProfileId,
            lockedConfiguration: {
              locked: player.aiConfigurationLocked,
              botProfileRevision: player.aiBotProfileRevision,
              modelProfileId: player.aiModelProfileId,
              modelProfileRevision: player.aiModelProfileRevision,
              modelChainRevision: player.aiModelChainRevision
            }
          }
        ]
      : []
  );
}
