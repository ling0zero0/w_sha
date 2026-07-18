import { describe, expect, it } from "vitest";
import { formatRemainingMs, getRemainingMs } from "./phase-clock.js";

describe("phase clock display", () => {
  it("derives running time from the server deadline", () => {
    const clock = {
      status: "running" as const,
      deadlineAt: new Date(61_000).toISOString(),
      remainingMs: 60_000
    };

    expect(getRemainingMs(clock, 1_000)).toBe(60_000);
    expect(getRemainingMs(clock, 62_000)).toBe(0);
  });

  it("keeps paused time fixed and clears inactive clocks", () => {
    expect(getRemainingMs({ status: "paused", deadlineAt: null, remainingMs: 45_000 }, 99_000)).toBe(45_000);
    expect(getRemainingMs({ status: "idle", deadlineAt: null, remainingMs: 0 }, 99_000)).toBe(0);
    expect(getRemainingMs({ status: "ended", deadlineAt: null, remainingMs: 0 }, 99_000)).toBe(0);
  });

  it("rounds positive partial seconds up for display", () => {
    expect(formatRemainingMs(59_001)).toBe("01:00");
    expect(formatRemainingMs(59_000)).toBe("00:59");
    expect(formatRemainingMs(0)).toBe("00:00");
  });
});
