import type { AiProviderProtocol } from "@werewolf/shared";
import type { ModelProvider } from "./model-provider.js";
import { createOpenAiCompatibleProvider } from "./providers/openai-compatible.js";

export interface ModelProviderConnection {
  baseUrl: string;
  apiKey: string | null;
}

export type ModelProviderFactory = (
  connection: ModelProviderConnection
) => ModelProvider;

export class ProviderRegistry {
  private readonly factories = new Map<
    AiProviderProtocol,
    ModelProviderFactory
  >();

  register(
    protocol: AiProviderProtocol,
    factory: ModelProviderFactory
  ): void {
    if (this.factories.has(protocol)) {
      throw new Error(`model provider protocol already registered: ${protocol}`);
    }
    this.factories.set(protocol, factory);
  }

  has(protocol: AiProviderProtocol): boolean {
    return this.factories.has(protocol);
  }

  create(
    protocol: AiProviderProtocol,
    connection: ModelProviderConnection
  ): ModelProvider {
    const factory = this.factories.get(protocol);
    if (!factory) {
      throw new Error(`unsupported model provider protocol: ${protocol}`);
    }
    return factory(connection);
  }
}

export function createDefaultProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(
    "openai-compatible-chat",
    createOpenAiCompatibleProvider
  );
  return registry;
}
