import type { PlayerId, Role, WolfVoteTarget } from "@werewolf/shared";

export type GameOutcome = "good-win" | "wolf-win" | "draw";

interface NumberedPlayer {
  id: PlayerId;
  number: number;
}

interface OutcomePlayer {
  alive: boolean;
  connection: "online" | "reconnecting" | "offline" | "departed";
  role: Role | null;
}

export function resolvePlurality<T>(votes: readonly T[]): T | null {
  const counts = new Map<T, number>();
  for (const vote of votes) counts.set(vote, (counts.get(vote) ?? 0) + 1);

  const highest = Math.max(0, ...counts.values());
  if (highest === 0) return null;
  const winners = [...counts.entries()].filter(([, count]) => count === highest);
  return winners.length === 1 ? winners[0]![0] : null;
}

export function resolveWolfAttack(votes: readonly WolfVoteTarget[]): PlayerId | null {
  const winner = resolvePlurality(votes.filter((vote): vote is Exclude<WolfVoteTarget, null> => vote !== null));
  return winner === "no-kill" ? null : winner;
}

export function resolveNightDeaths(
  players: readonly NumberedPlayer[],
  attackedPlayerId: PlayerId | null,
  saved: boolean,
  poisonTargetId: PlayerId | null,
  protectedPlayerId: PlayerId | null = null
): PlayerId[] {
  const deaths = new Set<PlayerId>();
  if (attackedPlayerId && !saved && attackedPlayerId !== protectedPlayerId) deaths.add(attackedPlayerId);
  if (poisonTargetId) deaths.add(poisonTargetId);

  return players
    .filter((player) => deaths.has(player.id))
    .sort((left, right) => left.number - right.number)
    .map((player) => player.id);
}

export function evaluateGameOutcome(players: readonly OutcomePlayer[]): GameOutcome | null {
  const alive = players.filter((player) => player.alive && player.connection !== "departed");
  const goodWin = !alive.some((player) => player.role === "wolf");
  const wolfWin = !alive.some((player) => player.role === "villager")
    || !alive.some((player) => ["seer", "witch", "guard", "hunter", "idiot"].includes(player.role ?? ""));

  if (!goodWin && !wolfWin) return null;
  return goodWin && wolfWin ? "draw" : goodWin ? "good-win" : "wolf-win";
}
