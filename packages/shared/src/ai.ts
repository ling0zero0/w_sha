import { z } from "zod";

const namedConfigurationSchema = z.string().trim().min(1).max(80);
const apiKeySchema = z.string().min(1).max(8_192);
const dateTimeSchema = z.iso.datetime();

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
});

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
