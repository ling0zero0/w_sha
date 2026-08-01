import { describe, expect, it } from "vitest";
import { ActionLedger, actionFingerprint } from "./action-ledger.js";

const result = { ok: true as const, data: { revision: 3 } };

describe("ActionLedger", () => {
  it("replays the same action and detects event or payload conflicts", () => {
    const ledger = new ActionLedger();
    const actionId = "11111111-1111-4111-8111-111111111111";
    const fingerprint = actionFingerprint({ deltaMs: 15_000 });

    ledger.record("host", "host:adjust-phase-time", actionId, fingerprint, result);

    expect(ledger.lookup("host", "host:adjust-phase-time", actionId, fingerprint)).toEqual({
      kind: "replay",
      result
    });
    expect(ledger.lookup("host", "host:pause-phase", actionId, fingerprint)).toEqual({
      kind: "conflict"
    });
    expect(ledger.lookup(
      "host",
      "host:adjust-phase-time",
      actionId,
      actionFingerprint({ deltaMs: -15_000 })
    )).toEqual({ kind: "conflict" });
  });

  it("expires entries after the configured TTL", () => {
    let now = 1_000;
    const ledger = new ActionLedger(2, 100, () => now);
    const actionId = "22222222-2222-4222-8222-222222222222";
    const fingerprint = actionFingerprint({ value: 1 });

    ledger.record("player:one", "chat:send", actionId, fingerprint, result);
    expect(ledger.size()).toBe(1);

    now = 1_101;
    expect(ledger.lookup("player:one", "chat:send", actionId, fingerprint)).toEqual({
      kind: "miss"
    });
    expect(ledger.size()).toBe(0);
  });

  it("keeps the newest entries within the capacity limit", () => {
    const ledger = new ActionLedger(2);
    const first = "33333333-3333-4333-8333-333333333333";
    const second = "44444444-4444-4444-8444-444444444444";
    const third = "55555555-5555-4555-8555-555555555555";
    const fingerprint = actionFingerprint({ value: true });

    ledger.record("host", "one", first, fingerprint, result);
    ledger.record("host", "two", second, fingerprint, result);
    ledger.record("host", "three", third, fingerprint, result);

    expect(ledger.size()).toBe(2);
    expect(ledger.lookup("host", "one", first, fingerprint)).toEqual({ kind: "miss" });
    expect(ledger.lookup("host", "two", second, fingerprint).kind).toBe("replay");
    expect(ledger.lookup("host", "three", third, fingerprint).kind).toBe("replay");
  });

  it("uses the same fingerprint for objects with different key order", () => {
    expect(actionFingerprint({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(actionFingerprint({ a: { c: 3, d: 4 }, b: 2 }));
    expect(actionFingerprint(undefined)).not.toBe(actionFingerprint(null));
  });

  it("updates lifecycle metadata without changing the replay result", () => {
    const ledger = new ActionLedger();
    const actionId = "66666666-6666-4666-8666-666666666666";
    const fingerprint = actionFingerprint({ nickname: "接管目标" });

    ledger.record(
      "player:lifecycle",
      "player:request-takeover",
      actionId,
      fingerprint,
      result,
      { kind: "takeover", state: "pending" }
    );
    expect(ledger.setMetadata("player:lifecycle", actionId, {
      kind: "takeover",
      state: "approved"
    })).toBe(true);
    expect(ledger.lookup(
      "player:lifecycle",
      "player:request-takeover",
      actionId,
      fingerprint
    )).toEqual({
      kind: "replay",
      result,
      metadata: { kind: "takeover", state: "approved" }
    });
  });
});
