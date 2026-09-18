import { resolvePlurality } from "../game/rules.js";
import { evaluateWinner, getRoleConfirmationProgress, getTimedStage, recordGameEvent, toNightCandidate, type GameState, type InternalPlayer } from "./state.js";

export function prepareDayVote(state: GameState): void {
  state.phase = "day-vote";
  state.currentSpeakerIndex = -1;
  state.currentSpeakerFinished = false;
  for (const player of state.players) {
    player.dayVoteTarget = null;
    player.dayVoteConfirmed = false;
  }
}

export function onlineAlivePlayers(state: GameState): InternalPlayer[] {
  return state.players.filter((player) => player.alive && player.connection === "online");
}

export function onlineEligibleVoters(state: GameState): InternalPlayer[] {
  return onlineAlivePlayers(state).filter((player) => !player.idiotRevealed);
}

export function isTimedStageComplete(state: GameState): boolean {
  const stage = getTimedStage(state);
  if (!stage) return false;
  if (stage === "role-reveal") {
    const progress = getRoleConfirmationProgress(state);
    return progress.total > 0 && progress.confirmed === progress.total;
  }
  if (stage === "wolf") return state.wolfVoteLocked;
  if (stage === "seer") {
    const seer = state.players.find((player) => player.role === "seer" && player.alive && player.connection !== "departed");
    return !seer || seer.seerInspectedPlayerId !== null;
  }
  if (stage === "guard") return state.guardActionSubmitted;
  if (stage === "witch") return state.witchActionSubmitted;
  if (stage === "hunter") return state.hunterActionSubmitted;
  if (stage === "last-words" || stage === "day-speech") return state.currentSpeakerFinished;
  if (stage === "day-vote") {
    const voters = onlineEligibleVoters(state);
    return voters.length > 0 && voters.every((player) => player.dayVoteConfirmed);
  }
  return true;
}

export function settleDayVote(state: GameState): void {
  const voters = state.players.filter((player) => player.alive && player.connection !== "departed" && !player.idiotRevealed);
  state.dayVoteResult = voters.map((player) => ({
    voterId: player.id,
    targetId: player.dayVoteConfirmed && player.dayVoteTarget !== "abstain" ? player.dayVoteTarget : null
  }));
  for (const ballot of state.dayVoteResult) {
    const voter = toNightCandidate(state, ballot.voterId)!;
    const target = ballot.targetId ? toNightCandidate(state, ballot.targetId) : null;
    recordGameEvent(state, "day-vote", `${voter.number} 号${voter.nickname}投给${target ? ` ${target.number} 号${target.nickname}` : "弃票"}`);
  }
  state.exiledPlayerId = resolvePlurality(state.dayVoteResult.flatMap((ballot) => (ballot.targetId ? [ballot.targetId] : [])));
  if (state.exiledPlayerId) {
    const exiled = state.players.find((player) => player.id === state.exiledPlayerId);
    if (exiled) {
      if (exiled.role === "idiot" && !exiled.idiotRevealed) {
        exiled.idiotRevealed = true;
        state.revealedIdiotId = exiled.id;
        state.exiledPlayerId = null;
        recordGameEvent(state, "idiot-reveal", `${exiled.number} 号 ${exiled.nickname} 公开白痴身份并免于放逐`);
      } else {
        exiled.alive = false;
        if (exiled.role === "hunter" && exiled.connection !== "departed") {
          state.pendingHunterResolution = { hunterId: exiled.id, origin: "exile" };
          state.hunterActionSubmitted = false;
          state.hunterShotPlayerId = null;
        }
        recordGameEvent(state, "death", `${exiled.number} 号${exiled.nickname}被放逐`);
      }
    }
  }
  state.phase = "exile-result";
  if (!state.pendingHunterResolution && state.exiledPlayerId) evaluateWinner(state);
}
