import { describe, expect, it } from "vitest";
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
  updateAiProviderRequestSchema
} from "./index.js";

const providerId = "019bf178-7f24-7e40-b8dc-0c2dd948d5a7";
const modelProfileId = "019bf178-7f24-7e40-b8dc-0c2dd948d5a8";
const fallbackModelProfileId = "019bf178-7f24-7e40-b8dc-0c2dd948d5a9";
const botProfileId = "019bf178-7f24-7e40-b8dc-0c2dd948d5aa";

const providerWrite = {
  name: "Local model service",
  protocol: "openai-compatible-chat" as const,
  baseUrl: "http://192.168.1.20:11434/v1",
  enabled: true,
  apiKey: "secret-value"
};

const providerView = {
  id: providerId,
  name: providerWrite.name,
  protocol: providerWrite.protocol,
  baseUrl: providerWrite.baseUrl,
  enabled: true,
  credentialConfigured: true,
  credentialHint: "...alue",
  createdAt: "2026-07-19T08:00:00.000Z",
  updatedAt: "2026-07-19T08:00:00.000Z"
};

const modelWrite = {
  providerId,
  name: "Primary reasoning model",
  model: "model-v1",
  enabled: true,
  temperature: 0.4,
  maxOutputTokens: 1_024,
  requestTimeoutMs: 20_000,
  maxAttemptsPerTurn: 2,
  gameTokenBudget: 20_000,
  fallbackModelProfileId
};

const botProfileWrite = {
  name: "Careful analyst",
  defaultNickname: "Analyst",
  description: "A reserved, evidence-driven player.",
  personalityPrompt: "Prefer concrete evidence and disclose uncertainty.",
  speakingStyle: "Use short, direct statements.",
  strategy: "cautious" as const,
  modelProfileId,
  enabled: true
};

describe("AI shared contracts", () => {
  it("accepts only the stage-1 provider protocol and strict provider writes", () => {
    expect(createAiProviderRequestSchema.parse(providerWrite)).toEqual(providerWrite);
    expect(createAiProviderRequestSchema.safeParse({
      ...providerWrite,
      protocol: "anthropic-messages"
    }).success).toBe(false);
    expect(createAiProviderRequestSchema.safeParse({
      ...providerWrite,
      extra: true
    }).success).toBe(false);
    expect(createAiProviderRequestSchema.safeParse({
      ...providerWrite,
      baseUrl: "file:///tmp/model"
    }).success).toBe(false);
    expect(createAiProviderRequestSchema.safeParse({
      ...providerWrite,
      baseUrl: "https://user:password@example.com/v1"
    }).success).toBe(false);
  });

  it("keeps provider credentials out of redacted views", () => {
    const parsed = aiProviderViewSchema.parse(providerView);

    expect(parsed.credentialConfigured).toBe(true);
    expect(Object.keys(parsed)).not.toContain("apiKey");
    expect(aiProviderViewSchema.safeParse({
      ...providerView,
      apiKey: "secret-value"
    }).success).toBe(false);
  });

  it("requires meaningful provider updates and explicit credential clearing", () => {
    expect(updateAiProviderRequestSchema.safeParse({}).success).toBe(false);
    expect(updateAiProviderRequestSchema.parse({ enabled: false })).toEqual({
      enabled: false
    });
    expect(updateAiProviderRequestSchema.parse({ clearCredential: true })).toEqual({
      clearCredential: true
    });
    expect(updateAiProviderRequestSchema.safeParse({
      apiKey: "replacement",
      clearCredential: true
    }).success).toBe(false);
    expect(updateAiProviderRequestSchema.safeParse({ clearCredential: false }).success).toBe(false);
  });

  it("strictly validates model profile create, update, and view payloads", () => {
    expect(createAiModelProfileRequestSchema.parse(modelWrite)).toEqual(modelWrite);
    expect(aiModelProfileViewSchema.parse({
      id: modelProfileId,
      ...modelWrite
    }).id).toBe(modelProfileId);
    expect(createAiModelProfileRequestSchema.safeParse({
      ...modelWrite,
      maxAttemptsPerTurn: 3
    }).success).toBe(false);
    expect(createAiModelProfileRequestSchema.safeParse({
      ...modelWrite,
      gameTokenBudget: 100
    }).success).toBe(false);
    expect(aiModelProfileViewSchema.safeParse({
      id: modelProfileId,
      ...modelWrite,
      fallbackModelProfileId: modelProfileId
    }).success).toBe(false);
    expect(updateAiModelProfileRequestSchema.safeParse({}).success).toBe(false);
    expect(updateAiModelProfileRequestSchema.safeParse({
      temperature: 0.7,
      unknown: true
    }).success).toBe(false);
  });

  it("strictly validates bot profile create, update, and view payloads", () => {
    expect(createAiBotProfileRequestSchema.parse(botProfileWrite)).toEqual(botProfileWrite);
    expect(aiBotProfileViewSchema.parse({
      id: botProfileId,
      ...botProfileWrite
    }).strategy).toBe("cautious");
    expect(createAiBotProfileRequestSchema.safeParse({
      ...botProfileWrite,
      strategy: "reckless"
    }).success).toBe(false);
    expect(createAiBotProfileRequestSchema.safeParse({
      ...botProfileWrite,
      role: "wolf"
    }).success).toBe(false);
    expect(updateAiBotProfileRequestSchema.safeParse({}).success).toBe(false);
  });

  it("validates a fully redacted configuration view", () => {
    const parsed = aiConfigurationViewSchema.parse({
      providers: [providerView],
      models: [{ id: modelProfileId, ...modelWrite }],
      botProfiles: [{ id: botProfileId, ...botProfileWrite }]
    });

    expect(parsed.providers).toHaveLength(1);
    expect(JSON.stringify(parsed)).not.toContain("secret-value");
  });
});
