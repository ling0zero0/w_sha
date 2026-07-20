import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@werewolf/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@werewolf/shared")>();
  return {
    ...actual,
    hostBootstrapSchema: {
      parse: (value: unknown) => value as {
        sessionToken: string;
        lobby: Record<string, never>;
      }
    }
  };
});

import { createAiAdminClient } from "./ai-client";

const token = "abcdefghijklmnopqrstuvwxyz123456";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("AI admin client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("gets host bootstrap before calling AI routes with a bearer token", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessionToken: token, lobby: {} }))
      .mockResolvedValueOnce(jsonResponse({
        providers: [],
        models: [],
        botProfiles: []
      }));

    const client = createAiAdminClient(fetchMock);
    await expect(client.getOverview()).resolves.toEqual({
      providers: [],
      models: [],
      botProfiles: []
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/host-bootstrap", {});
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/ai/overview",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${token}`
        })
      })
    );
  });

  it("never includes a submitted credential in surfaced errors", async () => {
    const apiKey = "super-secret-provider-key";
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessionToken: token, lobby: {} }))
      .mockResolvedValueOnce(jsonResponse({
        code: "PROVIDER_REJECTED",
        message: `Provider rejected ${apiKey}`,
        requestId: "request-1"
      }, 400));

    const client = createAiAdminClient(fetchMock);
    const result = client.createProvider({
      name: "Local service",
      protocol: "openai-compatible-chat",
      baseUrl: "http://127.0.0.1:11434/v1",
      enabled: true,
      apiKey
    });

    await expect(result).rejects.not.toThrow(apiKey);
    await expect(result).rejects.toThrow("[已隐藏]");
  });
});
