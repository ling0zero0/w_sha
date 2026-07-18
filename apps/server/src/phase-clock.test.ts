import { describe, expect, it } from "vitest";
import { PhaseClock } from "./phase-clock.js";

describe("phase clock host controls", () => {
  it("preserves remaining time across pause and resume", () => {
    const clock = new PhaseClock();
    clock.start(60_000, 1_000);

    expect(clock.pause(21_000)).toMatchObject({ status: "paused", remainingMs: 40_000, deadlineAt: null });
    expect(clock.view(50_000).remainingMs).toBe(40_000);
    expect(clock.resume(51_000)).toEqual({
      status: "running",
      remainingMs: 40_000,
      deadlineAt: new Date(91_000).toISOString()
    });
  });

  it("adjusts running and paused clocks without allowing negative time", () => {
    const clock = new PhaseClock();
    clock.start(30_000, 0);
    expect(clock.adjust(10_000, 5_000).remainingMs).toBe(35_000);
    clock.pause(10_000);
    expect(clock.adjust(-40_000, 10_000).remainingMs).toBe(0);
  });

  it("ends the clock idempotently", () => {
    const clock = new PhaseClock();
    clock.start(30_000, 0);
    expect(clock.forceEnd(2_000)).toEqual({ status: "ended", remainingMs: 0, deadlineAt: null });
    expect(clock.forceEnd(3_000)).toEqual({ status: "ended", remainingMs: 0, deadlineAt: null });
  });
});
