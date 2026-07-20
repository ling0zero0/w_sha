import {
  botIntentSchema,
  type AiBotProfile,
  type AiModelProfile,
  type AiProviderView,
  type BotIntent,
  type PlayerId,
  type PlayerLobbyView
} from "@werewolf/shared";
import { BudgetExhaustedError, BudgetLedger } from "./budget-ledger.js";
import { planBotDecision } from "./decision-gate.js";
import type { AiConfigStore } from "./ai-config-store.js";
import { buildBotPrompt } from "./prompt-builder.js";
import type { AiProviderErrorCode } from "./model-provider.js";
import type { ProviderRegistry } from "./provider-registry.js";
import type { BotAdapter, BotTurnContext } from "../bot-manager.js";
import { DeterministicBotAdapter } from "../bot-manager.js";

export interface LlmBotAdapterOptions {
  playerId: PlayerId;
  botProfileId: string;
  gameId: () => string;
  store: AiConfigStore;
  providers: ProviderRegistry;
  budgetLedger?: BudgetLedger;
  onFallback?: (reason: string, modelErrorCode?: AiProviderErrorCode) => void;
}

export class LlmBotAdapter implements BotAdapter {
  readonly kind = "llm" as const;
  private readonly fallback = new DeterministicBotAdapter();
  private readonly handledDecisionKeys = new Set<string>();
  private readonly budgetLedger: BudgetLedger;

  constructor(private readonly options: LlmBotAdapterOptions) {
    this.budgetLedger = options.budgetLedger ?? new BudgetLedger();
  }

  get turnTimeoutMs(): number {
    const resolved = this.resolveConfiguration();
    if (!resolved) return 2_000;
    const modelTimeoutMs = this.modelChain(resolved.model).reduce(
      (total, model) => total + model.requestTimeoutMs * model.maxAttemptsPerTurn,
      0
    );
    return Math.min(modelTimeoutMs + 1_000, 2_147_483_647);
  }

  async onView(view: PlayerLobbyView, context: BotTurnContext): Promise<BotIntent | null> {
    const plan = planBotDecision({
      gameId: this.options.gameId(),
      view,
      handledDecisionKeys: this.handledDecisionKeys
    });
    if (plan.kind === "skip") return null;
    if (plan.kind === "deterministic") return plan.intent;

    const resolved = this.resolveConfiguration();
    if (!resolved) return this.useFallback(view, context, "configuration-unavailable");

    const prompt = buildBotPrompt({
      view,
      botProfile: resolved.profile,
      allowedIntentTypes: plan.allowedIntentTypes
    });
    const models = this.modelChain(resolved.model);
    let lastModelErrorCode: AiProviderErrorCode | undefined;

    for (const model of models) {
      const provider = this.resolveProvider(model);
      if (!provider) continue;
      const attempts = model.maxAttemptsPerTurn;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (context.signal.aborted) return null;
        let reservation;
        try {
          reservation = this.budgetLedger.reserve({
            gameId: this.options.gameId(),
            modelId: model.id,
            seatId: this.options.playerId,
            tokens: model.maxOutputTokens,
            limits: {
              gameTokens: model.gameTokenBudget,
              modelTokens: model.gameTokenBudget,
              seatTokens: model.gameTokenBudget
            }
          });
        } catch (error) {
          if (error instanceof BudgetExhaustedError) break;
          throw error;
        }

        const response = await provider.decide({ model, messages: prompt.messages }, context.signal);
        if (response.ok) {
          const used = Math.min(
            reservation.reservedTokens,
            response.usage.totalTokens ?? response.usage.outputTokens ?? reservation.reservedTokens
          );
          this.budgetLedger.settle(reservation.id, used);
          const intent = response.decision.intent;
          if (intent !== null && plan.allowedIntentTypes.includes(intent.type)) {
            const parsed = botIntentSchema.safeParse(intent);
            if (parsed.success) {
              this.handledDecisionKeys.add(plan.decisionKey);
              return parsed.data;
            }
          }
          lastModelErrorCode = "INVALID_RESPONSE";
          break;
        }

        lastModelErrorCode = response.error.code;
        this.budgetLedger.release(reservation.id);
        if (!response.error.retryable) break;
      }
    }

    this.handledDecisionKeys.add(plan.decisionKey);
    return this.useFallback(view, context, "model-failed", lastModelErrorCode);
  }

  async dispose(): Promise<void> {
    this.handledDecisionKeys.clear();
    await this.fallback.dispose();
  }

  private resolveConfiguration(): { profile: AiBotProfile; model: AiModelProfile } | null {
    const profile = this.options.store.getBotProfile(this.options.botProfileId);
    if (!profile?.enabled) return null;
    const model = this.options.store.getModelProfile(profile.modelProfileId);
    if (!model?.enabled) return null;
    return { profile, model };
  }

  private modelChain(initial: AiModelProfile): AiModelProfile[] {
    const result: AiModelProfile[] = [];
    const seen = new Set<string>();
    let current: AiModelProfile | null = initial;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.enabled) result.push(current);
      current = current.fallbackModelProfileId
        ? this.options.store.getModelProfile(current.fallbackModelProfileId)
        : null;
    }
    return result;
  }

  private resolveProvider(model: AiModelProfile) {
    const provider: AiProviderView | null = this.options.store.getProvider(model.providerId);
    if (!provider?.enabled || !this.options.providers.has(provider.protocol)) return null;
    let apiKey: string | null = null;
    try {
      apiKey = provider.credentialConfigured
        ? this.options.store.getProviderCredential(provider.id)
        : null;
    } catch {
      return null;
    }
    return this.options.providers.create(provider.protocol, {
      baseUrl: provider.baseUrl,
      apiKey
    });
  }

  private useFallback(
    view: PlayerLobbyView,
    context: BotTurnContext,
    reason: string,
    modelErrorCode?: AiProviderErrorCode
  ): Promise<BotIntent | null> {
    this.options.onFallback?.(reason, modelErrorCode);
    return this.fallback.onView(view, context);
  }
}
