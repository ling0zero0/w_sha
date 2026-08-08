import { z } from "zod";

const namedConfigurationSchema = z.string().trim().min(1).max(80);
const apiKeySchema = z.string().min(1).max(8_192);
const dateTimeSchema = z.iso.datetime();
const blockedAiProviderHostnames = new Set([
  "0.0.0.0",
  "255.255.255.255",
  "169.254.169.254",
  "169.254.170.2",
  "100.100.100.200",
  "metadata",
  "metadata.google.internal",
  "metadata.azure.internal",
  "instance-data.ec2.internal"
]);

export function isBlockedAiProviderHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (blockedAiProviderHostnames.has(normalized)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(normalized)) return true;
  if (isBlockedMappedIpv4(normalized)) return true;

  return isBlockedIpv4(normalized);
}

function isBlockedIpv4(hostname: string): boolean {
  if (blockedAiProviderHostnames.has(hostname)) return true;
  const octets = hostname.split(".");
  if (octets.length !== 4 || octets.some((octet) => !/^\d+$/.test(octet))) return false;
  const values = octets.map(Number);
  return values[0] === 169 && values[1] === 254;
}

function isBlockedMappedIpv4(hostname: string): boolean {
  const dottedMatch = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(hostname);
  if (dottedMatch) return isBlockedIpv4(dottedMatch[1]!);

  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(hostname);
  if (!match) return false;
  const high = Number.parseInt(match[1]!, 16);
  const low = Number.parseInt(match[2]!, 16);
  const ipv4 = [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  return isBlockedIpv4(ipv4);
}

const httpUrlSchema = z.url().superRefine((value, context) => {
  if (!/^https?:\/\//i.test(value)) {
    context.addIssue({
      code: "custom",
      message: "URL must use HTTP or HTTPS"
    });
  }
  if (/^https?:\/\/[^/?#]*@/i.test(value)) {
    context.addIssue({
      code: "custom",
      message: "URL must not contain credentials"
    });
  }
  if (value.includes("#")) {
    context.addIssue({
      code: "custom",
      message: "URL must not contain a fragment"
    });
  }
  if (isBlockedAiProviderHostname(extractHttpHostname(value))) {
    context.addIssue({
      code: "custom",
      message: "URL points to a blocked metadata or link-local address"
    });
  }
});

function extractHttpHostname(value: string): string {
  const authority = /^https?:\/\/([^/?#]*)/i.exec(value)?.[1] ?? "";
  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    return closingBracket >= 0 ? authority.slice(0, closingBracket + 1) : authority;
  }
  return authority.split(":", 1)[0] ?? "";
}

function requireUpdateField(
  value: Record<string, unknown>,
  context: z.RefinementCtx
): void {
  if (Object.keys(value).length === 0) {
    context.addIssue({
      code: "custom",
      message: "At least one field must be provided"
    });
  }
}

export const aiProviderIdSchema = z.uuid();
export type AiProviderId = z.infer<typeof aiProviderIdSchema>;

export const aiModelProfileIdSchema = z.uuid();
export type AiModelProfileId = z.infer<typeof aiModelProfileIdSchema>;

export const aiBotProfileIdSchema = z.uuid();
export type AiBotProfileId = z.infer<typeof aiBotProfileIdSchema>;

export const aiProviderProtocolSchema = z.literal("openai-compatible-chat");
export type AiProviderProtocol = z.infer<typeof aiProviderProtocolSchema>;

export const aiProviderViewSchema = z.object({
  id: aiProviderIdSchema,
  name: namedConfigurationSchema,
  protocol: aiProviderProtocolSchema,
  baseUrl: httpUrlSchema,
  enabled: z.boolean(),
  credentialConfigured: z.boolean(),
  credentialHint: z.string().trim().min(1).max(160).nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema
}).strict();
export type AiProviderView = z.infer<typeof aiProviderViewSchema>;

export const createAiProviderRequestSchema = z.object({
  name: namedConfigurationSchema,
  protocol: aiProviderProtocolSchema,
  baseUrl: httpUrlSchema,
  enabled: z.boolean(),
  apiKey: apiKeySchema.optional()
}).strict();
export type CreateAiProviderRequest = z.infer<typeof createAiProviderRequestSchema>;

export const updateAiProviderRequestSchema = z.object({
  name: namedConfigurationSchema.optional(),
  protocol: aiProviderProtocolSchema.optional(),
  baseUrl: httpUrlSchema.optional(),
  enabled: z.boolean().optional(),
  apiKey: apiKeySchema.optional(),
  clearCredential: z.literal(true).optional()
}).strict().superRefine((value, context) => {
  requireUpdateField(value, context);
  if (value.apiKey !== undefined && value.clearCredential === true) {
    context.addIssue({
      code: "custom",
      message: "apiKey and clearCredential cannot be used together"
    });
  }
});
export type UpdateAiProviderRequest = z.infer<typeof updateAiProviderRequestSchema>;

const modelProfileFields = {
  providerId: aiProviderIdSchema,
  name: namedConfigurationSchema,
  model: z.string().trim().min(1).max(200),
  enabled: z.boolean(),
  temperature: z.number().finite().min(0).max(2).nullable(),
  maxOutputTokens: z.number().int().min(1).max(1_000_000),
  requestTimeoutMs: z.number().int().min(1_000).max(300_000),
  maxAttemptsPerTurn: z.number().int().min(1).max(2),
  gameTokenBudget: z.number().int().min(1).max(100_000_000),
  fallbackModelProfileId: aiModelProfileIdSchema.nullable()
} satisfies z.ZodRawShape;

function validateModelProfileBudget(
  value: {
    maxOutputTokens?: number | undefined;
    gameTokenBudget?: number | undefined;
  },
  context: z.RefinementCtx
): void {
  if (
    value.maxOutputTokens !== undefined
    && value.gameTokenBudget !== undefined
    && value.gameTokenBudget < value.maxOutputTokens
  ) {
    context.addIssue({
      code: "custom",
      path: ["gameTokenBudget"],
      message: "gameTokenBudget must cover at least one maximum-size response"
    });
  }
}

export const aiModelProfileViewSchema = z.object({
  id: aiModelProfileIdSchema,
  revision: z.number().int().positive().default(1),
  ...modelProfileFields
}).strict().superRefine((value, context) => {
  validateModelProfileBudget(value, context);
  if (value.fallbackModelProfileId === value.id) {
    context.addIssue({
      code: "custom",
      path: ["fallbackModelProfileId"],
      message: "A model profile cannot fall back to itself"
    });
  }
});
export type AiModelProfileView = z.infer<typeof aiModelProfileViewSchema>;
export const aiModelProfileSchema = aiModelProfileViewSchema;
export type AiModelProfile = AiModelProfileView;

export const createAiModelProfileRequestSchema = z.object(modelProfileFields)
  .strict()
  .superRefine(validateModelProfileBudget);
export type CreateAiModelProfileRequest = z.infer<typeof createAiModelProfileRequestSchema>;

export const updateAiModelProfileRequestSchema = z.object({
  providerId: modelProfileFields.providerId.optional(),
  name: modelProfileFields.name.optional(),
  model: modelProfileFields.model.optional(),
  enabled: modelProfileFields.enabled.optional(),
  temperature: modelProfileFields.temperature.optional(),
  maxOutputTokens: modelProfileFields.maxOutputTokens.optional(),
  requestTimeoutMs: modelProfileFields.requestTimeoutMs.optional(),
  maxAttemptsPerTurn: modelProfileFields.maxAttemptsPerTurn.optional(),
  gameTokenBudget: modelProfileFields.gameTokenBudget.optional(),
  fallbackModelProfileId: modelProfileFields.fallbackModelProfileId.optional()
}).strict().superRefine((value, context) => {
  requireUpdateField(value, context);
  validateModelProfileBudget(value, context);
});
export type UpdateAiModelProfileRequest = z.infer<typeof updateAiModelProfileRequestSchema>;

export const aiBotStrategySchema = z.enum(["cautious", "balanced", "aggressive"]);
export type AiBotStrategy = z.infer<typeof aiBotStrategySchema>;

const botProfileFields = {
  name: namedConfigurationSchema,
  defaultNickname: z.string().trim().min(1).max(12),
  description: z.string().trim().max(1_000),
  personalityPrompt: z.string().trim().min(1).max(12_000),
  speakingStyle: z.string().trim().min(1).max(2_000),
  strategy: aiBotStrategySchema,
  modelProfileId: aiModelProfileIdSchema,
  enabled: z.boolean()
} satisfies z.ZodRawShape;

export const aiBotProfileViewSchema = z.object({
  id: aiBotProfileIdSchema,
  revision: z.number().int().positive().default(1),
  ...botProfileFields
}).strict();
export type AiBotProfileView = z.infer<typeof aiBotProfileViewSchema>;
export const aiBotProfileSchema = aiBotProfileViewSchema;
export type AiBotProfile = AiBotProfileView;

export const createAiBotProfileRequestSchema = z.object(botProfileFields).strict();
export type CreateAiBotProfileRequest = z.infer<typeof createAiBotProfileRequestSchema>;

export const updateAiBotProfileRequestSchema = z.object({
  name: botProfileFields.name.optional(),
  defaultNickname: botProfileFields.defaultNickname.optional(),
  description: botProfileFields.description.optional(),
  personalityPrompt: botProfileFields.personalityPrompt.optional(),
  speakingStyle: botProfileFields.speakingStyle.optional(),
  strategy: botProfileFields.strategy.optional(),
  modelProfileId: botProfileFields.modelProfileId.optional(),
  enabled: botProfileFields.enabled.optional()
}).strict().superRefine(requireUpdateField);
export type UpdateAiBotProfileRequest = z.infer<typeof updateAiBotProfileRequestSchema>;

export const aiConfigurationViewSchema = z.object({
  providers: z.array(aiProviderViewSchema),
  models: z.array(aiModelProfileViewSchema),
  botProfiles: z.array(aiBotProfileViewSchema)
}).strict();
export type AiConfigurationView = z.infer<typeof aiConfigurationViewSchema>;
