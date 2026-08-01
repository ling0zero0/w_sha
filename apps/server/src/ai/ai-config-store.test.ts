import { randomBytes } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AiConfigStore } from "./ai-config-store.js";
import { AesGcmSecretBox } from "./secret-box.js";

const stores: AiConfigStore[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createStore(
  path = ":memory:",
  secretBox: AesGcmSecretBox | null = new AesGcmSecretBox(randomBytes(32))
): AiConfigStore {
  const store = new AiConfigStore(path, secretBox);
  stores.push(store);
  return store;
}

function createProvider(store: AiConfigStore, name = "Provider", apiKey?: string) {
  return store.createProvider({
    name,
    protocol: "openai-compatible-chat",
    baseUrl: "http://127.0.0.1:11434/v1",
    enabled: true,
    ...(apiKey === undefined ? {} : { apiKey })
  });
}

function createModel(
  store: AiConfigStore,
  providerId: string,
  name = "Model",
  fallbackModelProfileId: string | null = null
) {
  return store.createModelProfile({
    providerId,
    name,
    model: name.toLowerCase().replaceAll(" ", "-"),
    enabled: true,
    temperature: 0.4,
    maxOutputTokens: 1_024,
    requestTimeoutMs: 20_000,
    maxAttemptsPerTurn: 2,
    gameTokenBudget: 20_000,
    fallbackModelProfileId
  });
}

function createBot(store: AiConfigStore, modelProfileId: string, name = "Analyst") {
  return store.createBotProfile({
    name,
    defaultNickname: name.slice(0, 12),
    description: "Evidence-driven player.",
    personalityPrompt: "Prefer concrete evidence and disclose uncertainty.",
    speakingStyle: "Use short, direct statements.",
    strategy: "cautious",
    modelProfileId,
    enabled: true
  });
}

describe("SQLite AI configuration store", () => {
  it("applies its migration without replacing existing runtime data", () => {
    const directory = mkdtempSync(join(tmpdir(), "werewolf-ai-migration-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "runtime.sqlite");
    const database = new DatabaseSync(path);
    database.exec(`
      CREATE TABLE runtime_snapshot (
        id INTEGER PRIMARY KEY,
        payload TEXT NOT NULL
      );
      INSERT INTO runtime_snapshot (id, payload)
      VALUES (1, '{"version":2}');
    `);
    database.close();

    createStore(path);
    const migratedDatabase = new DatabaseSync(path);
    const migration = migratedDatabase.prepare(`
      SELECT version
      FROM schema_migrations
      WHERE version = 1
    `).get() as { version: number };
    const revisionColumn = migratedDatabase.prepare(`
      PRAGMA table_info(ai_model_profiles)
    `).all() as Array<{ name: string }>;
    const snapshot = migratedDatabase.prepare(`
      SELECT payload
      FROM runtime_snapshot
      WHERE id = 1
    `).get() as { payload: string };
    migratedDatabase.close();

    expect(migration.version).toBe(1);
    expect(revisionColumn.some((column) => column.name === "revision")).toBe(true);
    expect(snapshot.payload).toBe('{"version":2}');
  });

  it("persists provider, model and bot profile CRUD with redacted provider reads", () => {
    const directory = mkdtempSync(join(tmpdir(), "werewolf-ai-config-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "runtime.sqlite");
    const secretBox = new AesGcmSecretBox(randomBytes(32));
    const first = createStore(path, secretBox);

    const provider = createProvider(first, "Local provider", "sk-secret-value");
    expect(provider).toMatchObject({
      credentialConfigured: true,
      credentialHint: "...alue"
    });
    expect(provider).not.toHaveProperty("apiKey");

    const model = createModel(first, provider.id, "Primary model");
    const bot = createBot(first, model.id);
    expect(model.revision).toBe(1);
    expect(bot.revision).toBe(1);
    expect(first.getConfiguration()).toEqual({
      providers: [provider],
      models: [model],
      botProfiles: [bot]
    });
    expect(first.getProviderCredential(provider.id)).toBe("sk-secret-value");

    expect(first.updateProvider(provider.id, {
      name: "Updated provider",
      enabled: false
    })).toMatchObject({
      name: "Updated provider",
      enabled: false,
      credentialConfigured: true
    });
    const updatedModel = first.updateModelProfile(model.id, {
      temperature: null,
      maxOutputTokens: 2_048,
      gameTokenBudget: 30_000
    });
    expect(updatedModel).toMatchObject({
      temperature: null,
      maxOutputTokens: 2_048,
      gameTokenBudget: 30_000
    });
    expect(updatedModel.revision).toBe(2);
    const updatedBot = first.updateBotProfile(bot.id, {
      strategy: "balanced",
      speakingStyle: "Ask concise questions."
    });
    expect(updatedBot).toMatchObject({
      strategy: "balanced",
      speakingStyle: "Ask concise questions."
    });
    expect(updatedBot.revision).toBe(2);

    first.close();
    stores.splice(stores.indexOf(first), 1);
    const second = createStore(path, secretBox);
    expect(second.getProviderCredential(provider.id)).toBe("sk-secret-value");
    expect(second.getConfiguration()).toMatchObject({
      providers: [{ name: "Updated provider" }],
      models: [{ maxOutputTokens: 2_048 }],
      botProfiles: [{ strategy: "balanced" }]
    });

    second.deleteBotProfile(bot.id);
    second.deleteModelProfile(model.id);
    second.deleteProvider(provider.id);
    expect(second.getConfiguration()).toEqual({
      providers: [],
      models: [],
      botProfiles: []
    });
  });

  it("encrypts credentials and never stores the plaintext API key in SQLite", () => {
    const directory = mkdtempSync(join(tmpdir(), "werewolf-ai-secret-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "runtime.sqlite");
    const plaintext = "sk-plaintext-sentinel-7f9c2e";
    const store = createStore(path);
    const provider = createProvider(store, "Encrypted provider", plaintext);

    const database = new DatabaseSync(path);
    const row = database.prepare(`
      SELECT typeof(ciphertext) AS ciphertext_type, ciphertext, nonce, auth_tag
      FROM ai_provider_secrets
      WHERE provider_id = ?
    `).get(provider.id) as unknown as {
      ciphertext_type: string;
      ciphertext: Uint8Array;
      nonce: Uint8Array;
      auth_tag: Uint8Array;
    };
    database.close();

    expect(row.ciphertext_type).toBe("blob");
    expect(Buffer.from(row.ciphertext).toString("utf8")).not.toContain(plaintext);
    expect(Buffer.from(row.nonce)).toHaveLength(12);
    expect(Buffer.from(row.auth_tag)).toHaveLength(16);
    expect(readFileSync(path).includes(Buffer.from(plaintext, "utf8"))).toBe(false);
    expect(JSON.stringify(store.getConfiguration())).not.toContain(plaintext);
  });

  it("atomically replaces and explicitly clears credentials", () => {
    const store = createStore();
    const provider = createProvider(store, "Credential provider", "old-secret");
    createProvider(store, "Existing provider");

    expect(store.updateProvider(provider.id, { apiKey: "new-secret" })).toMatchObject({
      credentialConfigured: true,
      credentialHint: "...cret"
    });
    expect(store.getProviderCredential(provider.id)).toBe("new-secret");
    expect(() => store.updateProvider(provider.id, {
      name: "Existing provider",
      apiKey: "must-roll-back"
    })).toThrow();
    expect(store.getProvider(provider.id)?.name).toBe("Credential provider");
    expect(store.getProviderCredential(provider.id)).toBe("new-secret");

    expect(store.updateProvider(provider.id, { clearCredential: true })).toMatchObject({
      credentialConfigured: false,
      credentialHint: null
    });
    expect(store.getProviderCredential(provider.id)).toBeNull();
  });

  it("rejects credential writes without a secure key before changing data", () => {
    const store = createStore(":memory:", null);

    expect(() => createProvider(store, "Rejected provider", "secret")).toThrow(
      "AI credential cannot be stored without a secure secret box"
    );
    expect(store.listProviders()).toEqual([]);

    const provider = createProvider(store, "Allowed provider");
    expect(() => store.updateProvider(provider.id, {
      name: "Should not persist",
      apiKey: "secret"
    })).toThrow("AI credential cannot be stored without a secure secret box");
    expect(store.getProvider(provider.id)?.name).toBe("Allowed provider");
  });

  it("enforces unique names, foreign keys and delete restrictions", () => {
    const store = createStore();
    const provider = createProvider(store, "Unique provider");
    expect(() => createProvider(store, "Unique provider")).toThrow();

    expect(() => createModel(
      store,
      "00000000-0000-4000-8000-000000000001",
      "Missing provider"
    )).toThrow("AI provider not found");

    const model = createModel(store, provider.id, "Referenced model");
    const bot = createBot(store, model.id, "Referenced bot");
    expect(() => store.deleteProvider(provider.id)).toThrow("referenced by a model profile");
    expect(() => store.deleteModelProfile(model.id)).toThrow("referenced by a bot profile");

    store.deleteBotProfile(bot.id);
    const fallback = createModel(store, provider.id, "Fallback model", model.id);
    expect(() => store.deleteModelProfile(model.id)).toThrow("used as a fallback");
    store.deleteModelProfile(fallback.id);
    store.deleteModelProfile(model.id);
    store.deleteProvider(provider.id);
  });

  it("rejects direct and transitive fallback cycles without mutating profiles", () => {
    const store = createStore();
    const provider = createProvider(store);
    const first = createModel(store, provider.id, "First");
    const second = createModel(store, provider.id, "Second", first.id);
    const third = createModel(store, provider.id, "Third", second.id);

    expect(() => store.updateModelProfile(first.id, {
      fallbackModelProfileId: first.id
    })).toThrow();
    expect(() => store.updateModelProfile(first.id, {
      fallbackModelProfileId: third.id
    })).toThrow("fallback chain must not contain a cycle");
    expect(store.getModelProfile(first.id)?.fallbackModelProfileId).toBeNull();
  });

  it("validates merged model budgets on partial updates", () => {
    const store = createStore();
    const provider = createProvider(store);
    const model = createModel(store, provider.id);

    expect(() => store.updateModelProfile(model.id, {
      gameTokenBudget: 100
    })).toThrow("gameTokenBudget must cover at least one maximum-size response");
    expect(store.getModelProfile(model.id)?.gameTokenBudget).toBe(20_000);
  });
});
