import type { ClockStatus, PublicPhaseClock } from "@werewolf/shared";

export class PhaseClock {
  private status: ClockStatus = "idle";
  private deadlineMs: number | null = null;
  private pausedRemainingMs = 0;

  start(durationMs: number, nowMs = Date.now()): PublicPhaseClock {
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new Error("duration must be a positive integer");
    this.status = "running";
    this.deadlineMs = nowMs + durationMs;
    this.pausedRemainingMs = 0;
    return this.view(nowMs);
  }

  pause(nowMs = Date.now()): PublicPhaseClock {
    if (this.status !== "running" || this.deadlineMs === null) return this.view(nowMs);
    this.pausedRemainingMs = Math.max(0, this.deadlineMs - nowMs);
    this.deadlineMs = null;
    this.status = "paused";
    return this.view(nowMs);
  }

  resume(nowMs = Date.now()): PublicPhaseClock {
    if (this.status !== "paused") return this.view(nowMs);
    this.deadlineMs = nowMs + this.pausedRemainingMs;
    this.pausedRemainingMs = 0;
    this.status = "running";
    return this.view(nowMs);
  }

  adjust(deltaMs: number, nowMs = Date.now()): PublicPhaseClock {
    if (!Number.isSafeInteger(deltaMs)) throw new Error("adjustment must be an integer");
    if (this.status === "running" && this.deadlineMs !== null) {
      this.deadlineMs = Math.max(nowMs, this.deadlineMs + deltaMs);
    } else if (this.status === "paused") {
      this.pausedRemainingMs = Math.max(0, this.pausedRemainingMs + deltaMs);
    }
    return this.view(nowMs);
  }

  forceEnd(nowMs = Date.now()): PublicPhaseClock {
    this.status = "ended";
    this.deadlineMs = null;
    this.pausedRemainingMs = 0;
    return this.view(nowMs);
  }

  restorePaused(remainingMs: number): PublicPhaseClock {
    this.status = "paused";
    this.deadlineMs = null;
    this.pausedRemainingMs = Math.max(0, remainingMs);
    return this.view();
  }

  view(nowMs = Date.now()): PublicPhaseClock {
    const remainingMs = this.status === "running" && this.deadlineMs !== null
      ? Math.max(0, this.deadlineMs - nowMs)
      : this.status === "paused" ? this.pausedRemainingMs : 0;
    return {
      status: this.status,
      deadlineAt: this.deadlineMs === null ? null : new Date(this.deadlineMs).toISOString(),
      remainingMs
    };
  }
}
