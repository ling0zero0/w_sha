import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AiDecisionResponse, ModelProvider } from "./model-provider.js";
import { AiAuditStore } from "./ai-audit-store.js";
import { BudgetLedger } from "./budget-ledger.js";
import { AiConfigStore } from "./ai-config-store.js";
import { AesGcmSecretBox } from "./secret-box.js";
import { ProviderRegistry } from "./provider-registry.js";
import { LlmBotAdapter } from "./llm-bot-adapter.js";
import type { PlayerLobbyView } from "@werewolf/shared";

function createView(selfId = "11111111-1111-4111-8111-111111111111"): PlayerLobbyView {
  return {
    roomCode: "123456",
    revision: 7,
    selfId,
    phase: "day-vote",
    players: [
      { id: selfId, number: 1, nickname: "AI", connection: "online", alive: true, controller: "bot", botKind: "llm", botProfileId: "44444444-4444-4444-8444-444444444444" },
      { id: "22222222-2222-4222-8222-222222222222", number: 2, nickname: "P2", connection: "online", alive: true, controller: "human", botKind: null, botProfileId: null }
    ],
    privateRole: { role: "villager", confirmed: true, wolfTeammates: [] },
    phaseClock: { status: "running", deadlineAt: new Date(Date.now() + 10000).toISOString(), remainingMs: 10000 },
    wolfAction: null,
    seerAction: null,
    guardAction: null,
    witchAction: null,
    hunterAction: null,
    dayState: null,
    dayVote: { eligible: true, target: null, confirmed: false, candidates: [{ id: "22222222-2222-4222-8222-222222222222", number: 2, nickname: "P2" }] },
    chatMode: "off",
    revealedIdiotId: null,
    roleConfirmation: { confirmedCount: 2, totalCount: 2 },
    nightProgress: null,
    dawnResult: null,
    takeoverRequest: null,
    gameResult: null,
    publicChat: { canSend: false, messages: [] }
  } as unknown as PlayerLobbyView;
}


function harness(response: AiDecisionResponse) {
  const store = new AiConfigStore(":memory:", new AesGcmSecretBox(randomBytes(32)));
  const provider = store.createProvider({ name: "test", protocol: "openai-compatible-chat", baseUrl: "http://127.0.0.1:9999/v1", enabled: true, apiKey: "secret-test-key" });
  const model = store.createModelProfile({ providerId: provider.id, name: "model", model: "test-model", enabled: true, temperature: 0, maxOutputTokens: 64, requestTimeoutMs: 1000, maxAttemptsPerTurn: 1, gameTokenBudget: 1024, fallbackModelProfileId: null });
  const profile = store.createBotProfile({ name: "bot", defaultNickname: "AI", description: "", personalityPrompt: "play carefully", speakingStyle: "brief", strategy: "balanced", modelProfileId: model.id, enabled: true });
  const decide = vi.fn(async (_request: unknown, _signal: AbortSignal) => response);
  const registry = new ProviderRegistry();
  registry.register("openai-compatible-chat", () => ({ decide, testConnection: vi.fn() } as unknown as ModelProvider));
  return { store, profile, model, registry, decide };
}

describe("LlmBotAdapter", () => {
  it("returns an allowed model intent built from the authorized player view", async () => {
    const h = harness({ ok: true, latencyMs: 5, completedAt: new Date().toISOString(), usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, decision: { protocolVersion: 1, intent: { type: "day-select-vote", payload: { target: "22222222-2222-4222-8222-222222222222" } } } });
    const adapter = new LlmBotAdapter({ playerId: createView().selfId, botProfileId: h.profile.id, gameId: () => "game-1", store: h.store, providers: h.registry });
    expect(adapter.turnTimeoutMs).toBe(2_000);
    const intent = await adapter.onView(createView(), { playerId: createView().selfId, revision: 7, deadlineAt: new Date().toISOString(), signal: new AbortController().signal });
    expect(intent).toEqual({ type: "day-select-vote", payload: { target: "22222222-2222-4222-8222-222222222222" } });
    expect(h.decide).toHaveBeenCalledOnce();
    const request = h.decide.mock.calls[0]?.[0];
    expect(JSON.stringify(request)).not.toContain("secret-test-key");
    h.store.close();
  });

  it("uses deterministic fallback when the provider fails", async () => {
    const h = harness({ ok: false, latencyMs: 5, completedAt: new Date().toISOString(), error: { code: "NETWORK_ERROR", message: "safe", retryable: true, httpStatus: null } });
    const fallback = vi.fn();
    const adapter = new LlmBotAdapter({ playerId: createView().selfId, botProfileId: h.profile.id, gameId: () => "game-1", store: h.store, providers: h.registry, onFallback: fallback });
    const intent = await adapter.onView(createView(), { playerId: createView().selfId, revision: 7, deadlineAt: new Date().toISOString(), signal: new AbortController().signal });
    expect(intent).toEqual({ type: "day-select-vote", payload: { target: "22222222-2222-4222-8222-222222222222" } });
    expect(fallback).toHaveBeenCalledWith("model-failed", "NETWORK_ERROR");
    h.store.close();
  });

  it("does not call a model for deterministic gate actions", async () => {
    const h = harness({ ok: false, latencyMs: 0, completedAt: new Date().toISOString(), error: { code: "PROVIDER_ERROR", message: "safe", retryable: false, httpStatus: 500 } });
    const view = createView();
    view.dayVote = { ...view.dayVote!, target: "22222222-2222-4222-8222-222222222222" };
    const adapter = new LlmBotAdapter({ playerId: view.selfId, botProfileId: h.profile.id, gameId: () => "game-1", store: h.store, providers: h.registry });
    expect(await adapter.onView(view, { playerId: view.selfId, revision: 7, deadlineAt: new Date().toISOString(), signal: new AbortController().signal })).toEqual({ type: "day-confirm-vote", payload: { confirmed: true } });
    expect(h.decide).not.toHaveBeenCalled();
    h.store.close();
  });

  it("shares a room token budget across concurrent LLM seats", async () => {
    const h = harness({ ok: true, latencyMs: 5, completedAt: new Date().toISOString(), usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, decision: { protocolVersion: 1, intent: { type: "day-select-vote", payload: { target: "22222222-2222-4222-8222-222222222222" } } } });
    const ledger = new BudgetLedger();
    const firstAdapter = new LlmBotAdapter({
      playerId: "11111111-1111-4111-8111-111111111111",
      botProfileId: h.profile.id,
      gameId: () => "game-shared",
      store: h.store,
      providers: h.registry,
      budgetLedger: ledger,
      gameTokenBudget: 64
    });
    const secondAdapter = new LlmBotAdapter({
      playerId: "55555555-5555-4555-8555-555555555555",
      botProfileId: h.profile.id,
      gameId: () => "game-shared",
      store: h.store,
      providers: h.registry,
      budgetLedger: ledger,
      gameTokenBudget: 64
    });

    let release: (() => void) | null = null;
    h.decide.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return {
        ok: true,
        latencyMs: 5,
        completedAt: new Date().toISOString(),
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        decision: {
          protocolVersion: 1,
          intent: { type: "day-select-vote", payload: { target: "22222222-2222-4222-8222-222222222222" } }
        }
      };
    });

    const first = firstAdapter.onView(createView(), {
      playerId: "11111111-1111-4111-8111-111111111111",
      revision: 7,
      deadlineAt: new Date().toISOString(),
      signal: new AbortController().signal
    });
    await vi.waitFor(() => expect(h.decide).toHaveBeenCalledOnce());
    const second = secondAdapter.onView(createView("55555555-5555-4555-8555-555555555555"), {
      playerId: "55555555-5555-4555-8555-555555555555",
      revision: 7,
      deadlineAt: new Date().toISOString(),
      signal: new AbortController().signal
    });
    expect(await second).toEqual({
      type: "day-select-vote",
      payload: { target: "22222222-2222-4222-8222-222222222222" }
    });
    release!();
    expect(await first).toEqual({
      type: "day-select-vote",
      payload: { target: "22222222-2222-4222-8222-222222222222" }
    });
    expect(h.decide).toHaveBeenCalledOnce();
    expect(ledger.getGameUsage("game-shared")).toEqual({ settledTokens: 15, reservedTokens: 0 });
    h.store.close();
  });

  it("records successful model usage and locks configuration revisions for a game", async () => {
    const h = harness({ ok: true, latencyMs: 5, completedAt: new Date().toISOString(), usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, decision: { protocolVersion: 1, intent: { type: "day-select-vote", payload: { target: "22222222-2222-4222-8222-222222222222" } } } });
    const auditStore = new AiAuditStore(":memory:");
    const adapter = new LlmBotAdapter({
      playerId: createView().selfId,
      botProfileId: h.profile.id,
      gameId: () => "game-locked",
      store: h.store,
      providers: h.registry,
      auditStore
    });
    adapter.lockForGame("game-locked");
    h.store.updateModelProfile(h.model.id, { model: "changed-after-start" });

    const view = createView();
    await adapter.onView(view, {
      playerId: view.selfId,
      revision: view.revision,
      deadlineAt: new Date().toISOString(),
      signal: new AbortController().signal
    });

    expect(h.decide.mock.calls[0]?.[0]).toMatchObject({
      model: { model: "test-model", revision: 1 }
    });
    expect(auditStore.listAttempts()).toMatchObject([{
      status: "success",
      botProfileRevision: 1,
      modelProfileRevision: 1
    }]);
    expect(auditStore.listUsage()).toMatchObject([{
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15
    }]);
    auditStore.close();
    h.store.close();
  });
});
