import {
  botKindSchema,
  chatModeSchema,
  hostAddBotRequestSchema,
  hostLobbyViewSchema,
  nicknameSchema,
  playerSessionSchema,
  playerLobbyViewSchema,
  roleConfigurationSchema,
  roleSchema,
  roomCodeSchema,
  type BotKind,
  type HostAddBotRequest,
  type ChatChannel,
  type ChatMessage,
  type ChatMode,
  type ChatSendRequest,
  type HostLobbyView,
  type JoinLobbyRequest,
  type LobbyPlayer,
  type PlayerId,
  type PlayerLobbyView,
  type PlayerSession,
  type ReconnectPlayerRequest,
  type Role,
  type RoleConfiguration,
  type RoleConfigurationInput,
  type RoomActionResult,
  type TakeoverPlayerRequest,
  type TakeoverReceipt,
  type TakeoverRequest,
  type DayVoteTarget,
  type GameRecord,
  type WitchSubmitActionRequest,
  type WolfChatMessage,
  type WolfSendMessageRequest,
  type WolfVoteTarget
} from "@werewolf/shared";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { evaluateGameOutcome, resolveNightDeaths, resolvePlurality, resolveWolfAttack } from "./game/rules.js";
import { roomFailures as failures } from "./room-failures.js";
import { evaluateStartReadiness } from "./role-configuration.js";

interface InternalPlayer extends LobbyPlayer {
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

interface PendingHunterResolution {
  hunterId: PlayerId;
  origin: "night" | "exile";
}

interface InternalTakeoverRequest extends TakeoverRequest {
  socketId: string;
}

interface RoomOptions {
  localAddress: string;
  webPort: number;
  roomCode?: string;
  joinToken?: string;
  snapshot?: LobbyRoomSnapshot;
  deferCompletedStages?: boolean;
  chatPersistence?: RoomChatPersistence;
}

export type ChatHistoryReader =
  | { kind: "host" }
  | { kind: "player"; playerId: PlayerId };

export interface RoomChatPersistence {
  createSession(input: {
    id: string;
    roomCode: string;
    startedAt: string;
    roleConfiguration: RoleConfiguration;
    chatMode: ChatMode;
  }): void;
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

export type TimedStage = "role-reveal" | "wolf" | "seer" | "guard" | "witch" | "hunter" | "dawn"
  | "last-words" | "day-speech" | "day-vote" | "exile-result";

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
    Omit<InternalPlayer, "socketId" | "reconnectTokenHash" | "controller" | "botKind" | "botProfileId"
      | "aiConfigurationLocked" | "aiBotProfileRevision" | "aiModelProfileId" | "aiModelProfileRevision" | "aiModelChainRevision">
    & {
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

function createRoomCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function createJoinToken(): string {
  return randomBytes(32).toString("base64url");
}

function createReconnectToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashReconnectToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function tokenMatches(token: string, expectedHash: Buffer): boolean {
  const actualHash = hashReconnectToken(token);
  return actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
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

export class LobbyRoom {
  readonly roomCode: string;
  readonly localAddress: string;
  readonly webPort: number;
  private joinToken: string;
  private revision = 0;
  private players: InternalPlayer[] = [];
  private takeoverRequests: InternalTakeoverRequest[] = [];
  private phase: "lobby" | "role-reveal" | "first-night" | "dawn" | "last-words" | "day-speech" | "day-vote" | "exile-result" | "game-over" = "lobby";
  private nightStage: "wolf" | "seer" | "guard" | "witch" | "complete" = "wolf";
  private wolfVoteLocked = false;
  private wolfAttackTargetId: PlayerId | null = null;
  private witchActionSubmitted = false;
  private dawnDeathIds: PlayerId[] = [];
  private chatMessages: ChatMessage[] = [];
  private chatSequence = 0;
  private gameSessionId: string | null = null;
  private gameSessionStartedAt: string | null = null;
  private speechOrderIds: PlayerId[] = [];
  private currentSpeakerIndex = -1;
  private dayVoteResult: Array<{ voterId: PlayerId; targetId: PlayerId | null }> | null = null;
  private exiledPlayerId: PlayerId | null = null;
  private currentSpeakerFinished = false;
  private pendingWitchAction: { saved: boolean; poisonTargetId: PlayerId | null } | null = null;
  private guardTargetId: PlayerId | null = null;
  private lastGuardTargetId: PlayerId | null = null;
  private guardActionSubmitted = false;
  private pendingHunterResolution: PendingHunterResolution | null = null;
  private hunterShotPlayerId: PlayerId | null = null;
  private hunterActionSubmitted = false;
  private revealedIdiotId: PlayerId | null = null;
  private chatMode: ChatMode = "ordered";
  private dayNumber = 1;
  private gameOutcome: "good-win" | "wolf-win" | "draw" | "terminated" | null = null;
  private gameRecords: GameRecord[] = [];
  private deferCompletedStages: boolean;
  private readonly chatPersistence: RoomChatPersistence | null;
  private roleConfiguration: RoleConfiguration = {
    wolf: 0,
    villager: 0,
    seer: 0,
    witch: 0,
    guard: 0,
    hunter: 0,
    idiot: 0
  };

  constructor(options: RoomOptions) {
    this.localAddress = options.localAddress;
    this.webPort = options.webPort;
    this.deferCompletedStages = options.deferCompletedStages ?? false;
    this.chatPersistence = options.chatPersistence ?? null;
    const snapshot = options.snapshot;
    this.roomCode = roomCodeSchema.parse(snapshot?.roomCode ?? options.roomCode ?? createRoomCode());
    this.joinToken = snapshot?.joinToken ?? options.joinToken ?? createJoinToken();
    if (snapshot) this.restoreSnapshot(snapshot);
  }

  createSnapshot(): LobbyRoomSnapshot {
    return {
      version: 3,
      roomCode: this.roomCode,
      joinToken: this.joinToken,
      revision: this.revision,
      phase: this.phase,
      nightStage: this.nightStage,
      wolfVoteLocked: this.wolfVoteLocked,
      wolfAttackTargetId: this.wolfAttackTargetId,
      witchActionSubmitted: this.witchActionSubmitted,
      dawnDeathIds: [...this.dawnDeathIds],
      ...(this.chatPersistence
        ? {}
        : { chatMessages: this.chatMessages.map((message) => ({ ...message })) }),
      chatSequence: this.chatSequence,
      gameSessionId: this.gameSessionId,
      gameSessionStartedAt: this.gameSessionStartedAt,
      speechOrderIds: [...this.speechOrderIds],
      currentSpeakerIndex: this.currentSpeakerIndex,
      dayVoteResult: this.dayVoteResult?.map((ballot) => ({ ...ballot })) ?? null,
      exiledPlayerId: this.exiledPlayerId,
      currentSpeakerFinished: this.currentSpeakerFinished,
      pendingWitchAction: this.pendingWitchAction ? { ...this.pendingWitchAction } : null,
      guardTargetId: this.guardTargetId,
      lastGuardTargetId: this.lastGuardTargetId,
      guardActionSubmitted: this.guardActionSubmitted,
      pendingHunterResolution: this.pendingHunterResolution ? { ...this.pendingHunterResolution } : null,
      hunterShotPlayerId: this.hunterShotPlayerId,
      hunterActionSubmitted: this.hunterActionSubmitted,
      revealedIdiotId: this.revealedIdiotId,
      chatMode: this.chatMode,
      dayNumber: this.dayNumber,
      gameOutcome: this.gameOutcome,
      gameRecords: this.gameRecords.map((record) => ({ ...record })),
      roleConfiguration: { ...this.roleConfiguration },
      players: this.players.map(({ socketId: _socketId, reconnectTokenHash, ...player }) => ({
        ...player,
        reconnectTokenHash: reconnectTokenHash.toString("base64")
      }))
    };
  }

  enableDeferredStageAdvancement(): void {
    this.deferCompletedStages = true;
  }

  getJoinUrl(): string {
    const token = encodeURIComponent(this.joinToken);
    return `http://${this.localAddress}:${this.webPort}/join/${this.roomCode}?t=${token}`;
  }

  getGameSessionId(): string | null {
    return this.gameSessionId;
  }

  getChatHistory(
    reader: ChatHistoryReader,
    afterSequence: number,
    limit: number
  ): RoomActionResult<{
    sessionId: string;
    messages: ChatMessage[];
    latestSequence: number;
    hasMore: boolean;
  }> {
    if (!this.gameSessionId) return failures.invalidPhaseControl();
    const storeReader = reader.kind === "host"
      ? reader
      : {
          kind: "player" as const,
          canReadWolfPrivate: this.players.some(
            (player) => player.id === reader.playerId
              && player.role === "wolf"
              && player.alive
              && player.connection !== "departed"
          )
        };
    if (reader.kind === "player" && !this.players.some(
      (player) => player.id === reader.playerId && player.connection !== "departed"
    )) return failures.playerNotFound();

    const page = this.chatPersistence
      ? this.chatPersistence.queryAfter(this.gameSessionId, storeReader, afterSequence, limit)
      : this.queryInMemoryChatHistory(storeReader, afterSequence, limit);
    return {
      ok: true,
      data: {
        sessionId: this.gameSessionId,
        ...page
      }
    };
  }

  getHostView(): HostLobbyView {
    return hostLobbyViewSchema.parse({
      phase: this.phase,
      roomCode: this.roomCode,
      revision: this.revision,
      players: this.publicPlayers(),
      chatMode: this.chatMode,
      revealedIdiotId: this.revealedIdiotId,
      joinUrl: this.getJoinUrl(),
      localAddress: this.localAddress,
      takeoverRequests: this.takeoverRequests.map(({ socketId: _socketId, ...request }) => request),
      roleConfiguration: this.roleConfiguration,
      startReadiness: evaluateStartReadiness(
        this.roleConfiguration,
        this.players.filter((player) => player.connection !== "departed").length
      ),
      roleConfirmation: this.getRoleConfirmationProgress(),
      nightProgress: this.getNightProgress(),
      dawnResult: this.phase === "dawn" ? {
        deaths: this.dawnDeathIds.flatMap((id) => {
          const candidate = this.toNightCandidate(id);
          return candidate ? [candidate] : [];
        })
      } : null,
      dayState: this.getPublicDayState(),
      gameResult: this.getGameResult(),
      publicChat: {
        canSend: false,
        messages: this.getPublicChatMessages()
      }
    });
  }

  getPlayerView(playerId: PlayerId): PlayerLobbyView | null {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player) return null;
    return playerLobbyViewSchema.parse({
      phase: this.phase,
      roomCode: this.roomCode,
      revision: this.revision,
      players: this.publicPlayers(),
      chatMode: this.chatMode,
      revealedIdiotId: this.revealedIdiotId,
      selfId: playerId,
      privateRole: player.role ? {
        role: player.role,
        confirmed: player.roleConfirmed,
        wolfTeammates: player.role === "wolf"
          ? this.players
            .filter((candidate) => candidate.id !== player.id && candidate.role === "wolf" && candidate.alive)
            .map(({ id, number, nickname }) => ({ id, number, nickname }))
          : []
      } : null,
      roleConfirmation: this.getRoleConfirmationProgress(),
      nightProgress: this.getNightProgress(),
      wolfAction: this.phase === "first-night" && player.role === "wolf" && player.alive ? {
        candidates: this.players
          .filter((candidate) => candidate.alive && candidate.connection !== "departed")
          .map(({ id, number, nickname }) => ({ id, number, nickname })),
        target: player.wolfVoteTarget,
        confirmed: player.wolfVoteConfirmed,
        locked: this.wolfVoteLocked,
        chatEnabled: this.nightStage === "wolf" && !this.wolfVoteLocked,
        messages: this.getChannelMessages("wolf-private")
      } : null,
      seerAction: this.phase === "first-night" && player.role === "seer" && player.alive ? {
        active: this.nightStage === "seer",
        candidates: this.players
          .filter((candidate) => candidate.alive && candidate.connection !== "departed" && candidate.id !== player.id)
          .map(({ id, number, nickname }) => ({ id, number, nickname })),
        inspectedPlayer: player.seerInspectedPlayerId
          ? this.toNightCandidate(player.seerInspectedPlayerId)
          : null,
        result: player.seerInspectedPlayerId
          ? this.players.find((candidate) => candidate.id === player.seerInspectedPlayerId)?.role === "wolf"
            ? "wolf" : "good"
          : null
      } : null,
      witchAction: this.phase === "first-night" && player.role === "witch" && player.alive ? {
        active: this.nightStage === "witch",
        attackedPlayer: this.wolfAttackTargetId ? this.toNightCandidate(this.wolfAttackTargetId) : null,
        antidoteAvailable: player.witchAntidoteAvailable,
        poisonAvailable: player.witchPoisonAvailable,
        poisonCandidates: this.players
          .filter((candidate) => candidate.alive && candidate.connection !== "departed" && candidate.id !== player.id)
          .map(({ id, number, nickname }) => ({ id, number, nickname })),
        submitted: this.witchActionSubmitted
      } : null,
      guardAction: this.phase === "first-night" && player.role === "guard" && player.alive ? {
        active: this.nightStage === "guard",
        candidates: this.players
          .filter((candidate) => candidate.alive
            && candidate.connection !== "departed"
            && candidate.id !== this.lastGuardTargetId)
          .map(({ id, number, nickname }) => ({ id, number, nickname })),
        protectedPlayer: this.guardTargetId ? this.toNightCandidate(this.guardTargetId) : null,
        submitted: this.guardActionSubmitted
      } : null,
      hunterAction: player.role === "hunter" ? {
        active: this.pendingHunterResolution?.hunterId === player.id && !this.hunterActionSubmitted,
        candidates: this.pendingHunterResolution?.hunterId === player.id && !this.hunterActionSubmitted
          ? this.players
            .filter((candidate) => candidate.alive && candidate.connection !== "departed" && candidate.id !== player.id)
            .map(({ id, number, nickname }) => ({ id, number, nickname }))
          : [],
        shotPlayer: this.hunterShotPlayerId ? this.toNightCandidate(this.hunterShotPlayerId) : null,
        submitted: this.hunterActionSubmitted
      } : null,
      dawnResult: this.phase === "dawn" ? {
        deaths: this.dawnDeathIds.flatMap((id) => {
          const candidate = this.toNightCandidate(id);
          return candidate ? [candidate] : [];
        })
      } : null,
      dayState: this.getPublicDayState(),
      dayVote: this.phase === "day-vote" && player.alive ? {
        eligible: !player.idiotRevealed,
        candidates: player.idiotRevealed
          ? []
          : this.players
            .filter((candidate) => candidate.alive
              && candidate.connection !== "departed"
              && candidate.id !== player.id
              && !candidate.idiotRevealed)
            .map(({ id, number, nickname }) => ({ id, number, nickname })),
        target: player.dayVoteTarget,
        confirmed: player.dayVoteConfirmed
      } : null,
      gameResult: this.getGameResult(),
      publicChat: {
        canSend: this.canSendPublicChat(player),
        messages: this.getPublicChatMessages()
      }
    });
  }

  join(input: JoinLobbyRequest, socketId: string): RoomActionResult<PlayerSession> {
    if (this.phase !== "lobby") return failures.gameAlreadyStarted();
    if (input.roomCode !== this.roomCode || input.joinToken !== this.joinToken) {
      return failures.invalidCredentials();
    }
    if (this.players.some((player) => player.socketId === socketId)) return failures.alreadyJoined();

    const nickname = nicknameSchema.parse(input.nickname);
    if (this.players.some((player) => player.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase())) {
      return failures.nicknameTaken();
    }

    const reconnectToken = createReconnectToken();
    const player: InternalPlayer = {
      id: randomUUID(),
      number: this.players.length + 1,
      nickname,
      connection: "online",
      controller: "human",
      botKind: null,
      botProfileId: null,
      socketId,
      reconnectTokenHash: hashReconnectToken(reconnectToken),
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
    this.players.push(player);
    this.revision += 1;
    return { ok: true, data: this.createSession(player.id, reconnectToken) };
  }

  addBot(request: HostAddBotRequest): RoomActionResult<HostLobbyView>;
  addBot(nickname: string, botKind: "deterministic"): RoomActionResult<HostLobbyView>;
  addBot(
    requestOrNickname: HostAddBotRequest | string,
    legacyBotKind?: "deterministic"
  ): RoomActionResult<HostLobbyView> {
    if (this.phase !== "lobby") return failures.gameAlreadyStarted();
    const request = hostAddBotRequestSchema.parse(
      typeof requestOrNickname === "string"
        ? { nickname: requestOrNickname, botKind: legacyBotKind }
        : requestOrNickname
    );
    const nickname = nicknameSchema.parse(request.nickname);
    const botKind = botKindSchema.parse(request.botKind);
    if (this.players.some((player) => player.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase())) {
      return failures.nicknameTaken();
    }

    this.players.push({
      id: randomUUID(),
      number: this.players.length + 1,
      nickname,
      connection: "online",
      controller: "bot",
      botKind,
      botProfileId: request.botKind === "llm" ? request.botProfileId : null,
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
    });
    this.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  reconnect(input: ReconnectPlayerRequest, socketId: string): RoomActionResult<ReconnectOutcome> {
    const player = this.players.find((candidate) => candidate.id === input.playerId);
    if (
      input.roomCode !== this.roomCode
      || !player
      || player.controller === "bot"
      || player.connection === "departed"
      || !tokenMatches(input.reconnectToken, player.reconnectTokenHash)
    ) {
      return failures.invalidReconnectCredentials();
    }
    if (this.players.some((candidate) => candidate.id !== player.id && candidate.socketId === socketId)) {
      return failures.alreadyJoined();
    }

    const replacedSocketId = player.socketId && player.socketId !== socketId ? player.socketId : null;
    player.socketId = socketId;
    player.connection = "online";
    this.revision += 1;
    return {
      ok: true,
      data: {
        session: this.createSession(player.id, input.reconnectToken),
        replacedSocketId
      }
    };
  }

  setReconnecting(socketId: string): PlayerId | null {
    const player = this.players.find((candidate) => candidate.socketId === socketId);
    if (!player || player.connection !== "online") return null;
    player.connection = "reconnecting";
    this.revision += 1;
    return player.id;
  }

  setOffline(playerId: PlayerId, disconnectedSocketId: string): boolean {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player || player.socketId !== disconnectedSocketId || player.connection !== "reconnecting") return false;
    player.socketId = null;
    player.connection = "offline";
    this.revision += 1;
    return true;
  }

  requestTakeover(input: TakeoverPlayerRequest, socketId: string, now = new Date()): RoomActionResult<TakeoverReceipt> {
    if (this.phase !== "lobby") return failures.gameAlreadyStarted();
    if (input.roomCode !== this.roomCode || input.joinToken !== this.joinToken) {
      return failures.invalidCredentials();
    }
    if (
      this.players.some((player) => player.socketId === socketId)
      || this.takeoverRequests.some((request) => request.socketId === socketId)
    ) return failures.alreadyJoined();

    const nickname = nicknameSchema.parse(input.nickname);
    const player = this.players.find(
      (candidate) => candidate.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase()
    );
    if (!player || player.controller === "bot" || player.connection === "departed") {
      return failures.playerNotFound();
    }
    if (this.takeoverRequests.some((request) => request.playerId === player.id)) {
      return failures.takeoverAlreadyPending();
    }

    const request: InternalTakeoverRequest = {
      id: randomUUID(),
      playerId: player.id,
      nickname: player.nickname,
      requestedAt: now.toISOString(),
      socketId
    };
    this.takeoverRequests.push(request);
    this.revision += 1;
    return { ok: true, data: { requestId: request.id, nickname: request.nickname } };
  }

  reattachTakeoverRequest(
    requestId: string,
    input: TakeoverPlayerRequest,
    socketId: string
  ): RoomActionResult<TakeoverReceipt> {
    if (this.phase !== "lobby") return failures.gameAlreadyStarted();
    if (input.roomCode !== this.roomCode || input.joinToken !== this.joinToken) {
      return failures.invalidCredentials();
    }
    if (this.players.some((player) => player.socketId === socketId)) {
      return failures.alreadyJoined();
    }
    if (this.takeoverRequests.some((request) => request.socketId === socketId && request.id !== requestId)) {
      return failures.alreadyJoined();
    }

    const request = this.takeoverRequests.find((candidate) => candidate.id === requestId);
    if (!request) return failures.takeoverRequestNotFound();

    const player = this.players.find((candidate) => candidate.id === request.playerId);
    if (!player || player.controller === "bot" || player.connection === "departed") {
      return failures.playerNotFound();
    }
    if (player.nickname.toLocaleLowerCase() !== input.nickname.toLocaleLowerCase()) {
      return failures.invalidCredentials();
    }

    if (request.socketId !== socketId) {
      request.socketId = socketId;
      this.revision += 1;
    }
    return { ok: true, data: { requestId: request.id, nickname: request.nickname } };
  }

  resolveTakeover(requestId: string, approved: boolean): RoomActionResult<TakeoverResolution> {
    const index = this.takeoverRequests.findIndex((request) => request.id === requestId);
    if (index < 0) return failures.takeoverRequestNotFound();
    const pendingRequest = this.takeoverRequests[index]!;
    if (approved && this.players.some(
      (candidate) => candidate.id !== pendingRequest.playerId && candidate.socketId === pendingRequest.socketId
    )) return failures.alreadyJoined();
    const [request] = this.takeoverRequests.splice(index, 1);
    const player = this.players.find((candidate) => candidate.id === request!.playerId);
    if (!player || player.connection === "departed") return failures.playerNotFound();

    let session: PlayerSession | null = null;
    let replacedSocketId: string | null = null;
    if (approved) {
      const reconnectToken = createReconnectToken();
      replacedSocketId = player.socketId && player.socketId !== request!.socketId ? player.socketId : null;
      player.reconnectTokenHash = hashReconnectToken(reconnectToken);
      player.socketId = request!.socketId;
      player.connection = "online";
      session = this.createSession(player.id, reconnectToken);
    }

    this.revision += 1;
    return {
      ok: true,
      data: {
        view: this.getHostView(),
        approved,
        requestSocketId: request!.socketId,
        replacedSocketId,
        session
      }
    };
  }

  cancelTakeoverRequests(socketId: string, preservedRequestId: string | null = null): boolean {
    const previousLength = this.takeoverRequests.length;
    this.takeoverRequests = this.takeoverRequests.filter((request) => (
      request.socketId !== socketId || request.id === preservedRequestId
    ));
    if (this.takeoverRequests.length === previousLength) return false;
    this.revision += 1;
    return true;
  }

  movePlayer(playerId: PlayerId, direction: "up" | "down"): RoomActionResult<HostLobbyView> {
    if (this.phase !== "lobby") return failures.gameAlreadyStarted();
    const index = this.players.findIndex((player) => player.id === playerId);
    if (index < 0) return failures.playerNotFound();

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= this.players.length) {
      return { ok: true, data: this.getHostView() };
    }

    const current = this.players[index]!;
    const target = this.players[targetIndex]!;
    this.players[index] = target;
    this.players[targetIndex] = current;
    this.renumberPlayers();
    this.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  updateRoleConfiguration(configuration: RoleConfigurationInput): RoomActionResult<HostLobbyView> {
    if (this.phase !== "lobby") return failures.gameAlreadyStarted();
    this.roleConfiguration = roleConfigurationSchema.parse(configuration);
    this.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  updateChatMode(chatMode: ChatMode): RoomActionResult<HostLobbyView> {
    if (this.phase !== "lobby") return failures.gameAlreadyStarted();
    this.chatMode = chatModeSchema.parse(chatMode);
    this.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  removePlayer(playerId: PlayerId): RoomActionResult<{ view: HostLobbyView; socketId: string }> {
    if (this.phase !== "lobby") return failures.gameAlreadyStarted();
    const index = this.players.findIndex((player) => player.id === playerId);
    if (index < 0) return failures.playerNotFound();

    const [removed] = this.players.splice(index, 1);
    this.takeoverRequests = this.takeoverRequests.filter((request) => request.playerId !== playerId);
    this.renumberPlayers();
    this.revision += 1;
    return { ok: true, data: { view: this.getHostView(), socketId: removed!.socketId ?? "" } };
  }

  markPlayerDeparted(playerId: PlayerId): RoomActionResult<PlayerDeparture> {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player) return failures.playerNotFound();
    if (player.connection === "departed") return failures.playerAlreadyDeparted();

    const socketId = player.socketId;
    const takeoverSocketIds = this.takeoverRequests
      .filter((request) => request.playerId === playerId)
      .map((request) => request.socketId);
    this.takeoverRequests = this.takeoverRequests.filter((request) => request.playerId !== playerId);
    player.socketId = null;
    player.connection = "departed";
    this.advanceAfterRoleConfirmation();
    if (this.phase !== "lobby" && this.phase !== "game-over") {
      this.reconcileUnavailablePlayer(playerId);
      this.evaluateWinner();
    }
    this.revision += 1;

    const publicPlayer = this.getHostView().players.find((candidate) => candidate.id === playerId)!;
    return {
      ok: true,
      data: {
        view: this.getHostView(),
        player: publicPlayer,
        socketId,
        takeoverSocketIds
      }
    };
  }

  correctPlayerLife(playerId: PlayerId, alive: boolean): RoomActionResult<{ view: HostLobbyView; player: LobbyPlayer }> {
    if (this.phase === "lobby" || this.phase === "game-over") return failures.invalidPhaseControl();
    if (this.pendingHunterResolution) return failures.invalidPhaseControl();
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player) return failures.playerNotFound();
    if (player.connection === "departed") return failures.playerAlreadyDeparted();

    player.alive = alive;
    if (!alive) {
      player.wolfVoteTarget = null;
      player.wolfVoteConfirmed = false;
      player.dayVoteTarget = null;
      player.dayVoteConfirmed = false;
    }

    if (!alive) this.reconcileUnavailablePlayer(playerId);
    this.evaluateWinner();
    this.revision += 1;

    const publicPlayer = this.publicPlayers().find((candidate) => candidate.id === playerId)!;
    return { ok: true, data: { view: this.getHostView(), player: publicPlayer } };
  }

  refreshJoinToken(): HostLobbyView {
    this.joinToken = createJoinToken();
    this.revision += 1;
    return this.getHostView();
  }

  startGame(now = new Date()): RoomActionResult<HostLobbyView> {
    if (this.phase !== "lobby") return failures.gameAlreadyStarted();
    const participants = this.players.filter((player) => player.connection !== "departed");
    const readiness = evaluateStartReadiness(this.roleConfiguration, participants.length);
    if (!readiness.ready) return failures.gameNotReady();

    const gameSessionId = randomUUID();
    const gameSessionStartedAt = now.toISOString();
    this.chatPersistence?.createSession({
      id: gameSessionId,
      roomCode: this.roomCode,
      startedAt: gameSessionStartedAt,
      roleConfiguration: { ...this.roleConfiguration },
      chatMode: this.chatMode
    });

    const roles = roleSchema.array().parse(Object.entries(this.roleConfiguration)
      .flatMap(([role, count]) => Array.from({ length: count }, () => role)));
    for (let index = roles.length - 1; index > 0; index -= 1) {
      const target = randomInt(index + 1);
      [roles[index], roles[target]] = [roles[target]!, roles[index]!];
    }
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
    this.takeoverRequests = [];
    this.joinToken = createJoinToken();
    this.phase = "role-reveal";
    this.nightStage = "wolf";
    this.wolfVoteLocked = false;
    this.wolfAttackTargetId = null;
    this.witchActionSubmitted = false;
    this.dawnDeathIds = [];
    this.chatMessages = [];
    this.chatSequence = 0;
    this.gameSessionId = gameSessionId;
    this.gameSessionStartedAt = gameSessionStartedAt;
    this.speechOrderIds = [];
    this.currentSpeakerIndex = -1;
    this.dayVoteResult = null;
    this.exiledPlayerId = null;
    this.currentSpeakerFinished = false;
    this.pendingWitchAction = null;
    this.guardTargetId = null;
    this.lastGuardTargetId = null;
    this.guardActionSubmitted = false;
    this.pendingHunterResolution = null;
    this.hunterShotPlayerId = null;
    this.hunterActionSubmitted = false;
    this.revealedIdiotId = null;
    this.gameRecords = [];
    this.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  confirmRole(playerId: PlayerId): RoomActionResult<PlayerLobbyView> {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player || player.connection === "departed") return failures.playerNotFound();
    if (this.phase !== "role-reveal" || !player.role) return failures.invalidCredentials();
    if (player.roleConfirmed) return failures.roleAlreadyConfirmed();

    player.roleConfirmed = true;
    this.revision += 1;
    this.advanceAfterRoleConfirmation();
    return { ok: true, data: this.getPlayerView(playerId)! };
  }

  selectWolfTarget(playerId: PlayerId, target: WolfVoteTarget): RoomActionResult<PlayerLobbyView> {
    const player = this.getActiveWolf(playerId);
    if (!player) return failures.invalidNightAction();
    if (this.wolfVoteLocked) return failures.nightActionLocked();
    if (target !== null && target !== "no-kill" && !this.players.some(
      (candidate) => candidate.id === target && candidate.alive && candidate.connection !== "departed"
    )) return failures.playerNotFound();

    player.wolfVoteTarget = target;
    player.wolfVoteConfirmed = false;
    this.revision += 1;
    return { ok: true, data: this.getPlayerView(playerId)! };
  }

  confirmWolfVote(playerId: PlayerId, confirmed: boolean): RoomActionResult<PlayerLobbyView> {
    const player = this.getActiveWolf(playerId);
    if (!player) return failures.invalidNightAction();
    if (this.wolfVoteLocked) return failures.nightActionLocked();
    if (confirmed && player.wolfVoteTarget === null) return failures.invalidNightAction();

    player.wolfVoteConfirmed = confirmed;
    if (this.lockWolfVoteIfComplete() && !this.deferCompletedStages) this.advanceFromWolfStage();
    this.revision += 1;
    return { ok: true, data: this.getPlayerView(playerId)! };
  }

  sendWolfMessage(
    playerId: PlayerId,
    input: WolfSendMessageRequest,
    now = new Date()
  ): RoomActionResult<PlayerLobbyView> {
    const content = input.kind === "target-suggestion"
      ? { kind: input.kind, target: input.target } as const
      : input;
    const result = this.sendChat(playerId, { channel: "wolf-private", content }, now);
    if (!result.ok) return result;
    return { ok: true, data: this.getPlayerView(playerId)! };
  }

  sendChat(
    playerId: PlayerId,
    input: ChatSendRequest,
    now = new Date()
  ): RoomActionResult<ChatMessage> {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player || player.connection === "departed") return failures.playerNotFound();
    if (input.channel === "wolf-private") {
      if (!this.getActiveWolf(playerId) || this.wolfVoteLocked) return failures.invalidNightAction();
    } else if (!this.canSendPublicChat(player)) {
      return failures.invalidPhaseControl();
    }
    if (player.lastChatMessageAtMs !== null && now.getTime() - player.lastChatMessageAtMs < 1_000) {
      return failures.chatRateLimited();
    }

    let content: ChatMessage["content"];
    if ("target" in input.content) {
      const targetId = input.content.target;
      const target = this.toNightCandidate(targetId);
      if (!target || !this.players.some(
        (candidate) => candidate.id === targetId && candidate.connection !== "departed"
      )) return failures.playerNotFound();
      content = { kind: "target-suggestion", target };
    } else {
      content = input.content;
    }

    const nextSequence = this.chatSequence + 1;
    const message: ChatMessage = {
      id: randomUUID(),
      sequence: nextSequence,
      channel: input.channel,
      day: this.dayNumber,
      phase: this.phase,
      sender: {
        kind: "player",
        id: player.id,
        number: player.number,
        nickname: player.nickname
      },
      content,
      createdAt: now.toISOString()
    };
    if (!this.gameSessionId) return failures.invalidPhaseControl();
    this.chatPersistence?.appendMessage(this.gameSessionId, message);
    this.chatSequence = nextSequence;
    this.chatMessages.push(message);
    this.chatMessages = this.chatMessages.slice(-300);
    player.lastChatMessageAtMs = now.getTime();
    this.revision += 1;
    return { ok: true, data: message };
  }

  getChatRecipientIds(channel: ChatChannel): PlayerId[] {
    if (channel === "day-public" || channel === "system") return this.getPlayerIds();
    return this.players
      .filter((player) => player.role === "wolf" && player.alive && player.connection !== "departed")
      .map((player) => player.id);
  }

  inspectAsSeer(playerId: PlayerId, targetId: PlayerId): RoomActionResult<PlayerLobbyView> {
    const player = this.players.find((candidate) => candidate.id === playerId);
    const target = this.players.find((candidate) => candidate.id === targetId);
    if (
      this.phase !== "first-night"
      || this.nightStage !== "seer"
      || player?.role !== "seer"
      || !player.alive
      || player.connection === "departed"
    ) return failures.invalidNightAction();
    if (!target || !target.alive || target.connection === "departed") return failures.playerNotFound();
    if (target.id === player.id) return failures.invalidNightAction();
    if (player.seerInspectedPlayerId) return failures.nightActionLocked();

    player.seerInspectedPlayerId = target.id;
    this.recordGameEvent(
      "seer-inspection",
      `${player.number} 号${player.nickname}查验 ${target.number} 号${target.nickname}：${target.role === "wolf" ? "狼人" : "好人"}`
    );
    if (!this.deferCompletedStages) this.advanceFromSeerStage();
    this.revision += 1;
    return { ok: true, data: this.getPlayerView(playerId)! };
  }

  protectAsGuard(playerId: PlayerId, targetId: PlayerId | null): RoomActionResult<PlayerLobbyView> {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (
      this.phase !== "first-night"
      || this.nightStage !== "guard"
      || player?.role !== "guard"
      || !player.alive
      || player.connection === "departed"
    ) return failures.invalidNightAction();
    if (this.guardActionSubmitted) return failures.nightActionLocked();

    if (targetId !== null) {
      const target = this.players.find((candidate) => candidate.id === targetId);
      if (!target || !target.alive || target.connection === "departed") return failures.playerNotFound();
      if (target.id === this.lastGuardTargetId) return failures.invalidNightAction();
    }

    this.guardTargetId = targetId;
    this.guardActionSubmitted = true;
    const target = targetId ? this.toNightCandidate(targetId) : null;
    this.recordGameEvent(
      "guard-action",
      target
        ? `${player.number} 号 ${player.nickname} 守护 ${target.number} 号 ${target.nickname}`
        : `${player.number} 号 ${player.nickname} 选择空守`
    );
    if (!this.deferCompletedStages) this.advanceFromGuardStage();
    this.revision += 1;
    return { ok: true, data: this.getPlayerView(playerId)! };
  }

  submitWitchAction(playerId: PlayerId, input: WitchSubmitActionRequest): RoomActionResult<PlayerLobbyView> {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (
      this.phase !== "first-night"
      || this.nightStage !== "witch"
      || player?.role !== "witch"
      || !player.alive
      || player.connection === "departed"
    ) return failures.invalidNightAction();
    if (this.witchActionSubmitted) return failures.nightActionLocked();

    let poisonTargetId: PlayerId | null = null;
    let saved = false;
    if (input.action === "save") {
      if (
        !player.witchAntidoteAvailable
        || !this.wolfAttackTargetId
        || (this.wolfAttackTargetId === player.id && this.dayNumber > 1)
      ) return failures.invalidNightAction();
      player.witchAntidoteAvailable = false;
      saved = true;
    }
    if (input.action === "poison") {
      const target = this.players.find((candidate) => candidate.id === input.target);
      if (
        !player.witchPoisonAvailable
        || !target
        || !target.alive
        || target.connection === "departed"
        || target.id === player.id
      ) return failures.invalidNightAction();
      player.witchPoisonAvailable = false;
      poisonTargetId = target.id;
    }

    this.recordGameEvent(
      "witch-action",
      input.action === "save"
        ? `${player.number} 号${player.nickname}使用解药`
        : input.action === "poison"
          ? `${player.number} 号${player.nickname}对 ${this.toNightCandidate(poisonTargetId!)!.number} 号${this.toNightCandidate(poisonTargetId!)!.nickname}使用毒药`
          : `${player.number} 号${player.nickname}未使用药物`
    );

    this.witchActionSubmitted = true;
    this.pendingWitchAction = { saved, poisonTargetId };
    if (!this.deferCompletedStages) this.settleFirstNight(saved, poisonTargetId);
    this.revision += 1;
    return { ok: true, data: this.getPlayerView(playerId)! };
  }

  shootAsHunter(playerId: PlayerId, targetId: PlayerId | null): RoomActionResult<PlayerLobbyView> {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player || this.pendingHunterResolution?.hunterId !== player.id || this.hunterActionSubmitted) {
      return failures.invalidNightAction();
    }
    let target: InternalPlayer | null = null;
    if (targetId !== null) {
      target = this.players.find((candidate) => candidate.id === targetId) ?? null;
      if (!target || !target.alive || target.connection === "departed" || target.id === player.id) {
        return failures.playerNotFound();
      }
      target.alive = false;
      if (this.pendingHunterResolution.origin === "night" && !this.dawnDeathIds.includes(target.id)) {
        this.dawnDeathIds.push(target.id);
        this.dawnDeathIds.sort((left, right) => this.players.find((item) => item.id === left)!.number
          - this.players.find((item) => item.id === right)!.number);
      }
    }
    this.hunterShotPlayerId = target?.id ?? null;
    this.hunterActionSubmitted = true;
    this.recordGameEvent(
      "hunter-shot",
      target
        ? `${player.number} 号 ${player.nickname} 开枪带走 ${target.number} 号 ${target.nickname}`
        : `${player.number} 号 ${player.nickname} 放弃开枪`
    );
    if (!this.deferCompletedStages) this.completeHunterResolution();
    this.revision += 1;
    return { ok: true, data: this.getPlayerView(playerId)! };
  }

  getNightStage(): "wolf" | "seer" | "guard" | "witch" | null {
    if (this.phase !== "first-night" || this.nightStage === "complete") return null;
    return this.nightStage;
  }

  getTimedStage(): TimedStage | null {
    if (this.pendingHunterResolution) return "hunter";
    return this.getNightStage() ?? (["role-reveal", "dawn", "last-words", "day-speech", "day-vote", "exile-result"].includes(this.phase)
      ? this.phase as TimedStage
      : null);
  }

  getTimedStageKey(): string | null {
    const stage = this.getTimedStage();
    if (!stage) return null;
    if (stage === "last-words" || stage === "day-speech") {
      return `${stage}:${this.speechOrderIds[this.currentSpeakerIndex] ?? "none"}`;
    }
    return stage;
  }

  isCurrentSpeaker(playerId: PlayerId): boolean {
    return (this.phase === "last-words" || this.phase === "day-speech")
      && this.speechOrderIds[this.currentSpeakerIndex] === playerId;
  }

  private canSendPublicChat(player: InternalPlayer): boolean {
    if (player.connection === "departed") return false;
    if (this.phase === "last-words") return this.isCurrentSpeaker(player.id);
    if (this.phase !== "day-speech" || !player.alive) return false;
    return this.chatMode === "open" || this.isCurrentSpeaker(player.id);
  }

  isTimedStageComplete(): boolean {
    const stage = this.getTimedStage();
    if (!stage) return false;
    if (stage === "role-reveal") {
      const progress = this.getRoleConfirmationProgress();
      return progress.total > 0 && progress.confirmed === progress.total;
    }
    if (stage === "wolf") return this.wolfVoteLocked;
    if (stage === "seer") {
      const seer = this.players.find(
        (player) => player.role === "seer" && player.alive && player.connection !== "departed"
      );
      return !seer || seer.seerInspectedPlayerId !== null;
    }
    if (stage === "guard") return this.guardActionSubmitted;
    if (stage === "witch") return this.witchActionSubmitted;
    if (stage === "hunter") return this.hunterActionSubmitted;
    if (stage === "last-words" || stage === "day-speech") return this.currentSpeakerFinished;
    if (stage === "day-vote") {
      const voters = this.onlineEligibleVoters();
      return voters.length > 0 && voters.every((player) => player.dayVoteConfirmed);
    }
    return true;
  }

  advanceCompletedTimedStage(): RoomActionResult<HostLobbyView> {
    if (!this.isTimedStageComplete()) return failures.invalidPhaseControl();
    return this.advanceTimedStage(false);
  }

  skipCurrentTimedStage(): RoomActionResult<HostLobbyView> {
    if (!this.getTimedStage()) return failures.invalidPhaseControl();
    return this.advanceTimedStage(true);
  }

  skipCurrentNightStage(): RoomActionResult<HostLobbyView> {
    if (this.phase !== "first-night") return failures.invalidNightAction();
    if (this.nightStage === "wolf") {
      this.wolfVoteLocked = true;
      this.advanceFromWolfStage();
    } else if (this.nightStage === "seer") {
      this.advanceFromSeerStage();
    } else if (this.nightStage === "guard") {
      this.guardActionSubmitted = true;
      this.guardTargetId = null;
      this.advanceFromGuardStage();
    } else if (this.nightStage === "witch") {
      this.witchActionSubmitted = true;
      this.settleFirstNight(false, null);
    } else {
      return failures.invalidNightAction();
    }
    this.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  continueFromDawn(): RoomActionResult<HostLobbyView> {
    if (this.phase !== "dawn" || this.pendingHunterResolution) return failures.invalidPhaseControl();
    const lastWords = this.dawnDeathIds.filter((id) => this.players.some(
      (player) => player.id === id && player.connection !== "departed"
    ));
    if (lastWords.length > 0) {
      this.speechOrderIds = lastWords;
      this.currentSpeakerIndex = 0;
      this.phase = "last-words";
    } else {
      this.startDaySpeech();
    }
    this.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  finishSpeaking(playerId: PlayerId): RoomActionResult<PlayerLobbyView> {
    if (this.phase !== "last-words" && this.phase !== "day-speech") return failures.invalidPhaseControl();
    if (this.speechOrderIds[this.currentSpeakerIndex] !== playerId) return failures.invalidPhaseControl();
    if (this.currentSpeakerFinished) return failures.invalidPhaseControl();
    this.advanceSpeaker();
    this.revision += 1;
    return { ok: true, data: this.getPlayerView(playerId)! };
  }

  selectDayVote(playerId: PlayerId, target: DayVoteTarget): RoomActionResult<PlayerLobbyView> {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (this.phase !== "day-vote" || !player?.alive || player.connection === "departed" || player.idiotRevealed) {
      return failures.invalidNightAction();
    }
    if (target !== null && target !== "abstain") {
      const candidate = this.players.find((item) => item.id === target);
      if (!candidate || !candidate.alive || candidate.connection === "departed" || candidate.idiotRevealed) {
        return failures.playerNotFound();
      }
      if (candidate.id === player.id) return failures.invalidNightAction();
    }
    player.dayVoteTarget = target;
    player.dayVoteConfirmed = false;
    this.revision += 1;
    return { ok: true, data: this.getPlayerView(playerId)! };
  }

  confirmDayVote(playerId: PlayerId, confirmed: boolean): RoomActionResult<PlayerLobbyView> {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (this.phase !== "day-vote" || !player?.alive || player.connection === "departed" || player.idiotRevealed) {
      return failures.invalidNightAction();
    }
    if (confirmed && player.dayVoteTarget === null) return failures.invalidNightAction();
    player.dayVoteConfirmed = confirmed;
    if (!this.deferCompletedStages && this.onlineEligibleVoters().every((candidate) => candidate.dayVoteConfirmed)) {
      this.settleDayVote();
    }
    this.revision += 1;
    return { ok: true, data: this.getPlayerView(playerId)! };
  }

  skipCurrentDayStage(): RoomActionResult<HostLobbyView> {
    if (this.phase === "last-words" || this.phase === "day-speech") {
      this.advanceSpeaker();
    } else if (this.phase === "day-vote") {
      this.settleDayVote();
    } else {
      return failures.invalidPhaseControl();
    }
    this.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  continueFromExile(): RoomActionResult<HostLobbyView> {
    if (this.phase !== "exile-result" || this.pendingHunterResolution) return failures.invalidPhaseControl();
    if (this.exiledPlayerId) {
      this.speechOrderIds = [this.exiledPlayerId];
      this.currentSpeakerIndex = 0;
      this.phase = "last-words";
    } else {
      this.startNextNight();
    }
    this.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  getPlayerIds(): PlayerId[] {
    return this.players.map((player) => player.id);
  }

  getBotSeats(): Array<{
    playerId: PlayerId;
    botKind: BotKind;
    botProfileId: LobbyPlayer["botProfileId"];
    lockedConfiguration: BotConfigurationLock;
  }> {
    return this.players.flatMap((player) => player.controller === "bot" && player.botKind
      ? [{
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
        }]
      : []);
  }

  lockBotConfiguration(playerId: PlayerId, lock: Omit<BotConfigurationLock, "locked">): void {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player || player.controller !== "bot" || player.botKind !== "llm") return;
    player.aiConfigurationLocked = true;
    player.aiBotProfileRevision = lock.botProfileRevision;
    player.aiModelProfileId = lock.modelProfileId;
    player.aiModelProfileRevision = lock.modelProfileRevision;
    player.aiModelChainRevision = lock.modelChainRevision;
  }

  getSocketId(playerId: PlayerId): string | null {
    return this.players.find((player) => player.id === playerId)?.socketId ?? null;
  }

  terminateGame(now = new Date()): RoomActionResult<HostLobbyView> {
    if (this.phase === "lobby" || this.phase === "game-over") return failures.invalidPhaseControl();
    this.finishCurrentSession("terminated", now);
    this.gameOutcome = "terminated";
    this.phase = "game-over";
    this.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  recordHostIntervention(detail: string): void {
    if (this.phase === "lobby") return;
    this.recordGameEvent("host-intervention", detail);
  }

  private publicPlayers(): LobbyPlayer[] {
    return this.players.map(({
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
    }) => player);
  }

  private createSession(playerId: PlayerId, reconnectToken: string): PlayerSession {
    return playerSessionSchema.parse({
      credentials: { roomCode: this.roomCode, playerId, reconnectToken },
      lobby: this.getPlayerView(playerId)
    });
  }

  private renumberPlayers(): void {
    this.players.forEach((player, index) => {
      player.number = index + 1;
    });
  }

  private getRoleConfirmationProgress(): { confirmed: number; total: number } {
    const participants = this.players.filter((player) => player.connection !== "departed" && player.role);
    return {
      confirmed: participants.filter((player) => player.roleConfirmed).length,
      total: participants.length
    };
  }

  private advanceAfterRoleConfirmation(): void {
    const progress = this.getRoleConfirmationProgress();
    if (this.phase === "role-reveal" && progress.total > 0 && progress.confirmed === progress.total) {
      if (!this.deferCompletedStages) this.phase = "first-night";
    }
  }

  private getNightProgress(): { stage: "night-action"; confirmed: number; required: number; locked: boolean } | null {
    if (this.phase !== "first-night") return null;
    return {
      stage: "night-action",
      confirmed: 0,
      required: 0,
      locked: false
    };
  }

  private getActiveWolf(playerId: PlayerId): InternalPlayer | null {
    const player = this.players.find((candidate) => candidate.id === playerId);
    return this.phase === "first-night"
      && this.nightStage === "wolf"
      && player?.role === "wolf"
      && player.alive
      && player.connection !== "departed"
      ? player
      : null;
  }

  private lockWolfVoteIfComplete(): boolean {
    const onlineWolves = this.players.filter(
      (player) => player.role === "wolf" && player.alive && player.connection === "online"
    );
    if (onlineWolves.length > 0 && onlineWolves.every((player) => player.wolfVoteConfirmed)) {
      this.wolfVoteLocked = true;
      return true;
    }
    return false;
  }

  private advanceFromWolfStage(): void {
    const votes = this.players
      .filter((player) => player.role === "wolf" && player.wolfVoteConfirmed && player.wolfVoteTarget)
      .map((player) => player.wolfVoteTarget!);
    this.wolfAttackTargetId = resolveWolfAttack(votes);
    this.nightStage = "seer";
    if (!this.players.some((player) => player.role === "seer" && player.alive && player.connection !== "departed")) {
      this.advanceFromSeerStage();
    }
  }

  private advanceFromSeerStage(): void {
    this.nightStage = "guard";
    if (!this.players.some((player) => player.role === "guard" && player.alive && player.connection !== "departed")) {
      this.guardActionSubmitted = true;
      this.guardTargetId = null;
      this.advanceFromGuardStage();
    }
  }

  private advanceFromGuardStage(): void {
    this.nightStage = "witch";
    if (!this.players.some((player) => player.role === "witch" && player.alive && player.connection !== "departed")) {
      this.settleFirstNight(false, null);
    }
  }

  private settleFirstNight(saved: boolean, poisonTargetId: PlayerId | null): void {
    this.dawnDeathIds = resolveNightDeaths(
      this.players,
      this.wolfAttackTargetId,
      saved,
      poisonTargetId,
      this.guardTargetId
    );
    const deaths = new Set(this.dawnDeathIds);
    for (const player of this.players) {
      if (deaths.has(player.id)) player.alive = false;
    }
    if (this.dawnDeathIds.length === 0) {
      this.recordGameEvent("death", "夜间无人死亡");
    } else {
      for (const id of this.dawnDeathIds) {
        const player = this.toNightCandidate(id)!;
        this.recordGameEvent("death", `${player.number} 号${player.nickname}夜间死亡`);
      }
    }
    this.nightStage = "complete";
    this.pendingWitchAction = null;
    this.phase = "dawn";
    const hunter = this.players.find((player) => player.role === "hunter" && deaths.has(player.id));
    if (hunter && hunter.id !== poisonTargetId && hunter.connection !== "departed") {
      this.pendingHunterResolution = { hunterId: hunter.id, origin: "night" };
      this.hunterActionSubmitted = false;
      this.hunterShotPlayerId = null;
    } else {
      this.evaluateWinner();
    }
  }

  private toNightCandidate(playerId: PlayerId): { id: PlayerId; number: number; nickname: string } | null {
    const player = this.players.find((candidate) => candidate.id === playerId);
    return player ? { id: player.id, number: player.number, nickname: player.nickname } : null;
  }

  private getChannelMessages(channel: ChatChannel): ChatMessage[] {
    return this.chatMessages.filter((message) => message.channel === channel).slice(-100);
  }

  private getPublicChatMessages(): ChatMessage[] {
    return this.chatMessages
      .filter((message) => message.channel === "day-public" || message.channel === "system")
      .slice(-100);
  }

  private queryInMemoryChatHistory(
    reader: { kind: "host" } | { kind: "player"; canReadWolfPrivate: boolean },
    afterSequence: number,
    limit: number
  ): {
    messages: ChatMessage[];
    latestSequence: number;
    hasMore: boolean;
  } {
    const readable = this.chatMessages.filter((message) => {
      if (message.channel === "day-public" || message.channel === "system") return true;
      return reader.kind === "player" && reader.canReadWolfPrivate;
    });
    const remaining = readable.filter((message) => message.sequence > afterSequence);
    return {
      messages: remaining.slice(0, limit),
      latestSequence: this.chatSequence,
      hasMore: remaining.length > limit
    };
  }

  private getPublicDayState() {
    if (!["dawn", "last-words", "day-speech", "day-vote", "exile-result"].includes(this.phase)) return null;
    const currentId = this.currentSpeakerIndex >= 0 ? this.speechOrderIds[this.currentSpeakerIndex] : null;
    const currentSpeaker = currentId ? this.toNightCandidate(currentId) : null;
    const eligibleVoters = this.onlineEligibleVoters();
    return {
      alivePlayerIds: this.players.filter((player) => player.alive).map((player) => player.id),
      revealedIdiot: this.revealedIdiotId ? this.toNightCandidate(this.revealedIdiotId) : null,
      hunterPending: this.pendingHunterResolution !== null,
      currentSpeaker,
      speechOrder: this.speechOrderIds.flatMap((id) => {
        const candidate = this.toNightCandidate(id);
        return candidate ? [candidate] : [];
      }),
      voteProgress: this.phase === "day-vote" ? {
        confirmed: eligibleVoters.filter((player) => player.dayVoteConfirmed).length,
        total: eligibleVoters.length
      } : null,
      voteResult: this.dayVoteResult ? {
        ballots: this.dayVoteResult.flatMap(({ voterId, targetId }) => {
          const voter = this.toNightCandidate(voterId);
          return voter ? [{ voter, target: targetId ? this.toNightCandidate(targetId) : null }] : [];
        }),
        exiledPlayer: this.exiledPlayerId ? this.toNightCandidate(this.exiledPlayerId) : null
      } : null
    };
  }

  private startDaySpeech(): void {
    const aliveIds = this.players.filter((player) => player.alive && player.connection !== "departed")
      .map((player) => player.id);
    this.speechOrderIds = randomInt(2) === 0 ? aliveIds : [...aliveIds].reverse();
    this.currentSpeakerIndex = this.speechOrderIds.length > 0 ? 0 : -1;
    this.currentSpeakerFinished = false;
    this.phase = this.speechOrderIds.length > 0 ? "day-speech" : "day-vote";
    if (this.phase === "day-vote") this.prepareDayVote();
  }

  private advanceSpeaker(): void {
    this.currentSpeakerIndex += 1;
    this.currentSpeakerFinished = false;
    if (this.currentSpeakerIndex < this.speechOrderIds.length) return;
    if (this.phase === "last-words") {
      if (this.exiledPlayerId && this.speechOrderIds.length === 1) this.startNextNight();
      else this.startDaySpeech();
      return;
    }
    this.prepareDayVote();
  }

  private prepareDayVote(): void {
    this.phase = "day-vote";
    this.currentSpeakerIndex = -1;
    this.currentSpeakerFinished = false;
    for (const player of this.players) {
      player.dayVoteTarget = null;
      player.dayVoteConfirmed = false;
    }
  }

  private settleDayVote(): void {
    const voters = this.players.filter(
      (player) => player.alive && player.connection !== "departed" && !player.idiotRevealed
    );
    this.dayVoteResult = voters.map((player) => ({
      voterId: player.id,
      targetId: player.dayVoteConfirmed && player.dayVoteTarget !== "abstain" ? player.dayVoteTarget : null
    }));
    for (const ballot of this.dayVoteResult) {
      const voter = this.toNightCandidate(ballot.voterId)!;
      const target = ballot.targetId ? this.toNightCandidate(ballot.targetId) : null;
      this.recordGameEvent(
        "day-vote",
        `${voter.number} 号${voter.nickname}投给${target ? ` ${target.number} 号${target.nickname}` : "弃票"}`
      );
    }
    this.exiledPlayerId = resolvePlurality(
      this.dayVoteResult.flatMap((ballot) => ballot.targetId ? [ballot.targetId] : [])
    );
    if (this.exiledPlayerId) {
      const exiled = this.players.find((player) => player.id === this.exiledPlayerId);
      if (exiled) {
        if (exiled.role === "idiot" && !exiled.idiotRevealed) {
          exiled.idiotRevealed = true;
          this.revealedIdiotId = exiled.id;
          this.exiledPlayerId = null;
          this.recordGameEvent("idiot-reveal", `${exiled.number} 号 ${exiled.nickname} 公开白痴身份并免于放逐`);
        } else {
          exiled.alive = false;
          if (exiled.role === "hunter" && exiled.connection !== "departed") {
            this.pendingHunterResolution = { hunterId: exiled.id, origin: "exile" };
            this.hunterActionSubmitted = false;
            this.hunterShotPlayerId = null;
          }
          this.recordGameEvent("death", `${exiled.number} 号${exiled.nickname}被放逐`);
        }
      }
    }
    this.phase = "exile-result";
    if (!this.pendingHunterResolution && this.exiledPlayerId) this.evaluateWinner();
  }

  private onlineAlivePlayers(): InternalPlayer[] {
    return this.players.filter((player) => player.alive && player.connection === "online");
  }

  private onlineEligibleVoters(): InternalPlayer[] {
    return this.onlineAlivePlayers().filter((player) => !player.idiotRevealed);
  }

  private completeHunterResolution(): void {
    const resolution = this.pendingHunterResolution;
    if (!resolution) return;
    this.pendingHunterResolution = null;
    this.evaluateWinner();
  }

  private startNextNight(): void {
    this.dayNumber += 1;
    this.phase = "first-night";
    this.nightStage = "wolf";
    this.wolfVoteLocked = false;
    this.wolfAttackTargetId = null;
    this.witchActionSubmitted = false;
    this.dawnDeathIds = [];
    this.speechOrderIds = [];
    this.currentSpeakerIndex = -1;
    this.dayVoteResult = null;
    this.exiledPlayerId = null;
    this.currentSpeakerFinished = false;
    this.pendingWitchAction = null;
    this.lastGuardTargetId = this.guardTargetId;
    this.guardTargetId = null;
    this.guardActionSubmitted = false;
    this.pendingHunterResolution = null;
    this.hunterShotPlayerId = null;
    this.hunterActionSubmitted = false;
    for (const player of this.players) {
      player.wolfVoteTarget = null;
      player.wolfVoteConfirmed = false;
      player.seerInspectedPlayerId = null;
      player.lastChatMessageAtMs = null;
      player.dayVoteTarget = null;
      player.dayVoteConfirmed = false;
    }
  }

  playAgain(): RoomActionResult<HostLobbyView> {
    if (this.phase !== "game-over") return failures.invalidPhaseControl();
    this.players = this.players.filter((player) => player.connection !== "departed");
    for (const player of this.players) {
      player.alive = true;
      player.role = null;
      player.roleConfirmed = false;
      player.witchAntidoteAvailable = true;
      player.witchPoisonAvailable = true;
    }
    this.resetGameState();
    this.phase = "lobby";
    return this.startGame();
  }

  returnToLobby(): RoomActionResult<HostLobbyView> {
    if (this.phase !== "game-over") return failures.invalidPhaseControl();
    this.players = this.players.filter((player) => player.connection !== "departed");
    this.renumberPlayers();
    for (const player of this.players) {
      player.alive = true;
      player.role = null;
      player.roleConfirmed = false;
    }
    this.resetGameState();
    this.phase = "lobby";
    this.joinToken = createJoinToken();
    this.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  private evaluateWinner(): void {
    if (this.gameOutcome) return;
    const outcome = evaluateGameOutcome(this.players);
    if (!outcome) return;
    this.finishCurrentSession(outcome, new Date());
    this.gameOutcome = outcome;
    this.phase = "game-over";
  }

  private finishCurrentSession(
    outcome: "good-win" | "wolf-win" | "draw" | "terminated",
    now: Date
  ): void {
    if (!this.gameSessionId) return;
    this.chatPersistence?.finishSession(this.gameSessionId, {
      outcome,
      endedAt: now.toISOString()
    });
  }

  private getGameResult() {
    if (this.phase !== "game-over" || !this.gameOutcome) return null;
    return {
      outcome: this.gameOutcome,
      revealedPlayers: this.players.flatMap((player) => player.role ? [{
        id: player.id,
        number: player.number,
        nickname: player.nickname,
        role: player.role,
        alive: player.alive
      }] : []),
      records: this.gameRecords.map((record) => ({ ...record }))
    };
  }

  private resetGameState(): void {
    this.dayNumber = 1;
    this.nightStage = "wolf";
    this.wolfVoteLocked = false;
    this.wolfAttackTargetId = null;
    this.witchActionSubmitted = false;
    this.dawnDeathIds = [];
    this.chatMessages = [];
    this.chatSequence = 0;
    this.gameSessionId = null;
    this.gameSessionStartedAt = null;
    this.speechOrderIds = [];
    this.currentSpeakerIndex = -1;
    this.dayVoteResult = null;
    this.exiledPlayerId = null;
    this.currentSpeakerFinished = false;
    this.pendingWitchAction = null;
    this.guardTargetId = null;
    this.lastGuardTargetId = null;
    this.guardActionSubmitted = false;
    this.pendingHunterResolution = null;
    this.hunterShotPlayerId = null;
    this.hunterActionSubmitted = false;
    this.revealedIdiotId = null;
    this.gameOutcome = null;
    this.gameRecords = [];
    for (const player of this.players) {
      player.wolfVoteTarget = null;
      player.wolfVoteConfirmed = false;
      player.seerInspectedPlayerId = null;
      player.lastChatMessageAtMs = null;
      player.dayVoteTarget = null;
      player.dayVoteConfirmed = false;
      player.idiotRevealed = false;
    }
  }

  private recordGameEvent(type: GameRecord["type"], detail: string): void {
    this.gameRecords.push({ type, day: this.dayNumber, detail });
  }

  private restoreSnapshot(snapshot: LobbyRoomSnapshot): void {
    if (![1, 2, 3].includes(snapshot.version)) throw new Error("unsupported room snapshot version");
    this.revision = snapshot.revision;
    this.phase = snapshot.phase;
    this.nightStage = snapshot.nightStage;
    this.wolfVoteLocked = snapshot.wolfVoteLocked;
    this.wolfAttackTargetId = snapshot.wolfAttackTargetId;
    this.witchActionSubmitted = snapshot.witchActionSubmitted;
    this.dawnDeathIds = [...snapshot.dawnDeathIds];
    this.roleConfiguration = roleConfigurationSchema.parse(snapshot.roleConfiguration);
    this.chatMode = chatModeSchema.parse(snapshot.chatMode);
    const snapshotMessages = snapshot.chatMessages?.map((message) => ({ ...message })) ?? (
      snapshot.wolfMessages?.map((message, index) => ({
        id: message.id,
        sequence: index + 1,
        channel: "wolf-private" as const,
        day: snapshot.dayNumber,
        phase: "first-night" as const,
        sender: { kind: "player" as const, ...message.sender },
        content: message.kind === "target-suggestion" && message.target
          ? { kind: "target-suggestion" as const, target: message.target }
          : message.kind === "quick"
            ? {
                kind: "quick" as const,
                code: message.text === "赞同"
                  ? "agree" as const
                  : message.text === "反对"
                    ? "disagree" as const
                    : "no-kill" as const
              }
            : { kind: "text" as const, text: message.text },
        createdAt: message.createdAt
      })) ?? []
    );
    this.gameSessionId = snapshot.gameSessionId
      ?? (snapshot.phase === "lobby" ? null : randomUUID());
    const existingSession = this.gameSessionId
      ? this.chatPersistence?.getSession?.(this.gameSessionId) ?? null
      : null;
    this.gameSessionStartedAt = snapshot.gameSessionStartedAt
      ?? existingSession?.startedAt
      ?? snapshotMessages[0]?.createdAt
      ?? (this.gameSessionId ? new Date().toISOString() : null);
    if (this.chatPersistence && this.gameSessionId) {
      this.chatPersistence.createSession({
        id: this.gameSessionId,
        roomCode: snapshot.roomCode,
        startedAt: this.gameSessionStartedAt!,
        roleConfiguration: { ...this.roleConfiguration },
        chatMode: this.chatMode
      });
      if (snapshotMessages.length > 0) {
        this.chatPersistence.importMessages(this.gameSessionId, snapshotMessages);
      }
      this.chatMessages = this.chatPersistence.loadRecentForRecovery(this.gameSessionId, 300);
      if (snapshot.gameOutcome) {
        this.chatPersistence.finishSession(this.gameSessionId, {
          outcome: snapshot.gameOutcome,
          endedAt: new Date().toISOString()
        });
      }
    } else {
      this.chatMessages = snapshotMessages;
    }
    this.chatSequence = Math.max(
      snapshot.chatSequence ?? 0,
      this.chatMessages.reduce((maximum, message) => Math.max(maximum, message.sequence), 0)
    );
    this.speechOrderIds = [...snapshot.speechOrderIds];
    this.currentSpeakerIndex = snapshot.currentSpeakerIndex;
    this.dayVoteResult = snapshot.dayVoteResult?.map((ballot) => ({ ...ballot })) ?? null;
    this.exiledPlayerId = snapshot.exiledPlayerId;
    this.currentSpeakerFinished = snapshot.currentSpeakerFinished ?? false;
    this.pendingWitchAction = snapshot.pendingWitchAction ? { ...snapshot.pendingWitchAction } : null;
    this.guardTargetId = snapshot.guardTargetId ?? null;
    this.lastGuardTargetId = snapshot.lastGuardTargetId ?? null;
    this.guardActionSubmitted = snapshot.guardActionSubmitted ?? false;
    this.pendingHunterResolution = snapshot.pendingHunterResolution
      ? { ...snapshot.pendingHunterResolution }
      : null;
    this.hunterShotPlayerId = snapshot.hunterShotPlayerId ?? null;
    this.hunterActionSubmitted = snapshot.hunterActionSubmitted ?? false;
    this.revealedIdiotId = snapshot.revealedIdiotId ?? null;
    this.dayNumber = snapshot.dayNumber;
    this.gameOutcome = snapshot.gameOutcome;
    this.gameRecords = snapshot.gameRecords.map((record) => ({ ...record }));
    this.players = snapshot.players.map(({ lastWolfMessageAtMs, ...player }) => {
      const controller = player.controller ?? "human";
      return {
        ...player,
        controller,
        botKind: controller === "bot" ? player.botKind ?? "deterministic" : null,
        botProfileId: controller === "bot" && player.botKind === "llm"
          ? player.botProfileId ?? null
          : null,
        aiConfigurationLocked: player.aiConfigurationLocked ?? false,
        aiBotProfileRevision: player.aiBotProfileRevision ?? null,
        aiModelProfileId: player.aiModelProfileId ?? null,
        aiModelProfileRevision: player.aiModelProfileRevision ?? null,
        aiModelChainRevision: player.aiModelChainRevision ?? null,
        lastChatMessageAtMs: player.lastChatMessageAtMs ?? lastWolfMessageAtMs ?? null,
        idiotRevealed: player.idiotRevealed ?? false,
        socketId: null,
        connection: player.connection === "departed"
          ? "departed"
          : controller === "bot" ? "online" : "offline",
        reconnectTokenHash: Buffer.from(player.reconnectTokenHash, "base64")
      };
    });
  }

  private reconcileUnavailablePlayer(playerId: PlayerId): void {
    if (this.isCurrentSpeaker(playerId)) this.advanceSpeaker();
    if (this.phase === "first-night") {
      const unavailablePlayer = this.players.find((player) => player.id === playerId);
      if (unavailablePlayer?.role === "guard") this.guardTargetId = null;
      if (this.nightStage === "wolf") {
        const activeWolves = this.players.filter(
          (candidate) => candidate.role === "wolf" && candidate.alive && candidate.connection !== "departed"
        );
        if (activeWolves.length === 0 || this.lockWolfVoteIfComplete()) {
          this.wolfVoteLocked = true;
          this.advanceFromWolfStage();
        }
      } else if (this.nightStage === "seer" && !this.players.some(
        (candidate) => candidate.role === "seer" && candidate.alive && candidate.connection !== "departed"
      )) {
        this.advanceFromSeerStage();
      } else if (this.nightStage === "guard" && !this.players.some(
        (candidate) => candidate.role === "guard" && candidate.alive && candidate.connection !== "departed"
      )) {
        this.guardActionSubmitted = true;
        this.guardTargetId = null;
        this.advanceFromGuardStage();
      } else if (this.nightStage === "witch" && !this.players.some(
        (candidate) => candidate.role === "witch" && candidate.alive && candidate.connection !== "departed"
      )) {
        this.witchActionSubmitted = true;
        this.settleFirstNight(false, null);
      }
    }
    if (this.pendingHunterResolution?.hunterId === playerId) {
      this.hunterActionSubmitted = true;
      this.hunterShotPlayerId = null;
      this.recordGameEvent("hunter-shot", "猎人离场，视为放弃开枪");
      this.completeHunterResolution();
    }
    if (!this.deferCompletedStages && this.phase === "day-vote" && this.onlineEligibleVoters().every((candidate) => candidate.dayVoteConfirmed)) {
      this.settleDayVote();
    }
  }

  private advanceTimedStage(skipped: boolean): RoomActionResult<HostLobbyView> {
    const stage = this.getTimedStage();
    if (!stage) return failures.invalidPhaseControl();

    if (stage === "role-reveal") {
      this.phase = "first-night";
    } else if (stage === "wolf") {
      if (skipped) this.wolfVoteLocked = true;
      this.advanceFromWolfStage();
    } else if (stage === "seer") {
      this.advanceFromSeerStage();
    } else if (stage === "guard") {
      this.guardActionSubmitted = true;
      if (skipped) this.guardTargetId = null;
      this.advanceFromGuardStage();
    } else if (stage === "witch") {
      const action = skipped ? { saved: false, poisonTargetId: null } : this.pendingWitchAction;
      this.witchActionSubmitted = true;
      this.settleFirstNight(action?.saved ?? false, action?.poisonTargetId ?? null);
    } else if (stage === "hunter") {
      this.hunterActionSubmitted = true;
      this.hunterShotPlayerId = null;
      this.recordGameEvent("hunter-shot", "猎人放弃开枪");
      this.completeHunterResolution();
    } else if (stage === "dawn") {
      const result = this.continueFromDawn();
      if (!result.ok) return result;
      return result;
    } else if (stage === "last-words" || stage === "day-speech") {
      this.advanceSpeaker();
    } else if (stage === "day-vote") {
      this.settleDayVote();
    } else {
      const result = this.continueFromExile();
      if (!result.ok) return result;
      return result;
    }

    this.revision += 1;
    return { ok: true, data: this.getHostView() };
  }
}
