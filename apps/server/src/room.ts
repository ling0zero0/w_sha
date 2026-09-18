export type {
  BotConfigurationLock,
  ChatHistoryReader,
  LobbyRoomSnapshot,
  PlayerDeparture,
  ReconnectOutcome,
  RoomChatPersistence,
  TakeoverResolution,
  TimedStage
} from "./room/state.js";

import {
  botKindSchema,
  chatModeSchema,
  hostAddBotRequestSchema,
  nicknameSchema,
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
  type RoleConfigurationInput,
  type RoomActionResult,
  type TakeoverPlayerRequest,
  type TakeoverReceipt,
  type DayVoteTarget,
  type WitchSubmitActionRequest,
  type WolfChatMessage,
  type WolfSendMessageRequest,
  type WolfVoteTarget
} from "@werewolf/shared";
import { randomInt, randomUUID } from "node:crypto";
import { getChatHistory, sendChat } from "./room/chat.js";
import { advanceSpeaker, continueFromDawn, continueFromExile, isCurrentSpeaker } from "./room/day-procedure.js";
import {
  advanceTimedStage,
  correctPlayerLife,
  markPlayerDeparted,
  reconcileUnavailablePlayer,
  recordHostIntervention,
  terminateGame
} from "./room/lifecycle.js";
import {
  advanceFromGuardStage,
  advanceFromSeerStage,
  advanceFromWolfStage,
  applyHunterShot,
  completeHunterResolution,
  getActiveWolf,
  lockWolfVoteIfComplete,
  settleFirstNight
} from "./room/night-resolution.js";
import { createSnapshot, restoreSnapshot } from "./room/snapshot.js";
import {
  advanceAfterRoleConfirmation,
  beginGameState,
  createBotPlayer,
  createGameState,
  createHumanPlayer,
  evaluateWinner,
  findNightActor,
  findPlayer,
  finishCurrentSession,
  getBotSeats,
  getNightStage,
  getTimedStage,
  isLivePlayer,
  recordGameEvent,
  renumberPlayers,
  resetGameState,
  toNightCandidate,
  type BotConfigurationLock,
  type ChatHistoryReader,
  type GameState,
  type InternalPlayer,
  type InternalTakeoverRequest,
  type LobbyRoomSnapshot,
  type PlayerDeparture,
  type ReconnectOutcome,
  type RoomChatPersistence,
  type RoomViewContext,
  type TakeoverResolution,
  type TimedStage,
  publicPlayers
} from "./room/state.js";
import { cancelTakeoverRequests, reattachTakeoverRequest, requestTakeover, resolveTakeover } from "./room/takeover.js";
import { createJoinToken, createReconnectToken, createRoomCode, hashReconnectToken, tokenMatches } from "./room/tokens.js";
import { createSession, getHostView, getPlayerView } from "./room/views.js";
import { isTimedStageComplete, onlineEligibleVoters, settleDayVote } from "./room/voting.js";
import { roomFailures as failures } from "./room-failures.js";
import { evaluateStartReadiness } from "./role-configuration.js";

interface RoomOptions {
  localAddress: string;
  webPort: number;
  roomCode?: string;
  joinToken?: string;
  snapshot?: LobbyRoomSnapshot;
  deferCompletedStages?: boolean;
  chatPersistence?: RoomChatPersistence;
}

export class LobbyRoom {
  readonly roomCode: string;
  readonly localAddress: string;
  readonly webPort: number;
  private joinToken: string;
  private state: GameState;

  constructor(options: RoomOptions) {
    this.localAddress = options.localAddress;
    this.webPort = options.webPort;
    const snapshot = options.snapshot;
    this.roomCode = roomCodeSchema.parse(snapshot?.roomCode ?? options.roomCode ?? createRoomCode());
    this.joinToken = snapshot?.joinToken ?? options.joinToken ?? createJoinToken();
    this.state = createGameState({
      deferCompletedStages: options.deferCompletedStages ?? false,
      chatPersistence: options.chatPersistence ?? null
    });
    if (snapshot) restoreSnapshot(this.state, snapshot);
  }

  private viewContext(): RoomViewContext {
    return { roomCode: this.roomCode, joinUrl: this.getJoinUrl(), localAddress: this.localAddress };
  }

  private commitPlayerView(playerId: PlayerId): RoomActionResult<PlayerLobbyView> {
    this.state.revision += 1;
    const view = this.getPlayerView(playerId)!;
    return { ok: true, data: view };
  }

  private advanceWhenReady(advance: (state: GameState) => void): void {
    if (!this.state.deferCompletedStages) advance(this.state);
  }

  createSnapshot(): LobbyRoomSnapshot {
    return createSnapshot(this.state, this.roomCode, this.joinToken);
  }

  enableDeferredStageAdvancement(): void {
    this.state.deferCompletedStages = true;
  }

  getJoinUrl(): string {
    const token = encodeURIComponent(this.joinToken);
    return `http://${this.localAddress}:${this.webPort}/join/${this.roomCode}?t=${token}`;
  }

  getGameSessionId(): string | null {
    return this.state.gameSessionId;
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
    return getChatHistory(this.state, reader, afterSequence, limit);
  }

  getHostView(): HostLobbyView {
    return getHostView(this.state, this.viewContext());
  }

  getPlayerView(playerId: PlayerId): PlayerLobbyView | null {
    return getPlayerView(this.state, playerId, this.viewContext());
  }

  join(input: JoinLobbyRequest, socketId: string): RoomActionResult<PlayerSession> {
    if (this.state.phase !== "lobby") return failures.gameAlreadyStarted();
    if (input.roomCode !== this.roomCode || input.joinToken !== this.joinToken) {
      return failures.invalidCredentials();
    }
    if (this.state.players.some((player) => player.socketId === socketId)) return failures.alreadyJoined();

    const nickname = nicknameSchema.parse(input.nickname);
    if (this.state.players.some((player) => player.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase())) {
      return failures.nicknameTaken();
    }

    const reconnectToken = createReconnectToken();
    const player: InternalPlayer = {
      id: randomUUID(),
      number: this.state.players.length + 1,
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
    this.state.players.push(player);
    this.state.revision += 1;
    return { ok: true, data: createSession(this.state, player.id, reconnectToken, this.viewContext()) };
  }

  addBot(request: HostAddBotRequest): RoomActionResult<HostLobbyView>;
  addBot(nickname: string, botKind: "deterministic"): RoomActionResult<HostLobbyView>;
  addBot(requestOrNickname: HostAddBotRequest | string, legacyBotKind?: "deterministic"): RoomActionResult<HostLobbyView> {
    if (this.state.phase !== "lobby") return failures.gameAlreadyStarted();
    const request = hostAddBotRequestSchema.parse(
      typeof requestOrNickname === "string" ? { nickname: requestOrNickname, botKind: legacyBotKind } : requestOrNickname
    );
    const nickname = nicknameSchema.parse(request.nickname);
    const botKind = botKindSchema.parse(request.botKind);
    if (this.state.players.some((player) => player.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase())) {
      return failures.nicknameTaken();
    }

    this.state.players.push({
      id: randomUUID(),
      number: this.state.players.length + 1,
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
    this.state.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  reconnect(input: ReconnectPlayerRequest, socketId: string): RoomActionResult<ReconnectOutcome> {
    const player = findPlayer(this.state, input.playerId);
    if (
      input.roomCode !== this.roomCode ||
      !player ||
      player.controller === "bot" ||
      player.connection === "departed" ||
      !tokenMatches(input.reconnectToken, player.reconnectTokenHash)
    ) {
      return failures.invalidReconnectCredentials();
    }
    if (this.state.players.some((candidate) => candidate.id !== player.id && candidate.socketId === socketId)) {
      return failures.alreadyJoined();
    }

    const replacedSocketId = player.socketId && player.socketId !== socketId ? player.socketId : null;
    player.socketId = socketId;
    player.connection = "online";
    this.state.revision += 1;
    return {
      ok: true,
      data: {
        session: createSession(this.state, player.id, input.reconnectToken, this.viewContext()),
        replacedSocketId
      }
    };
  }

  setReconnecting(socketId: string): PlayerId | null {
    const player = this.state.players.find((candidate) => candidate.socketId === socketId);
    if (!player || player.connection !== "online") return null;
    player.connection = "reconnecting";
    this.state.revision += 1;
    return player.id;
  }

  setOffline(playerId: PlayerId, disconnectedSocketId: string): boolean {
    const player = findPlayer(this.state, playerId);
    if (!player || player.socketId !== disconnectedSocketId || player.connection !== "reconnecting") return false;
    player.socketId = null;
    player.connection = "offline";
    this.state.revision += 1;
    return true;
  }

  requestTakeover(input: TakeoverPlayerRequest, socketId: string, now = new Date()): RoomActionResult<TakeoverReceipt> {
    if (this.state.phase !== "lobby") return failures.gameAlreadyStarted();
    if (input.roomCode !== this.roomCode || input.joinToken !== this.joinToken) {
      return failures.invalidCredentials();
    }
    if (this.state.players.some((player) => player.socketId === socketId) || this.state.takeoverRequests.some((request) => request.socketId === socketId))
      return failures.alreadyJoined();

    const nickname = nicknameSchema.parse(input.nickname);
    const player = this.state.players.find((candidate) => candidate.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase());
    if (!player || player.controller === "bot" || player.connection === "departed") {
      return failures.playerNotFound();
    }
    if (this.state.takeoverRequests.some((request) => request.playerId === player.id)) {
      return failures.takeoverAlreadyPending();
    }

    const request: InternalTakeoverRequest = {
      id: randomUUID(),
      playerId: player.id,
      nickname: player.nickname,
      requestedAt: now.toISOString(),
      socketId
    };
    this.state.takeoverRequests.push(request);
    this.state.revision += 1;
    return { ok: true, data: { requestId: request.id, nickname: request.nickname } };
  }

  reattachTakeoverRequest(requestId: string, input: TakeoverPlayerRequest, socketId: string): RoomActionResult<TakeoverReceipt> {
    if (this.state.phase !== "lobby") return failures.gameAlreadyStarted();
    if (input.roomCode !== this.roomCode || input.joinToken !== this.joinToken) {
      return failures.invalidCredentials();
    }
    if (this.state.players.some((player) => player.socketId === socketId)) {
      return failures.alreadyJoined();
    }
    if (this.state.takeoverRequests.some((request) => request.socketId === socketId && request.id !== requestId)) {
      return failures.alreadyJoined();
    }

    const request = this.state.takeoverRequests.find((candidate) => candidate.id === requestId);
    if (!request) return failures.takeoverRequestNotFound();

    const player = findPlayer(this.state, request.playerId);
    if (!player || player.controller === "bot" || player.connection === "departed") {
      return failures.playerNotFound();
    }
    if (player.nickname.toLocaleLowerCase() !== input.nickname.toLocaleLowerCase()) {
      return failures.invalidCredentials();
    }

    if (request.socketId !== socketId) {
      request.socketId = socketId;
      this.state.revision += 1;
    }
    return { ok: true, data: { requestId: request.id, nickname: request.nickname } };
  }

  resolveTakeover(requestId: string, approved: boolean): RoomActionResult<TakeoverResolution> {
    const index = this.state.takeoverRequests.findIndex((request) => request.id === requestId);
    if (index < 0) return failures.takeoverRequestNotFound();
    const pendingRequest = this.state.takeoverRequests[index]!;
    if (approved && this.state.players.some((candidate) => candidate.id !== pendingRequest.playerId && candidate.socketId === pendingRequest.socketId))
      return failures.alreadyJoined();
    const [request] = this.state.takeoverRequests.splice(index, 1);
    const player = findPlayer(this.state, request!.playerId);
    if (!player || player.connection === "departed") return failures.playerNotFound();

    let session: PlayerSession | null = null;
    let replacedSocketId: string | null = null;
    if (approved) {
      const reconnectToken = createReconnectToken();
      replacedSocketId = player.socketId && player.socketId !== request!.socketId ? player.socketId : null;
      player.reconnectTokenHash = hashReconnectToken(reconnectToken);
      player.socketId = request!.socketId;
      player.connection = "online";
      session = createSession(this.state, player.id, reconnectToken, this.viewContext());
    }

    this.state.revision += 1;
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
    const previousLength = this.state.takeoverRequests.length;
    this.state.takeoverRequests = this.state.takeoverRequests.filter((request) => request.socketId !== socketId || request.id === preservedRequestId);
    if (this.state.takeoverRequests.length === previousLength) return false;
    this.state.revision += 1;
    return true;
  }

  movePlayer(playerId: PlayerId, direction: "up" | "down"): RoomActionResult<HostLobbyView> {
    if (this.state.phase !== "lobby") return failures.gameAlreadyStarted();
    const index = this.state.players.findIndex((player) => player.id === playerId);
    if (index < 0) return failures.playerNotFound();

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= this.state.players.length) {
      return { ok: true, data: this.getHostView() };
    }

    const current = this.state.players[index]!;
    const target = this.state.players[targetIndex]!;
    this.state.players[index] = target;
    this.state.players[targetIndex] = current;
    renumberPlayers(this.state);
    this.state.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  updateRoleConfiguration(configuration: RoleConfigurationInput): RoomActionResult<HostLobbyView> {
    if (this.state.phase !== "lobby") return failures.gameAlreadyStarted();
    this.state.roleConfiguration = roleConfigurationSchema.parse(configuration);
    this.state.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  updateChatMode(chatMode: ChatMode): RoomActionResult<HostLobbyView> {
    if (this.state.phase !== "lobby") return failures.gameAlreadyStarted();
    this.state.chatMode = chatModeSchema.parse(chatMode);
    this.state.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  removePlayer(playerId: PlayerId): RoomActionResult<{ view: HostLobbyView; socketId: string }> {
    if (this.state.phase !== "lobby") return failures.gameAlreadyStarted();
    const index = this.state.players.findIndex((player) => player.id === playerId);
    if (index < 0) return failures.playerNotFound();

    const [removed] = this.state.players.splice(index, 1);
    this.state.takeoverRequests = this.state.takeoverRequests.filter((request) => request.playerId !== playerId);
    renumberPlayers(this.state);
    this.state.revision += 1;
    return { ok: true, data: { view: this.getHostView(), socketId: removed!.socketId ?? "" } };
  }

  markPlayerDeparted(playerId: PlayerId): RoomActionResult<PlayerDeparture> {
    const player = findPlayer(this.state, playerId);
    if (!player) return failures.playerNotFound();
    if (player.connection === "departed") return failures.playerAlreadyDeparted();

    const socketId = player.socketId;
    const takeoverSocketIds = this.state.takeoverRequests.filter((request) => request.playerId === playerId).map((request) => request.socketId);
    this.state.takeoverRequests = this.state.takeoverRequests.filter((request) => request.playerId !== playerId);
    player.socketId = null;
    player.connection = "departed";
    advanceAfterRoleConfirmation(this.state);
    if (this.state.phase !== "lobby" && this.state.phase !== "game-over") {
      reconcileUnavailablePlayer(this.state, playerId);
      evaluateWinner(this.state);
    }
    this.state.revision += 1;

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
    if (this.state.phase === "lobby" || this.state.phase === "game-over") return failures.invalidPhaseControl();
    if (this.state.pendingHunterResolution) return failures.invalidPhaseControl();
    const player = findPlayer(this.state, playerId);
    if (!player) return failures.playerNotFound();
    if (player.connection === "departed") return failures.playerAlreadyDeparted();

    player.alive = alive;
    if (!alive) {
      player.wolfVoteTarget = null;
      player.wolfVoteConfirmed = false;
      player.dayVoteTarget = null;
      player.dayVoteConfirmed = false;
    }

    if (!alive) reconcileUnavailablePlayer(this.state, playerId);
    evaluateWinner(this.state);
    this.state.revision += 1;

    const publicPlayer = publicPlayers(this.state).find((candidate) => candidate.id === playerId)!;
    return { ok: true, data: { view: this.getHostView(), player: publicPlayer } };
  }

  refreshJoinToken(): HostLobbyView {
    this.joinToken = createJoinToken();
    this.state.revision += 1;
    return this.getHostView();
  }

  startGame(now = new Date()): RoomActionResult<HostLobbyView> {
    if (this.state.phase !== "lobby") return failures.gameAlreadyStarted();
    const participants = this.state.players.filter((player) => player.connection !== "departed");
    const readiness = evaluateStartReadiness(this.state.roleConfiguration, participants.length);
    if (!readiness.ready) return failures.gameNotReady();

    const gameSessionId = randomUUID();
    const gameSessionStartedAt = now.toISOString();
    this.state.chatPersistence?.createSession({
      id: gameSessionId,
      roomCode: this.roomCode,
      startedAt: gameSessionStartedAt,
      roleConfiguration: { ...this.state.roleConfiguration },
      chatMode: this.state.chatMode
    });

    const roles = roleSchema.array().parse(Object.entries(this.state.roleConfiguration).flatMap(([role, count]) => Array.from({ length: count }, () => role)));
    for (let index = roles.length - 1; index > 0; index -= 1) {
      const target = randomInt(index + 1);
      [roles[index], roles[target]] = [roles[target]!, roles[index]!];
    }
    beginGameState(this.state, participants, roles, gameSessionId, gameSessionStartedAt);
    this.joinToken = createJoinToken();
    this.state.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  confirmRole(playerId: PlayerId): RoomActionResult<PlayerLobbyView> {
    const player = findPlayer(this.state, playerId);
    if (!player || player.connection === "departed") return failures.playerNotFound();
    if (this.state.phase !== "role-reveal" || !player.role) return failures.invalidCredentials();
    if (player.roleConfirmed) return failures.roleAlreadyConfirmed();

    player.roleConfirmed = true;
    advanceAfterRoleConfirmation(this.state);
    return this.commitPlayerView(playerId);
  }

  selectWolfTarget(playerId: PlayerId, target: WolfVoteTarget): RoomActionResult<PlayerLobbyView> {
    const player = getActiveWolf(this.state, playerId);
    if (!player) return failures.invalidNightAction();
    if (this.state.wolfVoteLocked) return failures.nightActionLocked();
    if (target !== null && target !== "no-kill" && !isLivePlayer(findPlayer(this.state, target))) return failures.playerNotFound();

    player.wolfVoteTarget = target;
    player.wolfVoteConfirmed = false;
    return this.commitPlayerView(playerId);
  }

  confirmWolfVote(playerId: PlayerId, confirmed: boolean): RoomActionResult<PlayerLobbyView> {
    const player = getActiveWolf(this.state, playerId);
    if (!player) return failures.invalidNightAction();
    if (this.state.wolfVoteLocked) return failures.nightActionLocked();
    if (confirmed && player.wolfVoteTarget === null) return failures.invalidNightAction();

    player.wolfVoteConfirmed = confirmed;
    if (lockWolfVoteIfComplete(this.state) && !this.state.deferCompletedStages) advanceFromWolfStage(this.state);
    return this.commitPlayerView(playerId);
  }

  sendWolfMessage(playerId: PlayerId, input: WolfSendMessageRequest, now = new Date()): RoomActionResult<PlayerLobbyView> {
    const content = input.kind === "target-suggestion" ? ({ kind: input.kind, target: input.target } as const) : input;
    const result = this.sendChat(playerId, { channel: "wolf-private", content }, now);
    if (!result.ok) return result;
    return { ok: true, data: this.getPlayerView(playerId)! };
  }

  sendChat(playerId: PlayerId, input: ChatSendRequest, now = new Date()): RoomActionResult<ChatMessage> {
    return sendChat(this.state, playerId, input, now);
  }

  getChatRecipientIds(channel: ChatChannel): PlayerId[] {
    if (channel === "day-public" || channel === "system") return this.getPlayerIds();
    return this.state.players.filter((player) => player.role === "wolf" && isLivePlayer(player)).map((player) => player.id);
  }

  inspectAsSeer(playerId: PlayerId, targetId: PlayerId): RoomActionResult<PlayerLobbyView> {
    const player = findNightActor(this.state, playerId, "seer");
    if (!player) return failures.invalidNightAction();
    const target = findPlayer(this.state, targetId);
    if (!isLivePlayer(target)) return failures.playerNotFound();
    if (target.id === player.id) return failures.invalidNightAction();
    if (player.seerInspectedPlayerId) return failures.nightActionLocked();

    player.seerInspectedPlayerId = target.id;
    recordGameEvent(
      this.state,
      "seer-inspection",
      `${player.number} 号${player.nickname}查验 ${target.number} 号${target.nickname}：${target.role === "wolf" ? "狼人" : "好人"}`
    );
    this.advanceWhenReady(advanceFromSeerStage);
    return this.commitPlayerView(playerId);
  }

  protectAsGuard(playerId: PlayerId, targetId: PlayerId | null): RoomActionResult<PlayerLobbyView> {
    const player = findNightActor(this.state, playerId, "guard");
    if (!player) return failures.invalidNightAction();
    if (this.state.guardActionSubmitted) return failures.nightActionLocked();

    if (targetId !== null) {
      const target = findPlayer(this.state, targetId);
      if (!isLivePlayer(target)) return failures.playerNotFound();
      if (target.id === this.state.lastGuardTargetId) return failures.invalidNightAction();
    }

    this.state.guardTargetId = targetId;
    this.state.guardActionSubmitted = true;
    const target = targetId ? toNightCandidate(this.state, targetId) : null;
    recordGameEvent(
      this.state,
      "guard-action",
      target ? `${player.number} 号 ${player.nickname} 守护 ${target.number} 号 ${target.nickname}` : `${player.number} 号 ${player.nickname} 选择空守`
    );
    this.advanceWhenReady(advanceFromGuardStage);
    return this.commitPlayerView(playerId);
  }

  submitWitchAction(playerId: PlayerId, input: WitchSubmitActionRequest): RoomActionResult<PlayerLobbyView> {
    const player = findNightActor(this.state, playerId, "witch");
    if (!player) return failures.invalidNightAction();
    if (this.state.witchActionSubmitted) return failures.nightActionLocked();

    let poisonTargetId: PlayerId | null = null;
    let saved = false;
    if (input.action === "save") {
      if (!player.witchAntidoteAvailable || !this.state.wolfAttackTargetId || (this.state.wolfAttackTargetId === player.id && this.state.dayNumber > 1))
        return failures.invalidNightAction();
      player.witchAntidoteAvailable = false;
      saved = true;
    }
    if (input.action === "poison") {
      const target = findPlayer(this.state, input.target);
      if (!player.witchPoisonAvailable || !isLivePlayer(target) || target.id === player.id) return failures.invalidNightAction();
      player.witchPoisonAvailable = false;
      poisonTargetId = target.id;
    }

    const poisonTarget = poisonTargetId ? toNightCandidate(this.state, poisonTargetId) : null;
    recordGameEvent(
      this.state,
      "witch-action",
      input.action === "save"
        ? `${player.number} 号${player.nickname}使用解药`
        : input.action === "poison"
          ? `${player.number} 号${player.nickname}对 ${poisonTarget?.number} 号${poisonTarget?.nickname}使用毒药`
          : `${player.number} 号${player.nickname}未使用药物`
    );

    this.state.witchActionSubmitted = true;
    this.state.pendingWitchAction = { saved, poisonTargetId };
    this.advanceWhenReady((state) => settleFirstNight(state, saved, poisonTargetId));
    return this.commitPlayerView(playerId);
  }

  shootAsHunter(playerId: PlayerId, targetId: PlayerId | null): RoomActionResult<PlayerLobbyView> {
    const player = findPlayer(this.state, playerId);
    if (!player || this.state.pendingHunterResolution?.hunterId !== player.id || this.state.hunterActionSubmitted) {
      return failures.invalidNightAction();
    }
    let target: InternalPlayer | null = null;
    if (targetId !== null) {
      target = findPlayer(this.state, targetId) ?? null;
      if (!isLivePlayer(target) || target.id === player.id) return failures.playerNotFound();
      applyHunterShot(this.state, target);
    }
    this.state.hunterShotPlayerId = target?.id ?? null;
    this.state.hunterActionSubmitted = true;
    recordGameEvent(
      this.state,
      "hunter-shot",
      target ? `${player.number} 号 ${player.nickname} 开枪带走 ${target.number} 号 ${target.nickname}` : `${player.number} 号 ${player.nickname} 放弃开枪`
    );
    this.advanceWhenReady(completeHunterResolution);
    return this.commitPlayerView(playerId);
  }

  getNightStage(): "wolf" | "seer" | "guard" | "witch" | null {
    return getNightStage(this.state);
  }

  getTimedStage(): TimedStage | null {
    return getTimedStage(this.state);
  }

  getTimedStageKey(): string | null {
    const stage = this.getTimedStage();
    if (!stage) return null;
    if (stage === "last-words" || stage === "day-speech") {
      return `${stage}:${this.state.speechOrderIds[this.state.currentSpeakerIndex] ?? "none"}`;
    }
    return stage;
  }

  isCurrentSpeaker(playerId: PlayerId): boolean {
    return isCurrentSpeaker(this.state, playerId);
  }

  isTimedStageComplete(): boolean {
    return isTimedStageComplete(this.state);
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
    if (this.state.phase !== "first-night") return failures.invalidNightAction();
    if (this.state.nightStage === "wolf") {
      this.state.wolfVoteLocked = true;
      advanceFromWolfStage(this.state);
    } else if (this.state.nightStage === "seer") {
      advanceFromSeerStage(this.state);
    } else if (this.state.nightStage === "guard") {
      this.state.guardActionSubmitted = true;
      this.state.guardTargetId = null;
      advanceFromGuardStage(this.state);
    } else if (this.state.nightStage === "witch") {
      this.state.witchActionSubmitted = true;
      settleFirstNight(this.state, false, null);
    } else {
      return failures.invalidNightAction();
    }
    this.state.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  continueFromDawn(): RoomActionResult<HostLobbyView> {
    const failure = continueFromDawn(this.state);
    if (failure) return failure;
    this.state.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  finishSpeaking(playerId: PlayerId): RoomActionResult<PlayerLobbyView> {
    if (this.state.phase !== "last-words" && this.state.phase !== "day-speech") return failures.invalidPhaseControl();
    if (this.state.speechOrderIds[this.state.currentSpeakerIndex] !== playerId) return failures.invalidPhaseControl();
    if (this.state.currentSpeakerFinished) return failures.invalidPhaseControl();
    advanceSpeaker(this.state);
    return this.commitPlayerView(playerId);
  }

  selectDayVote(playerId: PlayerId, target: DayVoteTarget): RoomActionResult<PlayerLobbyView> {
    const player = findPlayer(this.state, playerId);
    if (this.state.phase !== "day-vote" || !player?.alive || player.connection === "departed" || player.idiotRevealed) {
      return failures.invalidNightAction();
    }
    if (target !== null && target !== "abstain") {
      const candidate = this.state.players.find((item) => item.id === target);
      if (!candidate || !candidate.alive || candidate.connection === "departed" || candidate.idiotRevealed) {
        return failures.playerNotFound();
      }
      if (candidate.id === player.id) return failures.invalidNightAction();
    }
    player.dayVoteTarget = target;
    player.dayVoteConfirmed = false;
    return this.commitPlayerView(playerId);
  }

  confirmDayVote(playerId: PlayerId, confirmed: boolean): RoomActionResult<PlayerLobbyView> {
    const player = findPlayer(this.state, playerId);
    if (this.state.phase !== "day-vote" || !player?.alive || player.connection === "departed" || player.idiotRevealed) {
      return failures.invalidNightAction();
    }
    if (confirmed && player.dayVoteTarget === null) return failures.invalidNightAction();
    player.dayVoteConfirmed = confirmed;
    if (!this.state.deferCompletedStages && onlineEligibleVoters(this.state).every((candidate) => candidate.dayVoteConfirmed)) {
      settleDayVote(this.state);
    }
    return this.commitPlayerView(playerId);
  }

  skipCurrentDayStage(): RoomActionResult<HostLobbyView> {
    if (this.state.phase === "last-words" || this.state.phase === "day-speech") {
      advanceSpeaker(this.state);
    } else if (this.state.phase === "day-vote") {
      settleDayVote(this.state);
    } else {
      return failures.invalidPhaseControl();
    }
    this.state.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  continueFromExile(): RoomActionResult<HostLobbyView> {
    const failure = continueFromExile(this.state);
    if (failure) return failure;
    this.state.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  getPlayerIds(): PlayerId[] {
    return this.state.players.map((player) => player.id);
  }

  getBotSeats(): Array<{
    playerId: PlayerId;
    botKind: BotKind;
    botProfileId: LobbyPlayer["botProfileId"];
    lockedConfiguration: BotConfigurationLock;
  }> {
    return getBotSeats(this.state);
  }

  lockBotConfiguration(playerId: PlayerId, lock: Omit<BotConfigurationLock, "locked">): void {
    const player = findPlayer(this.state, playerId);
    if (!player || player.controller !== "bot" || player.botKind !== "llm") return;
    player.aiConfigurationLocked = true;
    player.aiBotProfileRevision = lock.botProfileRevision;
    player.aiModelProfileId = lock.modelProfileId;
    player.aiModelProfileRevision = lock.modelProfileRevision;
    player.aiModelChainRevision = lock.modelChainRevision;
  }

  getSocketId(playerId: PlayerId): string | null {
    return this.state.players.find((player) => player.id === playerId)?.socketId ?? null;
  }

  terminateGame(now = new Date()): RoomActionResult<HostLobbyView> {
    if (this.state.phase === "lobby" || this.state.phase === "game-over") return failures.invalidPhaseControl();
    finishCurrentSession(this.state, "terminated", now);
    this.state.gameOutcome = "terminated";
    this.state.phase = "game-over";
    this.state.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  recordHostIntervention(detail: string): void {
    if (this.state.phase === "lobby") return;
    recordGameEvent(this.state, "host-intervention", detail);
  }

  playAgain(): RoomActionResult<HostLobbyView> {
    if (this.state.phase !== "game-over") return failures.invalidPhaseControl();
    this.state.players = this.state.players.filter((player) => player.connection !== "departed");
    for (const player of this.state.players) {
      player.alive = true;
      player.role = null;
      player.roleConfirmed = false;
      player.witchAntidoteAvailable = true;
      player.witchPoisonAvailable = true;
    }
    resetGameState(this.state);
    this.state.phase = "lobby";
    return this.startGame();
  }

  returnToLobby(): RoomActionResult<HostLobbyView> {
    if (this.state.phase !== "game-over") return failures.invalidPhaseControl();
    this.state.players = this.state.players.filter((player) => player.connection !== "departed");
    renumberPlayers(this.state);
    for (const player of this.state.players) {
      player.alive = true;
      player.role = null;
      player.roleConfirmed = false;
    }
    resetGameState(this.state);
    this.state.phase = "lobby";
    this.joinToken = createJoinToken();
    this.state.revision += 1;
    return { ok: true, data: this.getHostView() };
  }

  private advanceTimedStage(skipped: boolean): RoomActionResult<HostLobbyView> {
    return advanceTimedStage(this.state, skipped, this.viewContext());
  }
}
