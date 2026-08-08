import type { AiModelProfile } from "@werewolf/shared";
import { describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleProvider } from "./openai-compatible.js";

const model: AiModelProfile = {
  id: "019bf178-7f24-7e40-b8dc-0c2dd948d5a8",
  revision: 1,
  providerId: "019bf178-7f24-7e40-b8dc-0c2dd948d5a7",
  name: "Test model",
  model: "test-model",
  enabled: true,
  temperature: 0.4,
  maxOutputTokens: 128,
  requestTimeoutMs: 1_000,
  maxAttemptsPerTurn: 1,
  gameTokenBudget: 1_000,
  fallbackModelProfileId: null
};

const decisionRequest = {
  model,
  messages: [
    { role: "system" as const, content: "Return a decision." },
    { role: "user" as const, content: "Choose now." }
  ]
};

describe("OpenAI-compatible model provider", () => {
  it("sends an authenticated manual-redirect request and normalizes output", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      choices: [{
        message: {
          content: JSON.stringify({
            protocolVersion: 1,
            intent: {
              type: "day-select-vote",
              payload: { target: null }
            }
          })
        }
      }],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 7,
        total_tokens: 19
      }
    }));
    const provider = createProvider(fetchMock, "  top-secret  ");

    const result = await provider.decide(
      decisionRequest,
      new AbortController().signal
    );

    expect(result).toMatchObject({
      ok: true,
      decision: {
        protocolVersion: 1,
        intent: {
          type: "day-select-vote",
          payload: { target: null }
        }
      },
      usage: {
        inputTokens: 12,
        outputTokens: 7,
        totalTokens: 19
      }
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:1234/v1/chat/completions");
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer top-secret"
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "test-model",
      max_tokens: 128,
      temperature: 0.4,
      response_format: { type: "json_object" }
    });
  });

  it("omits Authorization when no credential is configured", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: "OK" } }]
    }));
    const provider = createProvider(fetchMock, null);

    const result = await provider.testConnection(
      model,
      new AbortController().signal
    );

    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });

  it.each([
    [401, "AUTHENTICATION_FAILED", false],
    [403, "AUTHENTICATION_FAILED", false],
    [404, "MODEL_NOT_FOUND", false],
    [429, "RATE_LIMITED", true],
    [500, "PROVIDER_ERROR", true],
    [503, "PROVIDER_ERROR", true],
    [302, "REQUEST_REJECTED", false]
  ] as const)(
    "classifies HTTP %i without exposing its body",
    async (status, code, retryable) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(
        "provider-secret-body",
        { status }
      ));
      const provider = createProvider(fetchMock);

      const result = await provider.testConnection(
        model,
        new AbortController().signal
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code, retryable, httpStatus: status }
      });
      expect(JSON.stringify(result)).not.toContain("provider-secret-body");
    }
  );

  it("classifies network failures without exposing exception details", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(
      new Error("dns failure containing secret.internal")
    );
    const provider = createProvider(fetchMock);

    const result = await provider.testConnection(
      model,
      new AbortController().signal
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        retryable: true,
        httpStatus: null
      }
    });
    expect(JSON.stringify(result)).not.toContain("secret.internal");
  });

  it("distinguishes model timeout from caller cancellation", async () => {
    const fetchMock = abortableFetch();
    const provider = createProvider(fetchMock);
    const shortTimeoutModel = {
      ...model,
      requestTimeoutMs: 10
    };

    const timedOut = await provider.testConnection(
      shortTimeoutModel,
      new AbortController().signal
    );

    const caller = new AbortController();
    const cancelledPromise = provider.testConnection(model, caller.signal);
    caller.abort();
    const cancelled = await cancelledPromise;

    expect(timedOut).toMatchObject({
      ok: false,
      error: { code: "TIMEOUT", retryable: true }
    });
    expect(cancelled).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" }
    });
  });

  it.each([
    "```json\n{\"protocolVersion\":1,\"intent\":null}\n```",
    "{\"protocolVersion\":1,\"intent\":{\"type\":\"confirm-role\",\"actor\":\"x\"}}",
    "{\"protocolVersion\":1,\"intent\":{\"type\":\"unknown\"}}",
    "not json"
  ])("rejects invalid model decision content", async (content) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      choices: [{ message: { content } }]
    }));
    const provider = createProvider(fetchMock);

    const result = await provider.decide(
      decisionRequest,
      new AbortController().signal
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_RESPONSE",
        httpStatus: null
      }
    });
    expect(JSON.stringify(result)).not.toContain(content);
  });

  it("rejects malformed successful provider envelopes", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      choices: []
    }));
    const provider = createProvider(fetchMock);

    const result = await provider.testConnection(
      model,
      new AbortController().signal
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_RESPONSE" }
    });
  });

  it.each([
    "http://169.254.169.254/latest/meta-data",
    "http://[::ffff:169.254.169.254]/latest/meta-data"
  ])("rejects metadata and link-local provider endpoints before making a request: %s", (baseUrl) => {
    expect(() => new OpenAiCompatibleProvider({
      baseUrl,
      apiKey: null,
      fetch: vi.fn<typeof fetch>()
    })).toThrow(/blocked metadata or link-local/);
  });
});

function createProvider(
  fetchImplementation: typeof fetch,
  apiKey: string | null = "secret"
): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    baseUrl: "http://127.0.0.1:1234/v1/",
    apiKey,
    fetch: fetchImplementation,
    now: () => 1_700_000_000_000
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function abortableFetch(): typeof fetch {
  return vi.fn<typeof fetch>((_input, init) => new Promise<Response>(
    (_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    }
  ));
}
