import { roomFailures as failures } from "../room-failures.js";
import { startNextNight, toNightCandidate, type GameState, type InternalPlayer } from "./state.js";
import { onlineEligibleVoters, prepareDayVote } from "./voting.js";
import type { PlayerId, RoomActionFailure } from "@werewolf/shared";
import { randomInt } from "node:crypto";

export function isCurrentSpeaker(state: GameState, playerId: PlayerId): boolean {
  return (state.phase === "last-words" || state.phase === "day-speech") && state.speechOrderIds[state.currentSpeakerIndex] === playerId;
}

export function canSendPublicChat(state: GameState, player: InternalPlayer): boolean {
  if (player.connection === "departed") return false;
  if (state.phase === "last-words") return isCurrentSpeaker(state, player.id);
  if (state.phase !== "day-speech" || !player.alive) return false;
  return state.chatMode === "open" || isCurrentSpeaker(state, player.id);
}

export function startDaySpeech(state: GameState): void {
  const aliveIds = state.players.filter((player) => player.alive && player.connection !== "departed").map((player) => player.id);
  state.speechOrderIds = randomInt(2) === 0 ? aliveIds : [...aliveIds].reverse();
  state.currentSpeakerIndex = state.speechOrderIds.length > 0 ? 0 : -1;
  state.currentSpeakerFinished = false;
  state.phase = state.speechOrderIds.length > 0 ? "day-speech" : "day-vote";
  if (state.phase === "day-vote") prepareDayVote(state);
}

export function advanceSpeaker(state: GameState): void {
  state.currentSpeakerIndex += 1;
  state.currentSpeakerFinished = false;
  if (state.currentSpeakerIndex < state.speechOrderIds.length) return;
  if (state.phase === "last-words") {
    if (state.exiledPlayerId && state.speechOrderIds.length === 1) startNextNight(state);
    else startDaySpeech(state);
    return;
  }
  prepareDayVote(state);
}

export function continueFromDawn(state: GameState): RoomActionFailure | null {
  if (state.phase !== "dawn" || state.pendingHunterResolution) return failures.invalidPhaseControl();
  const lastWords = state.dawnDeathIds.filter((id) => state.players.some((player) => player.id === id && player.connection !== "departed"));
  if (lastWords.length > 0) {
    state.speechOrderIds = lastWords;
    state.currentSpeakerIndex = 0;
    state.phase = "last-words";
  } else {
    startDaySpeech(state);
  }
  return null;
}

export function continueFromExile(state: GameState): RoomActionFailure | null {
  if (state.phase !== "exile-result" || state.pendingHunterResolution) return failures.invalidPhaseControl();
  if (state.exiledPlayerId) {
    state.speechOrderIds = [state.exiledPlayerId];
    state.currentSpeakerIndex = 0;
    state.phase = "last-words";
  } else {
    startNextNight(state);
  }
  return null;
}

export function getPublicDayState(state: GameState) {
  if (!["dawn", "last-words", "day-speech", "day-vote", "exile-result"].includes(state.phase)) return null;
  const currentId = state.currentSpeakerIndex >= 0 ? state.speechOrderIds[state.currentSpeakerIndex] : null;
  const currentSpeaker = currentId ? toNightCandidate(state, currentId) : null;
  const eligibleVoters = onlineEligibleVoters(state);
  return {
    alivePlayerIds: state.players.filter((player) => player.alive).map((player) => player.id),
    revealedIdiot: state.revealedIdiotId ? toNightCandidate(state, state.revealedIdiotId) : null,
    hunterPending: state.pendingHunterResolution !== null,
    currentSpeaker,
    speechOrder: state.speechOrderIds.flatMap((id) => {
      const candidate = toNightCandidate(state, id);
      return candidate ? [candidate] : [];
    }),
    voteProgress:
      state.phase === "day-vote"
        ? {
            confirmed: eligibleVoters.filter((player) => player.dayVoteConfirmed).length,
            total: eligibleVoters.length
          }
        : null,
    voteResult: state.dayVoteResult
      ? {
          ballots: state.dayVoteResult.flatMap(({ voterId, targetId }) => {
            const voter = toNightCandidate(state, voterId);
            return voter ? [{ voter, target: targetId ? toNightCandidate(state, targetId) : null }] : [];
          }),
          exiledPlayer: state.exiledPlayerId ? toNightCandidate(state, state.exiledPlayerId) : null
        }
      : null
  };
}
