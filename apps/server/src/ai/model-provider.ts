import {
  botIntentSchema,
  type AiModelProfile
} from "@werewolf/shared";
import { z } from "zod";

export const aiModelDecisionSchema = z.object({
  protocolVersion: z.literal(1),
  intent: botIntentSchema.nullable()
}).strict();

export type AiModelDecision = z.infer<typeof aiModelDecisionSchema>;

export interface AiModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiDecisionRequest {
  model: AiModelProfile;
  messages: readonly AiModelMessage[];
}

export interface AiTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export type AiProviderErrorCode =
  | "AUTHENTICATION_FAILED"
  | "MODEL_NOT_FOUND"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "REQUEST_REJECTED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "CANCELLED"
  | "INVALID_RESPONSE";

export interface AiProviderError {
  code: AiProviderErrorCode;
  message: string;
  retryable: boolean;
  httpStatus: number | null;
}

interface AiResultMetadata {
  latencyMs: number;
  completedAt: string;
}

export type AiDecisionResponse =
  | (AiResultMetadata & {
      ok: true;
      decision: AiModelDecision;
      usage: AiTokenUsage;
    })
  | (AiResultMetadata & {
      ok: false;
      error: AiProviderError;
    });

export type AiConnectionTestResult =
  | (AiResultMetadata & {
      ok: true;
    })
  | (AiResultMetadata & {
      ok: false;
      error: AiProviderError;
    });

export interface ModelProvider {
  decide(
    request: AiDecisionRequest,
    signal: AbortSignal
  ): Promise<AiDecisionResponse>;

  testConnection(
    model: AiModelProfile,
    signal: AbortSignal
  ): Promise<AiConnectionTestResult>;
}

export function parseAiModelDecision(value: unknown): AiModelDecision {
  return aiModelDecisionSchema.parse(value);
}
