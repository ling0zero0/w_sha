import { findPlayer } from "./state.js";
import { resolveNightDeaths, resolveWolfAttack } from "../game/rules.js";
import { evaluateWinner, recordGameEvent, toNightCandidate, type GameState, type InternalPlayer } from "./state.js";
import type { PlayerId } from "@werewolf/shared";

export function getActiveWolf(state: GameState, playerId: PlayerId): InternalPlayer | null {
  const player = findPlayer(state, playerId);
  return state.phase === "first-night" && state.nightStage === "wolf" && player?.role === "wolf" && player.alive && player.connection !== "departed"
    ? player
    : null;
}

export function lockWolfVoteIfComplete(state: GameState): boolean {
  const onlineWolves = state.players.filter((player) => player.role === "wolf" && player.alive && player.connection === "online");
  if (onlineWolves.length > 0 && onlineWolves.every((player) => player.wolfVoteConfirmed)) {
    state.wolfVoteLocked = true;
    return true;
  }
  return false;
}

export function advanceFromWolfStage(state: GameState): void {
  const votes = state.players
    .filter((player) => player.role === "wolf" && player.wolfVoteConfirmed && player.wolfVoteTarget)
    .map((player) => player.wolfVoteTarget!);
  state.wolfAttackTargetId = resolveWolfAttack(votes);
  state.nightStage = "seer";
  if (!state.players.some((player) => player.role === "seer" && player.alive && player.connection !== "departed")) {
    advanceFromSeerStage(state);
  }
}

export function advanceFromSeerStage(state: GameState): void {
  state.nightStage = "guard";
  if (!state.players.some((player) => player.role === "guard" && player.alive && player.connection !== "departed")) {
    state.guardActionSubmitted = true;
    state.guardTargetId = null;
    advanceFromGuardStage(state);
  }
}

export function advanceFromGuardStage(state: GameState): void {
  state.nightStage = "witch";
  if (!state.players.some((player) => player.role === "witch" && player.alive && player.connection !== "departed")) {
    settleFirstNight(state, false, null);
  }
}

export function settleFirstNight(state: GameState, saved: boolean, poisonTargetId: PlayerId | null): void {
  state.dawnDeathIds = resolveNightDeaths(state.players, state.wolfAttackTargetId, saved, poisonTargetId, state.guardTargetId);
  const deaths = new Set(state.dawnDeathIds);
  for (const player of state.players) {
    if (deaths.has(player.id)) player.alive = false;
  }
  if (state.dawnDeathIds.length === 0) {
    recordGameEvent(state, "death", "夜间无人死亡");
  } else {
    for (const id of state.dawnDeathIds) {
      const player = toNightCandidate(state, id)!;
      recordGameEvent(state, "death", `${player.number} 号${player.nickname}夜间死亡`);
    }
  }
  state.nightStage = "complete";
  state.pendingWitchAction = null;
  state.phase = "dawn";
  const hunter = state.players.find((player) => player.role === "hunter" && deaths.has(player.id));
  if (hunter && hunter.id !== poisonTargetId && hunter.connection !== "departed") {
    state.pendingHunterResolution = { hunterId: hunter.id, origin: "night" };
    state.hunterActionSubmitted = false;
    state.hunterShotPlayerId = null;
  } else {
    evaluateWinner(state);
  }
}

export function completeHunterResolution(state: GameState): void {
  const resolution = state.pendingHunterResolution;
  if (!resolution) return;
  state.pendingHunterResolution = null;
  evaluateWinner(state);
}

export function applyHunterShot(state: GameState, target: InternalPlayer): void {
  target.alive = false;
  if (state.pendingHunterResolution?.origin === "night" && !state.dawnDeathIds.includes(target.id)) {
    state.dawnDeathIds.push(target.id);
    const playerNumbers = new Map(state.players.map((item) => [item.id, item.number]));
    state.dawnDeathIds.sort((left, right) => (playerNumbers.get(left) ?? 0) - (playerNumbers.get(right) ?? 0));
  }
}
