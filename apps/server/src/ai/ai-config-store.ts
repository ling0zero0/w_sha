import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  aiBotProfileViewSchema,
  aiConfigurationViewSchema,
  aiModelProfileViewSchema,
  aiProviderViewSchema,
  createAiBotProfileRequestSchema,
  createAiModelProfileRequestSchema,
  createAiProviderRequestSchema,
  updateAiBotProfileRequestSchema,
  updateAiModelProfileRequestSchema,
  updateAiProviderRequestSchema,
  type AiBotProfileView,
  type AiConfigurationView,
  type AiModelProfileView,
  type AiProviderView,
  type CreateAiBotProfileRequest,
  type CreateAiModelProfileRequest,
  type CreateAiProviderRequest,
  type UpdateAiBotProfileRequest,
  type UpdateAiModelProfileRequest,
  type UpdateAiProviderRequest
} from "@werewolf/shared";
import { runAiConfigMigrations } from "./migrations.js";
import type { EncryptedSecret, SecretBox } from "./secret-box.js";

interface ProviderRow {
  id: string;
  name: string;
  protocol: string;
  base_url: string;
  enabled: number;
  credential_hint: string | null;
  credential_configured: number;
  created_at: string;
  updated_at: string;
}

interface ProviderSecretRow {
  key_version: number;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  auth_tag: Uint8Array;
}

interface ModelProfileRow {
  id: string;
  revision: number;
  provider_id: string;
  name: string;
  model: string;
  enabled: number;
  temperature: number | null;
  max_output_tokens: number;
  request_timeout_ms: number;
  max_attempts_per_turn: number;
  game_token_budget: number;
  fallback_model_profile_id: string | null;
}

interface BotProfileRow {
  id: string;
  revision: number;
  name: string;
  default_nickname: string;
  description: string;
  personality_prompt: string;
  speaking_style: string;
  strategy: string;
  model_profile_id: string;
  enabled: number;
}

const providerSelect = `
  SELECT
    providers.id,
    providers.name,
    providers.protocol,
    providers.base_url,
    providers.enabled,
    secrets.credential_hint,
    CASE WHEN secrets.provider_id IS NULL THEN 0 ELSE 1 END AS credential_configured,
    providers.created_at,
    providers.updated_at
  FROM ai_providers AS providers
  LEFT JOIN ai_provider_secrets AS secrets
    ON secrets.provider_id = providers.id
`;

const modelProfileSelect = `
  SELECT
    id,
    revision,
    provider_id,
    name,
    model,
    enabled,
    temperature,
    max_output_tokens,
    request_timeout_ms,
    max_attempts_per_turn,
    game_token_budget,
    fallback_model_profile_id
  FROM ai_model_profiles
`;

const botProfileSelect = `
  SELECT
    id,
    revision,
    name,
    default_nickname,
    description,
    personality_prompt,
    speaking_style,
    strategy,
    model_profile_id,
    enabled
  FROM ai_bot_profiles
`;

export class AiConfigStore {
  private readonly database: DatabaseSync;
  private readonly secretBox: SecretBox | null;

  constructor(path: string, secretBox: SecretBox | null = null) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.secretBox = secretBox;
    runAiConfigMigrations(this.database);
  }

  close(): void {
    this.database.close();
  }

  getConfiguration(): AiConfigurationView {
    return aiConfigurationViewSchema.parse({
      providers: this.listProviders(),
      models: this.listModelProfiles(),
      botProfiles: this.listBotProfiles()
    });
  }

  listProviders(): AiProviderView[] {
    const rows = this.database.prepare(`
      ${providerSelect}
      ORDER BY providers.name, providers.id
    `).all() as unknown as ProviderRow[];
    return rows.map(parseProvider);
  }

  getProvider(id: string): AiProviderView | null {
    const row = this.database.prepare(`
      ${providerSelect}
      WHERE providers.id = ?
    `).get(id) as unknown as ProviderRow | undefined;
    return row ? parseProvider(row) : null;
  }

  createProvider(rawInput: CreateAiProviderRequest): AiProviderView {
    const input = createAiProviderRequestSchema.parse(rawInput);
    const id = randomUUID();
    const now = new Date().toISOString();
    const encrypted = input.apiKey === undefined
      ? null
      : this.sealCredential(id, input.apiKey);

    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO ai_providers (
          id, name, protocol, base_url, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.name,
        input.protocol,
        input.baseUrl,
        booleanInteger(input.enabled),
        now,
        now
      );
      if (encrypted) this.writeCredential(id, input.apiKey!, encrypted, now);
    });

    return this.requireProvider(id);
  }

  updateProvider(id: string, rawInput: UpdateAiProviderRequest): AiProviderView {
    const input = updateAiProviderRequestSchema.parse(rawInput);
    const current = this.requireProvider(id);
    const now = new Date().toISOString();
    const encrypted = input.apiKey === undefined
      ? null
      : this.sealCredential(id, input.apiKey);

    this.transaction(() => {
      this.database.prepare(`
        UPDATE ai_providers
        SET name = ?, protocol = ?, base_url = ?, enabled = ?, updated_at = ?
        WHERE id = ?
      `).run(
        input.name ?? current.name,
        input.protocol ?? current.protocol,
        input.baseUrl ?? current.baseUrl,
        booleanInteger(input.enabled ?? current.enabled),
        now,
        id
      );

      if (encrypted) {
        this.writeCredential(id, input.apiKey!, encrypted, now);
      } else if (input.clearCredential === true) {
        this.database.prepare(`
          DELETE FROM ai_provider_secrets
          WHERE provider_id = ?
        `).run(id);
      }
    });

    return this.requireProvider(id);
  }

  deleteProvider(id: string): void {
    this.requireProvider(id);
    const reference = this.database.prepare(`
      SELECT id
      FROM ai_model_profiles
      WHERE provider_id = ?
      LIMIT 1
    `).get(id) as { id: string } | undefined;
    if (reference) {
      throw new Error(`cannot delete AI provider ${id}: it is referenced by a model profile`);
    }
    this.database.prepare("DELETE FROM ai_providers WHERE id = ?").run(id);
  }

  getProviderCredential(id: string): string | null {
    this.requireProvider(id);
    const row = this.database.prepare(`
      SELECT key_version, ciphertext, nonce, auth_tag
      FROM ai_provider_secrets
      WHERE provider_id = ?
    `).get(id) as unknown as ProviderSecretRow | undefined;
    if (!row) return null;
    if (!this.secretBox) {
      throw new Error("AI credential cannot be read without a secure secret box");
    }
    return this.secretBox.open(credentialPurpose(id), {
      version: 1,
      keyVersion: row.key_version,
      ciphertext: Buffer.from(row.ciphertext).toString("base64"),
      nonce: Buffer.from(row.nonce).toString("base64"),
      authTag: Buffer.from(row.auth_tag).toString("base64")
    });
  }

  listModelProfiles(): AiModelProfileView[] {
    const rows = this.database.prepare(`
      ${modelProfileSelect}
      ORDER BY name, id
    `).all() as unknown as ModelProfileRow[];
    return rows.map(parseModelProfile);
  }

  getModelProfile(id: string): AiModelProfileView | null {
    const row = this.database.prepare(`
      ${modelProfileSelect}
      WHERE id = ?
    `).get(id) as unknown as ModelProfileRow | undefined;
    return row ? parseModelProfile(row) : null;
  }

  createModelProfile(rawInput: CreateAiModelProfileRequest): AiModelProfileView {
    const input = createAiModelProfileRequestSchema.parse(rawInput);
    const id = randomUUID();
    this.requireProvider(input.providerId);
    this.validateFallbackChain(id, input.fallbackModelProfileId);
    const now = new Date().toISOString();

    this.database.prepare(`
      INSERT INTO ai_model_profiles (
        id,
        revision,
        provider_id,
        name,
        model,
        enabled,
        temperature,
        max_output_tokens,
        request_timeout_ms,
        max_attempts_per_turn,
        game_token_budget,
        fallback_model_profile_id,
        created_at,
        updated_at
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.providerId,
      input.name,
      input.model,
      booleanInteger(input.enabled),
      input.temperature,
      input.maxOutputTokens,
      input.requestTimeoutMs,
      input.maxAttemptsPerTurn,
      input.gameTokenBudget,
      input.fallbackModelProfileId,
      now,
      now
    );

    return this.requireModelProfile(id);
  }

  updateModelProfile(
    id: string,
    rawInput: UpdateAiModelProfileRequest
  ): AiModelProfileView {
    const input = updateAiModelProfileRequestSchema.parse(rawInput);
    const current = this.requireModelProfile(id);
    const updated = aiModelProfileViewSchema.parse({
      ...current,
      ...input
    });
    this.requireProvider(updated.providerId);
    this.validateFallbackChain(id, updated.fallbackModelProfileId);

    this.database.prepare(`
      UPDATE ai_model_profiles
      SET
        revision = revision + 1,
        provider_id = ?,
        name = ?,
        model = ?,
        enabled = ?,
        temperature = ?,
        max_output_tokens = ?,
        request_timeout_ms = ?,
        max_attempts_per_turn = ?,
        game_token_budget = ?,
        fallback_model_profile_id = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      updated.providerId,
      updated.name,
      updated.model,
      booleanInteger(updated.enabled),
      updated.temperature,
      updated.maxOutputTokens,
      updated.requestTimeoutMs,
      updated.maxAttemptsPerTurn,
      updated.gameTokenBudget,
      updated.fallbackModelProfileId,
      new Date().toISOString(),
      id
    );

    return this.requireModelProfile(id);
  }

  deleteModelProfile(id: string): void {
    this.requireModelProfile(id);
    const botReference = this.database.prepare(`
      SELECT id
      FROM ai_bot_profiles
      WHERE model_profile_id = ?
      LIMIT 1
    `).get(id) as { id: string } | undefined;
    if (botReference) {
      throw new Error(`cannot delete AI model profile ${id}: it is referenced by a bot profile`);
    }
    const fallbackReference = this.database.prepare(`
      SELECT id
      FROM ai_model_profiles
      WHERE fallback_model_profile_id = ?
      LIMIT 1
    `).get(id) as { id: string } | undefined;
    if (fallbackReference) {
      throw new Error(`cannot delete AI model profile ${id}: it is used as a fallback`);
    }
    this.database.prepare("DELETE FROM ai_model_profiles WHERE id = ?").run(id);
  }

  listBotProfiles(): AiBotProfileView[] {
    const rows = this.database.prepare(`
      ${botProfileSelect}
      ORDER BY name, id
    `).all() as unknown as BotProfileRow[];
    return rows.map(parseBotProfile);
  }

  getBotProfile(id: string): AiBotProfileView | null {
    const row = this.database.prepare(`
      ${botProfileSelect}
      WHERE id = ?
    `).get(id) as unknown as BotProfileRow | undefined;
    return row ? parseBotProfile(row) : null;
  }

  createBotProfile(rawInput: CreateAiBotProfileRequest): AiBotProfileView {
    const input = createAiBotProfileRequestSchema.parse(rawInput);
    this.requireModelProfile(input.modelProfileId);
    const id = randomUUID();
    const now = new Date().toISOString();

    this.database.prepare(`
      INSERT INTO ai_bot_profiles (
        id,
        name,
        default_nickname,
        description,
        personality_prompt,
        speaking_style,
        strategy,
        model_profile_id,
        enabled,
        revision,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      input.name,
      input.defaultNickname,
      input.description,
      input.personalityPrompt,
      input.speakingStyle,
      input.strategy,
      input.modelProfileId,
      booleanInteger(input.enabled),
      now,
      now
    );

    return this.requireBotProfile(id);
  }

  updateBotProfile(
    id: string,
    rawInput: UpdateAiBotProfileRequest
  ): AiBotProfileView {
    const input = updateAiBotProfileRequestSchema.parse(rawInput);
    const current = this.requireBotProfile(id);
    const updated = aiBotProfileViewSchema.parse({
      ...current,
      ...input
    });
    this.requireModelProfile(updated.modelProfileId);

    this.database.prepare(`
      UPDATE ai_bot_profiles
      SET
        name = ?,
        default_nickname = ?,
        description = ?,
        personality_prompt = ?,
        speaking_style = ?,
        strategy = ?,
        model_profile_id = ?,
        enabled = ?,
        revision = revision + 1,
        updated_at = ?
      WHERE id = ?
    `).run(
      updated.name,
      updated.defaultNickname,
      updated.description,
      updated.personalityPrompt,
      updated.speakingStyle,
      updated.strategy,
      updated.modelProfileId,
      booleanInteger(updated.enabled),
      new Date().toISOString(),
      id
    );

    return this.requireBotProfile(id);
  }

  deleteBotProfile(id: string): void {
    this.requireBotProfile(id);
    this.database.prepare("DELETE FROM ai_bot_profiles WHERE id = ?").run(id);
  }

  private requireProvider(id: string): AiProviderView {
    const provider = this.getProvider(id);
    if (!provider) throw new Error(`AI provider not found: ${id}`);
    return provider;
  }

  private requireModelProfile(id: string): AiModelProfileView {
    const model = this.getModelProfile(id);
    if (!model) throw new Error(`AI model profile not found: ${id}`);
    return model;
  }

  private requireBotProfile(id: string): AiBotProfileView {
    const profile = this.getBotProfile(id);
    if (!profile) throw new Error(`AI bot profile not found: ${id}`);
    return profile;
  }

  private sealCredential(providerId: string, apiKey: string): EncryptedSecret {
    if (!this.secretBox) {
      throw new Error("AI credential cannot be stored without a secure secret box");
    }
    return this.secretBox.seal(credentialPurpose(providerId), apiKey);
  }

  private writeCredential(
    providerId: string,
    apiKey: string,
    encrypted: EncryptedSecret,
    updatedAt: string
  ): void {
    this.database.prepare(`
      INSERT INTO ai_provider_secrets (
        provider_id,
        key_version,
        ciphertext,
        nonce,
        auth_tag,
        credential_hint,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id) DO UPDATE SET
        key_version = excluded.key_version,
        ciphertext = excluded.ciphertext,
        nonce = excluded.nonce,
        auth_tag = excluded.auth_tag,
        credential_hint = excluded.credential_hint,
        updated_at = excluded.updated_at
    `).run(
      providerId,
      encrypted.keyVersion,
      Buffer.from(encrypted.ciphertext, "base64"),
      Buffer.from(encrypted.nonce, "base64"),
      Buffer.from(encrypted.authTag, "base64"),
      credentialHint(apiKey),
      updatedAt
    );
  }

  private validateFallbackChain(
    modelProfileId: string,
    fallbackModelProfileId: string | null
  ): void {
    if (fallbackModelProfileId === null) return;

    const visited = new Set<string>([modelProfileId]);
    let currentId: string | null = fallbackModelProfileId;
    while (currentId !== null) {
      if (visited.has(currentId)) {
        throw new Error("AI model fallback chain must not contain a cycle");
      }
      visited.add(currentId);
      const current = this.getModelProfile(currentId);
      if (!current) throw new Error(`AI model profile not found: ${currentId}`);
      currentId = current.fallbackModelProfileId;
    }
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function parseProvider(row: ProviderRow): AiProviderView {
  return aiProviderViewSchema.parse({
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    baseUrl: row.base_url,
    enabled: row.enabled === 1,
    credentialConfigured: row.credential_configured === 1,
    credentialHint: row.credential_hint,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function parseModelProfile(row: ModelProfileRow): AiModelProfileView {
  return aiModelProfileViewSchema.parse({
    id: row.id,
    revision: row.revision,
    providerId: row.provider_id,
    name: row.name,
    model: row.model,
    enabled: row.enabled === 1,
    temperature: row.temperature,
    maxOutputTokens: row.max_output_tokens,
    requestTimeoutMs: row.request_timeout_ms,
    maxAttemptsPerTurn: row.max_attempts_per_turn,
    gameTokenBudget: row.game_token_budget,
    fallbackModelProfileId: row.fallback_model_profile_id
  });
}

function parseBotProfile(row: BotProfileRow): AiBotProfileView {
  return aiBotProfileViewSchema.parse({
    id: row.id,
    revision: row.revision,
    name: row.name,
    defaultNickname: row.default_nickname,
    description: row.description,
    personalityPrompt: row.personality_prompt,
    speakingStyle: row.speaking_style,
    strategy: row.strategy,
    modelProfileId: row.model_profile_id,
    enabled: row.enabled === 1
  });
}

function booleanInteger(value: boolean): number {
  return value ? 1 : 0;
}

function credentialPurpose(providerId: string): string {
  return `provider:${providerId}:api-key`;
}

function credentialHint(apiKey: string): string {
  return `...${apiKey.slice(-4)}`;
}
