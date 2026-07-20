import { describe, expect, it, vi } from "vitest";
import type { ModelProvider } from "./model-provider.js";
import {
  createDefaultProviderRegistry,
  ProviderRegistry
} from "./provider-registry.js";

describe("AI provider registry", () => {
  it("creates registered provider protocols", () => {
    const provider = {} as ModelProvider;
    const factory = vi.fn(() => provider);
    const registry = new ProviderRegistry();
    const connection = {
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: "secret"
    };

    registry.register("openai-compatible-chat", factory);

    expect(registry.has("openai-compatible-chat")).toBe(true);
    expect(registry.create("openai-compatible-chat", connection)).toBe(provider);
    expect(factory).toHaveBeenCalledWith(connection);
  });

  it("rejects duplicate registrations", () => {
    const registry = new ProviderRegistry();
    const factory = () => ({} as ModelProvider);
    registry.register("openai-compatible-chat", factory);

    expect(() => {
      registry.register("openai-compatible-chat", factory);
    }).toThrow("model provider protocol already registered");
  });

  it("registers the supported protocol by default", () => {
    const registry = createDefaultProviderRegistry();

    expect(registry.has("openai-compatible-chat")).toBe(true);
    expect(registry.create("openai-compatible-chat", {
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: null
    })).toBeInstanceOf(Object);
  });
});
