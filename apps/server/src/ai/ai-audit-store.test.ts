import { afterEach, describe, expect, it } from "vitest";
import { AiAuditStore } from "./ai-audit-store.js";

const stores: AiAuditStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("AI audit store", () => {
  it("records decision outcomes and token usage without prompt or response fields", () => {
    const store = new AiAuditStore(":memory:");
    stores.push(store);
    const startedAt = "2026-08-01T08:00:00.000Z";
    const completedAt = "2026-08-01T08:00:00.125Z";
    const decisionId = store.recordAttempt({
      gameSessionId: "game-1",
      playerId: "11111111-1111-4111-8111-111111111111",
      decisionKey: "v1|phase=day-vote",
      roomRevision: 12,
      botProfileId: "22222222-2222-4222-8222-222222222222",
      botProfileRevision: 3,
      modelProfileId: "33333333-3333-4333-8333-333333333333",
      modelProfileRevision: 4,
      providerId: "44444444-4444-4444-8444-444444444444",
      model: "local-model",
      status: "success",
      intentType: "day-select-vote",
      latencyMs: 125,
      errorCode: null,
      startedAt,
      completedAt
    });
    store.recordUsage({
      decisionId,
      gameSessionId: "game-1",
      playerId: "11111111-1111-4111-8111-111111111111",
      botProfileId: "22222222-2222-4222-8222-222222222222",
      modelProfileId: "33333333-3333-4333-8333-333333333333",
      modelProfileRevision: 4,
      providerId: "44444444-4444-4444-8444-444444444444",
      model: "local-model",
      inputTokens: 80,
      outputTokens: 12,
      totalTokens: 92,
      createdAt: completedAt
    });

    expect(store.listAttempts()).toMatchObject([{
      id: decisionId,
      status: "success",
      latencyMs: 125,
      botProfileRevision: 3,
      modelProfileRevision: 4
    }]);
    expect(store.listUsage()).toMatchObject([{
      decisionId,
      inputTokens: 80,
      outputTokens: 12,
      totalTokens: 92
    }]);
    expect(JSON.stringify(store.listAttempts())).not.toContain("prompt");
    expect(JSON.stringify(store.listAttempts())).not.toContain("response");
  });

  it("keeps fallback and budget exhaustion visible as separate statuses", () => {
    const store = new AiAuditStore(":memory:");
    stores.push(store);
    const base = {
      gameSessionId: "game-2",
      playerId: "11111111-1111-4111-8111-111111111111",
      decisionKey: "decision",
      roomRevision: 2,
      botProfileId: null,
      botProfileRevision: null,
      modelProfileId: null,
      modelProfileRevision: null,
      providerId: null,
      model: null,
      intentType: null,
      latencyMs: 0,
      errorCode: null,
      startedAt: "2026-08-01T08:00:00.000Z",
      completedAt: "2026-08-01T08:00:00.000Z"
    } as const;
    store.recordAttempt({ ...base, status: "budget-exhausted", errorCode: "BUDGET_EXHAUSTED" });
    store.recordAttempt({ ...base, status: "fallback", errorCode: "TIMEOUT" });

    expect(store.listAttempts().map((attempt) => attempt.status)).toEqual(
      expect.arrayContaining(["fallback", "budget-exhausted"])
    );
  });
});
