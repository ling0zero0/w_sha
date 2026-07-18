import type { PublicPhaseClock } from "@werewolf/shared";

export function getRemainingMs(clock: PublicPhaseClock, nowMs = Date.now()): number {
  if (clock.status === "running" && clock.deadlineAt) {
    return Math.max(0, Date.parse(clock.deadlineAt) - nowMs);
  }

  return clock.status === "paused" ? clock.remainingMs : 0;
}

export function formatRemainingMs(remainingMs: number): string {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
