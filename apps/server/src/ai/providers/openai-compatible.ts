import type { AiModelProfile } from "@werewolf/shared";
import {
  parseAiModelDecision,
  type AiConnectionTestResult,
  type AiDecisionRequest,
  type AiDecisionResponse,
  type AiProviderError,
  type AiTokenUsage,
  type ModelProvider
} from "../model-provider.js";
import type { ModelProviderConnection } from "../provider-registry.js";

type FetchImplementation = typeof fetch;

export interface OpenAiCompatibleProviderOptions
  extends ModelProviderConnection {
  fetch?: FetchImplementation;
  now?: () => number;
}

interface RequestSuccess {
  ok: true;
  content: string;
  usage: AiTokenUsage;
}

interface RequestFailure {
  ok: false;
  error: AiProviderError;
}

type RequestResult = RequestSuccess | RequestFailure;
type AbortSource = "none" | "caller" | "timeout";

const safeMessages = {
  AUTHENTICATION_FAILED: "The model provider rejected the credential.",
  MODEL_NOT_FOUND: "The configured model was not found.",
  RATE_LIMITED: "The model provider rate limit was reached.",
  PROVIDER_ERROR: "The model provider is temporarily unavailable.",
  REQUEST_REJECTED: "The model provider rejected the request.",
  NETWORK_ERROR: "The model provider could not be reached.",
  TIMEOUT: "The model provider request timed out.",
  CANCELLED: "The model provider request was cancelled.",
  INVALID_RESPONSE: "The model provider returned an invalid response."
} as const;

export class OpenAiCompatibleProvider implements ModelProvider {
  private readonly endpoint: string;
  private readonly apiKey: string | null;
  private readonly fetchImplementation: FetchImplementation;
  private readonly now: () => number;

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.endpoint = createChatCompletionsUrl(options.baseUrl);
    this.apiKey = normalizeApiKey(options.apiKey);
    this.fetchImplementation = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async decide(
    request: AiDecisionRequest,
    signal: AbortSignal
  ): Promise<AiDecisionResponse> {
    const startedAt = this.now();
    const result = await this.request({
      model: request.model.model,
      messages: request.messages,
      max_tokens: request.model.maxOutputTokens,
      response_format: { type: "json_object" },
      ...(request.model.temperature === null
        ? {}
        : { temperature: request.model.temperature })
    }, request.model.requestTimeoutMs, signal);
    const metadata = this.metadata(startedAt);

    if (!result.ok) {
      return { ok: false, ...metadata, error: result.error };
    }

    let decision;
    try {
      decision = parseAiModelDecision(JSON.parse(result.content));
    } catch {
      return {
        ok: false,
        ...metadata,
        error: createError("INVALID_RESPONSE")
      };
    }

    return {
      ok: true,
      ...metadata,
      decision,
      usage: result.usage
    };
  }

  async testConnection(
    model: AiModelProfile,
    signal: AbortSignal
  ): Promise<AiConnectionTestResult> {
    const startedAt = this.now();
    const result = await this.request({
      model: model.model,
      messages: [{
        role: "user",
        content: "Reply with OK."
      }],
      max_tokens: 4,
      temperature: 0
    }, model.requestTimeoutMs, signal);
    const metadata = this.metadata(startedAt);

    if (!result.ok) {
      return { ok: false, ...metadata, error: result.error };
    }
    return { ok: true, ...metadata };
  }

  private async request(
    body: Record<string, unknown>,
    timeoutMs: number,
    callerSignal: AbortSignal
  ): Promise<RequestResult> {
    const abort = composeAbortSignal(callerSignal, timeoutMs);

    try {
      if (callerSignal.aborted) {
        return { ok: false, error: createError("CANCELLED") };
      }

      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        redirect: "manual",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: abort.signal
      });

      if (!response.ok) {
        return {
          ok: false,
          error: classifyHttpError(response.status)
        };
      }

      const payload = await readResponsePayload(response);
      if (!payload) {
        return { ok: false, error: createError("INVALID_RESPONSE") };
      }
      return {
        ok: true,
        content: payload.content,
        usage: payload.usage
      };
    } catch {
      if (abort.source() === "timeout") {
        return { ok: false, error: createError("TIMEOUT", true) };
      }
      if (abort.source() === "caller" || callerSignal.aborted) {
        return { ok: false, error: createError("CANCELLED") };
      }
      return { ok: false, error: createError("NETWORK_ERROR", true) };
    } finally {
      abort.dispose();
    }
  }

  private headers(): Headers {
    const headers = new Headers({
      "Content-Type": "application/json",
      "Accept": "application/json"
    });
    if (this.apiKey !== null) {
      headers.set("Authorization", `Bearer ${this.apiKey}`);
    }
    return headers;
  }

  private metadata(startedAt: number): {
    latencyMs: number;
    completedAt: string;
  } {
    const completedAt = this.now();
    return {
      latencyMs: Math.max(0, completedAt - startedAt),
      completedAt: new Date(completedAt).toISOString()
    };
  }
}

export function createOpenAiCompatibleProvider(
  connection: ModelProviderConnection
): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider(connection);
}

function createChatCompletionsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("model provider base URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("model provider base URL must not contain credentials");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/chat/completions`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function normalizeApiKey(apiKey: string | null): string | null {
  if (apiKey === null) return null;
  const normalized = apiKey.trim();
  return normalized ? normalized : null;
}

function classifyHttpError(status: number): AiProviderError {
  if (status === 401 || status === 403) {
    return createError("AUTHENTICATION_FAILED", false, status);
  }
  if (status === 404) {
    return createError("MODEL_NOT_FOUND", false, status);
  }
  if (status === 429) {
    return createError("RATE_LIMITED", true, status);
  }
  if (status >= 500 && status <= 599) {
    return createError("PROVIDER_ERROR", true, status);
  }
  return createError("REQUEST_REJECTED", false, status);
}

function createError(
  code: AiProviderError["code"],
  retryable = false,
  httpStatus: number | null = null
): AiProviderError {
  return {
    code,
    message: safeMessages[code],
    retryable,
    httpStatus
  };
}

async function readResponsePayload(response: Response): Promise<{
  content: string;
  usage: AiTokenUsage;
} | null> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return null;
  }
  if (!isRecord(value) || !Array.isArray(value.choices)) return null;
  const firstChoice = value.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) return null;
  if (typeof firstChoice.message.content !== "string") return null;

  return {
    content: firstChoice.message.content,
    usage: normalizeUsage(value.usage)
  };
}

function normalizeUsage(value: unknown): AiTokenUsage {
  if (!isRecord(value)) {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null
    };
  }
  return {
    inputTokens: nonNegativeInteger(value.prompt_tokens),
    outputTokens: nonNegativeInteger(value.completion_tokens),
    totalTokens: nonNegativeInteger(value.total_tokens)
  };
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? value as number
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function composeAbortSignal(
  callerSignal: AbortSignal,
  timeoutMs: number
): {
  signal: AbortSignal;
  source: () => AbortSource;
  dispose: () => void;
} {
  const controller = new AbortController();
  let source: AbortSource = "none";

  const cancelFromCaller = () => {
    if (source !== "none") return;
    source = "caller";
    controller.abort(callerSignal.reason);
  };

  if (callerSignal.aborted) {
    cancelFromCaller();
  } else {
    callerSignal.addEventListener("abort", cancelFromCaller, { once: true });
  }

  const timeout = setTimeout(() => {
    if (source !== "none") return;
    source = "timeout";
    controller.abort(new Error("model provider timeout"));
  }, timeoutMs);
  timeout.unref();

  return {
    signal: controller.signal,
    source: () => source,
    dispose: () => {
      clearTimeout(timeout);
      callerSignal.removeEventListener("abort", cancelFromCaller);
    }
  };
}
