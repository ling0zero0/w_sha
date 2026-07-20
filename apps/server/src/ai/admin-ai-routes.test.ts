import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import type { ServerConfig } from "../config.js";
import { GameRuntime } from "../runtime.js";
import { AiConfigStore } from "./ai-config-store.js";
import type { ModelProvider } from "./model-provider.js";
import { ProviderRegistry } from "./provider-registry.js";
import { AesGcmSecretBox } from "./secret-box.js";

const hostSession = "zyxwvutsrqponmlkjihgfedcba654321";
const config: ServerConfig = {
  HOST: "127.0.0.1",
  PORT: 3000,
  WEB_PORT: 5173,
  OPEN_BROWSER: false,
  DATABASE_PATH: ":memory:",
  LOG_LEVEL: "silent",
  NODE_ENV: "test"
};

const resources: Array<{ close(): void | Promise<void> }> = [];

afterEach(async () => {
  for (const resource of resources.splice(0).reverse()) {
    await resource.close();
  }
});

function createHarness(provider?: ModelProvider) {
  const store = new AiConfigStore(
    ":memory:",
    new AesGcmSecretBox(randomBytes(32))
  );
  const providers = new ProviderRegistry();
  providers.register("openai-compatible-chat", () => provider ?? {
    decide: async () => ({
      ok: false,
      error: {
        code: "PROVIDER_ERROR",
        message: "Provider unavailable.",
        retryable: true,
        httpStatus: 503
      },
      latencyMs: 1,
      completedAt: new Date(0).toISOString()
    }),
    testConnection: async () => ({
      ok: true,
      latencyMs: 1,
      completedAt: new Date(0).toISOString()
    })
  });
  const runtime = new GameRuntime({
    localAddress: "192.168.1.20",
    webPort: 5173,
    roomCode: "123456",
    joinToken: "abcdefghijklmnopqrstuvwxyz123456",
    hostSession
  });
  const app = buildServer(config, runtime, { store, providers });
  resources.push(store, app);
  return { app, store };
}

function headers() {
  return {
    origin: "http://127.0.0.1:5173",
    authorization: `Bearer ${hostSession}`
  };
}

describe("AI admin REST routes", () => {
  it("rejects remote, missing-token and spoofed proxy requests", async () => {
    const { app } = createHarness();

    const remote = await app.inject({
      method: "GET",
      url: "/api/admin/ai/overview",
      remoteAddress: "192.168.1.44",
      headers: headers()
    });
    const missingToken = await app.inject({
      method: "GET",
      url: "/api/admin/ai/overview",
      headers: { origin: headers().origin }
    });
    const forwardedRemote = await app.inject({
      method: "GET",
      url: "/api/admin/ai/overview",
      headers: {
        ...headers(),
        "x-werewolf-proxy-client-ip": "192.168.1.44"
      }
    });

    expect(remote.statusCode).toBe(403);
    expect(missingToken.statusCode).toBe(403);
    expect(forwardedRemote.statusCode).toBe(403);
    expect(remote.headers["cache-control"]).toBe("no-store");
  });

  it("supports configuration CRUD without returning stored credentials", async () => {
    const { app } = createHarness();
    const apiKey = "sk-test-secret-route-value";

    const providerResponse = await app.inject({
      method: "POST",
      url: "/api/admin/ai/providers",
      headers: headers(),
      payload: {
        name: "Local model",
        protocol: "openai-compatible-chat",
        baseUrl: "http://127.0.0.1:11434/v1",
        enabled: true,
        apiKey
      }
    });
    expect(providerResponse.statusCode).toBe(201);
    expect(providerResponse.body).not.toContain(apiKey);
    expect(providerResponse.json()).toMatchObject({
      credentialConfigured: true,
      credentialHint: "...alue"
    });
    const providerId = providerResponse.json().id as string;

    const modelResponse = await app.inject({
      method: "POST",
      url: "/api/admin/ai/models",
      headers: headers(),
      payload: {
        providerId,
        name: "Reasoner",
        model: "local-reasoner",
        enabled: true,
        temperature: 0.4,
        maxOutputTokens: 256,
        requestTimeoutMs: 10_000,
        maxAttemptsPerTurn: 1,
        gameTokenBudget: 20_000,
        fallbackModelProfileId: null
      }
    });
    expect(modelResponse.statusCode).toBe(201);
    const modelId = modelResponse.json().id as string;

    const botResponse = await app.inject({
      method: "POST",
      url: "/api/admin/ai/bot-profiles",
      headers: headers(),
      payload: {
        name: "Careful analyst",
        defaultNickname: "Analyst",
        description: "Uses public evidence.",
        personalityPrompt: "Reason carefully.",
        speakingStyle: "Concise.",
        strategy: "cautious",
        modelProfileId: modelId,
        enabled: true
      }
    });
    expect(botResponse.statusCode).toBe(201);

    const overview = await app.inject({
      method: "GET",
      url: "/api/admin/ai/overview",
      headers: headers()
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.body).not.toContain(apiKey);
    expect(overview.json()).toMatchObject({
      providers: [{ id: providerId }],
      models: [{ id: modelId }],
      botProfiles: [{ id: botResponse.json().id }]
    });

    const blockedDelete = await app.inject({
      method: "DELETE",
      url: `/api/admin/ai/providers/${providerId}`,
      headers: headers()
    });
    expect(blockedDelete.statusCode).toBe(409);
    expect(blockedDelete.body).not.toContain(apiKey);
  });

  it("returns classified connection errors without provider body leakage", async () => {
    const provider: ModelProvider = {
      decide: async () => {
        throw new Error("not used");
      },
      testConnection: async () => ({
        ok: false,
        error: {
          code: "AUTHENTICATION_FAILED",
          message: "The model provider rejected the credential.",
          retryable: false,
          httpStatus: 401
        },
        latencyMs: 4,
        completedAt: new Date(0).toISOString()
      })
    };
    const { app, store } = createHarness(provider);
    const createdProvider = store.createProvider({
      name: "Remote",
      protocol: "openai-compatible-chat",
      baseUrl: "https://models.example/v1",
      enabled: true,
      apiKey: "do-not-leak"
    });
    const model = store.createModelProfile({
      providerId: createdProvider.id,
      name: "Remote model",
      model: "missing",
      enabled: true,
      temperature: null,
      maxOutputTokens: 64,
      requestTimeoutMs: 5_000,
      maxAttemptsPerTurn: 1,
      gameTokenBudget: 1_000,
      fallbackModelProfileId: null
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/admin/ai/models/${model.id}/test`,
      headers: headers()
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "AUTHENTICATION_FAILED",
      message: "The model provider rejected the credential."
    });
    expect(response.body).not.toContain("do-not-leak");
  });
});
