import { findPlayer } from "./state.js";
import { roomFailures as failures } from "../room-failures.js";
import { advanceSpeaker, continueFromDawn, continueFromExile, isCurrentSpeaker } from "./day-procedure.js";
import {
  advanceFromGuardStage,
  advanceFromSeerStage,
  advanceFromWolfStage,
  completeHunterResolution,
  lockWolfVoteIfComplete,
  settleFirstNight
} from "./night-resolution.js";
import {
  advanceAfterRoleConfirmation,
  evaluateWinner,
  finishCurrentSession,
  recordGameEvent,
  getTimedStage,
  publicPlayers,
  type GameState,
  type RoomViewContext,
  type PlayerDeparture
} from "./state.js";
import { getHostView } from "./views.js";
import { onlineEligibleVoters, settleDayVote } from "./voting.js";
import type { HostLobbyView, LobbyPlayer, PlayerId, RoomActionResult } from "@werewolf/shared";

export function markPlayerDeparted(state: GameState, playerId: PlayerId, context: RoomViewContext): RoomActionResult<PlayerDeparture> {
  const player = findPlayer(state, playerId);
  if (!player) return failures.playerNotFound();
  if (player.connection === "departed") return failures.playerAlreadyDeparted();

  const socketId = player.socketId;
  const takeoverSocketIds = state.takeoverRequests.filter((request) => request.playerId === playerId).map((request) => request.socketId);
  state.takeoverRequests = state.takeoverRequests.filter((request) => request.playerId !== playerId);
  player.socketId = null;
  player.connection = "departed";
  advanceAfterRoleConfirmation(state);
  if (state.phase !== "lobby" && state.phase !== "game-over") {
    reconcileUnavailablePlayer(state, playerId);
    evaluateWinner(state);
  }
  state.revision += 1;

  const hostView = getHostView(state, context);
  const publicPlayer = hostView.players.find((candidate) => candidate.id === playerId)!;
  return {
    ok: true,
    data: {
      view: hostView,
      player: publicPlayer,
      socketId,
      takeoverSocketIds
    }
  };
}

export function correctPlayerLife(
  state: GameState,
  playerId: PlayerId,
  alive: boolean,
  context: RoomViewContext
): RoomActionResult<{ view: HostLobbyView; player: LobbyPlayer }> {
  if (state.phase === "lobby" || state.phase === "game-over") return failures.invalidPhaseControl();
  if (state.pendingHunterResolution) return failures.invalidPhaseControl();
  const player = findPlayer(state, playerId);
  if (!player) return failures.playerNotFound();
  if (player.connection === "departed") return failures.playerAlreadyDeparted();

  player.alive = alive;
  if (!alive) {
    player.wolfVoteTarget = null;
    player.wolfVoteConfirmed = false;
    player.dayVoteTarget = null;
    player.dayVoteConfirmed = false;
  }

  if (!alive) reconcileUnavailablePlayer(state, playerId);
  evaluateWinner(state);
  state.revision += 1;

  const publicPlayer = publicPlayers(state).find((candidate) => candidate.id === playerId)!;
  return { ok: true, data: { view: getHostView(state, context), player: publicPlayer } };
}

export function terminateGame(state: GameState, now: Date, context: RoomViewContext): RoomActionResult<HostLobbyView> {
  if (state.phase === "lobby" || state.phase === "game-over") return failures.invalidPhaseControl();
  finishCurrentSession(state, "terminated", now);
  state.gameOutcome = "terminated";
  state.phase = "game-over";
  state.revision += 1;
  return { ok: true, data: getHostView(state, context) };
}

export function recordHostIntervention(state: GameState, detail: string): void {
  if (state.phase === "lobby") return;
  recordGameEvent(state, "host-intervention", detail);
}

export function reconcileUnavailablePlayer(state: GameState, playerId: PlayerId): void {
  if (isCurrentSpeaker(state, playerId)) advanceSpeaker(state);
  if (state.phase === "first-night") {
    const unavailablePlayer = state.players.find((player) => player.id === playerId);
    if (unavailablePlayer?.role === "guard") state.guardTargetId = null;
    if (state.nightStage === "wolf") {
      const activeWolves = state.players.filter((candidate) => candidate.role === "wolf" && candidate.alive && candidate.connection !== "departed");
      if (activeWolves.length === 0 || lockWolfVoteIfComplete(state)) {
        state.wolfVoteLocked = true;
        advanceFromWolfStage(state);
      }
    } else if (
      state.nightStage === "seer" &&
      !state.players.some((candidate) => candidate.role === "seer" && candidate.alive && candidate.connection !== "departed")
    ) {
      advanceFromSeerStage(state);
    } else if (
      state.nightStage === "guard" &&
      !state.players.some((candidate) => candidate.role === "guard" && candidate.alive && candidate.connection !== "departed")
    ) {
      state.guardActionSubmitted = true;
      state.guardTargetId = null;
      advanceFromGuardStage(state);
    } else if (
      state.nightStage === "witch" &&
      !state.players.some((candidate) => candidate.role === "witch" && candidate.alive && candidate.connection !== "departed")
    ) {
      state.witchActionSubmitted = true;
      settleFirstNight(state, false, null);
    }
  }
  if (state.pendingHunterResolution?.hunterId === playerId) {
    state.hunterActionSubmitted = true;
    state.hunterShotPlayerId = null;
    recordGameEvent(state, "hunter-shot", "猎人离场，视为放弃开枪");
    completeHunterResolution(state);
  }
  if (!state.deferCompletedStages && state.phase === "day-vote" && onlineEligibleVoters(state).every((candidate) => candidate.dayVoteConfirmed)) {
    settleDayVote(state);
  }
}

export function advanceTimedStage(state: GameState, skipped: boolean, context: RoomViewContext): RoomActionResult<HostLobbyView> {
  const stage = getTimedStage(state);
  if (!stage) return failures.invalidPhaseControl();

  if (stage === "role-reveal") {
    state.phase = "first-night";
  } else if (stage === "wolf") {
    if (skipped) state.wolfVoteLocked = true;
    advanceFromWolfStage(state);
  } else if (stage === "seer") {
    advanceFromSeerStage(state);
  } else if (stage === "guard") {
    state.guardActionSubmitted = true;
    if (skipped) state.guardTargetId = null;
    advanceFromGuardStage(state);
  } else if (stage === "witch") {
    const action = skipped ? { saved: false, poisonTargetId: null } : state.pendingWitchAction;
    state.witchActionSubmitted = true;
    settleFirstNight(state, action?.saved ?? false, action?.poisonTargetId ?? null);
  } else if (stage === "hunter") {
    state.hunterActionSubmitted = true;
    state.hunterShotPlayerId = null;
    recordGameEvent(state, "hunter-shot", "猎人放弃开枪");
    completeHunterResolution(state);
  } else if (stage === "dawn") {
    const failure = continueFromDawn(state);
    if (failure) return failure;
    state.revision += 1;
    return { ok: true, data: getHostView(state, context) };
  } else if (stage === "last-words" || stage === "day-speech") {
    advanceSpeaker(state);
  } else if (stage === "day-vote") {
    settleDayVote(state);
  } else {
    const failure = continueFromExile(state);
    if (failure) return failure;
    state.revision += 1;
    return { ok: true, data: getHostView(state, context) };
  }

  state.revision += 1;
  return { ok: true, data: getHostView(state, context) };
}
