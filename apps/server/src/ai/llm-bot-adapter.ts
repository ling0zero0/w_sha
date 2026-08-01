import {
  botIntentSchema,
  type AiBotProfile,
  type AiModelProfile,
  type AiProviderView,
  type BotIntent,
  type PlayerId,
  type PlayerLobbyView
} from "@werewolf/shared";
import { AiAuditStore } from "./ai-audit-store.js";
import { BudgetExhaustedError, BudgetLedger } from "./budget-ledger.js";
import { planBotDecision } from "./decision-gate.js";
import type { AiConfigStore } from "./ai-config-store.js";
import { buildBotPrompt } from "./prompt-builder.js";
import type { AiProviderErrorCode, AiDecisionResponse } from "./model-provider.js";
import type { ProviderRegistry } from "./provider-registry.js";
import type { BotAdapter, BotTurnContext } from "../bot-manager.js";
import type { BotConfigurationLock } from "../room.js";
import { DeterministicBotAdapter } from "../bot-manager.js";

export interface LlmBotAdapterOptions {
  playerId: PlayerId;
  botProfileId: string;
  gameId: () => string;
  store: AiConfigStore;
  providers: ProviderRegistry;
  budgetLedger?: BudgetLedger;
  gameTokenBudget?: number;
  auditStore?: AiAuditStore;
  lockedConfiguration?: BotConfigurationLock;
  onConfigurationLocked?: (lock: Omit<BotConfigurationLock, "locked">) => void;
  onFallback?: (reason: string, modelErrorCode?: AiProviderErrorCode) => void;
}

interface ResolvedConfiguration {
  profile: AiBotProfile;
  model: AiModelProfile;
  models: AiModelProfile[];
}

interface AttemptAuditInput {
  decisionKey: string;
  context: BotTurnContext;
  configuration: ResolvedConfiguration | null;
  model: AiModelProfile | null;
  status: "success" | "provider-unavailable" | "provider-error" | "invalid-response" | "budget-exhausted" | "fallback";
  intentType?: string | null;
  latencyMs: number | null;
  errorCode?: string | null;
  startedAt: string;
  completedAt: string;
}

export class LlmBotAdapter implements BotAdapter {
  readonly kind = "llm" as const;
  private readonly fallback = new DeterministicBotAdapter();
  private readonly handledDecisionKeys = new Set<string>();
  private readonly budgetLedger: BudgetLedger;
  private lockedGameId: string | null = null;
  private lockedConfiguration: ResolvedConfiguration | null = null;

  constructor(private readonly options: LlmBotAdapterOptions) {
    this.budgetLedger = options.budgetLedger ?? new BudgetLedger();
  }

  get turnTimeoutMs(): number {
    const resolved = this.resolveConfiguration();
    if (!resolved) return 2_000;
    const modelTimeoutMs = resolved.models.reduce(
      (total, model) => total + model.requestTimeoutMs * model.maxAttemptsPerTurn,
      0
    );
    return Math.min(modelTimeoutMs + 1_000, 2_147_483_647);
  }

  lockForGame(gameId: string): void {
    if (this.lockedGameId === gameId) return;
    this.lockedGameId = gameId;
    const current = this.readConfiguration();
    const saved = this.options.lockedConfiguration;
    if (saved?.locked) {
      this.lockedConfiguration = current && matchesLock(current, saved) ? current : null;
      return;
    }
    this.lockedConfiguration = current;
    this.options.onConfigurationLocked?.({
      botProfileRevision: current?.profile.revision ?? null,
      modelProfileId: current?.model.id ?? null,
      modelProfileRevision: current?.model.revision ?? null,
      modelChainRevision: current ? modelChainRevision(current.models) : null
    });
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
    if (!resolved) {
      return this.useFallback(
        view,
        context,
        "configuration-unavailable",
        undefined,
        plan.decisionKey,
        null
      );
    }

    const prompt = buildBotPrompt({
      view,
      botProfile: resolved.profile,
      allowedIntentTypes: plan.allowedIntentTypes
    });
    let lastModelErrorCode: AiProviderErrorCode | undefined;

    for (const model of resolved.models) {
      const provider = this.resolveProvider(model);
      if (!provider) {
        const completedAt = new Date().toISOString();
        this.recordAttempt({
          decisionKey: plan.decisionKey,
          context,
          configuration: resolved,
          model,
          status: "provider-unavailable",
          latencyMs: 0,
          errorCode: "PROVIDER_UNAVAILABLE",
          startedAt: completedAt,
          completedAt
        });
        continue;
      }

      const attempts = model.maxAttemptsPerTurn;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (context.signal.aborted) return null;
        const startedAt = new Date().toISOString();
        let reservation;
        try {
          reservation = this.budgetLedger.reserve({
            gameId: this.options.gameId(),
            modelId: model.id,
            seatId: this.options.playerId,
            tokens: model.maxOutputTokens,
            limits: {
              gameTokens: this.options.gameTokenBudget ?? model.gameTokenBudget,
              modelTokens: model.gameTokenBudget,
              seatTokens: model.gameTokenBudget
            }
          });
        } catch (error) {
          if (error instanceof BudgetExhaustedError) {
            const completedAt = new Date().toISOString();
            this.recordAttempt({
              decisionKey: plan.decisionKey,
              context,
              configuration: resolved,
              model,
              status: "budget-exhausted",
              latencyMs: 0,
              errorCode: "BUDGET_EXHAUSTED",
              startedAt,
              completedAt
            });
            break;
          }
          throw error;
        }

        let response: AiDecisionResponse;
        try {
          response = await provider.decide({ model, messages: prompt.messages }, context.signal);
        } catch {
          this.budgetLedger.release(reservation.id);
          lastModelErrorCode = "PROVIDER_ERROR";
          const completedAt = new Date().toISOString();
          this.recordAttempt({
            decisionKey: plan.decisionKey,
            context,
            configuration: resolved,
            model,
            status: "provider-error",
            latencyMs: null,
            errorCode: "PROVIDER_ERROR",
            startedAt,
            completedAt
          });
          break;
        }

        if (response.ok) {
          const used = Math.min(
            reservation.reservedTokens,
            response.usage.totalTokens ?? response.usage.outputTokens ?? reservation.reservedTokens
          );
          this.budgetLedger.settle(reservation.id, used);
          const parsed = botIntentSchema.safeParse(response.decision.intent);
          const allowed = parsed.success && plan.allowedIntentTypes.includes(parsed.data.type);
          const attemptId = this.recordAttempt({
            decisionKey: plan.decisionKey,
            context,
            configuration: resolved,
            model,
            status: allowed ? "success" : "invalid-response",
            intentType: allowed ? parsed.data.type : null,
            latencyMs: response.latencyMs,
            errorCode: allowed ? null : "INVALID_RESPONSE",
            startedAt,
            completedAt: response.completedAt
          });
          if (attemptId) this.recordUsage(attemptId, resolved, model, response);
          if (allowed) {
            this.handledDecisionKeys.add(plan.decisionKey);
            return parsed.data;
          }
          lastModelErrorCode = "INVALID_RESPONSE";
          break;
        }

        lastModelErrorCode = response.error.code;
        this.budgetLedger.release(reservation.id);
        this.recordAttempt({
          decisionKey: plan.decisionKey,
          context,
          configuration: resolved,
          model,
          status: "provider-error",
          latencyMs: response.latencyMs,
          errorCode: response.error.code,
          startedAt,
          completedAt: response.completedAt
        });
        if (!response.error.retryable) break;
      }
    }

    this.handledDecisionKeys.add(plan.decisionKey);
    return this.useFallback(
      view,
      context,
      "model-failed",
      lastModelErrorCode,
      plan.decisionKey,
      resolved
    );
  }

  async dispose(): Promise<void> {
    this.handledDecisionKeys.clear();
    this.lockedGameId = null;
    this.lockedConfiguration = null;
    await this.fallback.dispose();
  }

  private resolveConfiguration(): ResolvedConfiguration | null {
    if (this.lockedGameId !== null) return this.lockedConfiguration;
    return this.readConfiguration();
  }

  private readConfiguration(): ResolvedConfiguration | null {
    const profile = this.options.store.getBotProfile(this.options.botProfileId);
    if (!profile?.enabled) return null;
    const model = this.options.store.getModelProfile(profile.modelProfileId);
    if (!model?.enabled) return null;
    const models = this.modelChain(model);
    return models.length > 0 ? { profile, model, models } : null;
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
    modelErrorCode: AiProviderErrorCode | undefined,
    decisionKey: string,
    configuration: ResolvedConfiguration | null
  ): Promise<BotIntent | null> {
    this.options.onFallback?.(reason, modelErrorCode);
    const completedAt = new Date().toISOString();
    this.recordAttempt({
      decisionKey,
      context,
      configuration,
      model: configuration?.model ?? null,
      status: "fallback",
      latencyMs: 0,
      errorCode: modelErrorCode ?? (reason === "configuration-unavailable" ? "CONFIGURATION_UNAVAILABLE" : null),
      startedAt: completedAt,
      completedAt
    });
    return this.fallback.onView(view, context);
  }

  private recordAttempt(input: AttemptAuditInput): string | null {
    if (!this.options.auditStore) return null;
    try {
      return this.options.auditStore.recordAttempt({
        gameSessionId: this.options.gameId(),
        playerId: this.options.playerId,
        decisionKey: input.decisionKey,
        roomRevision: input.context.revision,
        botProfileId: input.configuration?.profile.id ?? null,
        botProfileRevision: input.configuration?.profile.revision ?? null,
        modelProfileId: input.model?.id ?? null,
        modelProfileRevision: input.model?.revision ?? null,
        providerId: input.model?.providerId ?? null,
        model: input.model?.model ?? null,
        status: input.status,
        intentType: input.intentType ?? null,
        latencyMs: input.latencyMs,
        errorCode: input.errorCode ?? null,
        startedAt: input.startedAt,
        completedAt: input.completedAt
      });
    } catch {
      return null;
    }
  }

  private recordUsage(
    decisionId: string,
    configuration: ResolvedConfiguration,
    model: AiModelProfile,
    response: Extract<AiDecisionResponse, { ok: true }>
  ): void {
    if (!this.options.auditStore) return;
    try {
      this.options.auditStore.recordUsage({
        decisionId,
        gameSessionId: this.options.gameId(),
        playerId: this.options.playerId,
        botProfileId: configuration.profile.id,
        modelProfileId: model.id,
        modelProfileRevision: model.revision,
        providerId: model.providerId,
        model: model.model,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.totalTokens,
        createdAt: response.completedAt
      });
    } catch {
      // Auditing must never block a game action.
    }
  }
}

function matchesLock(
  configuration: ResolvedConfiguration,
  lock: BotConfigurationLock
): boolean {
  return configuration.profile.revision === lock.botProfileRevision
    && configuration.model.id === lock.modelProfileId
    && configuration.model.revision === lock.modelProfileRevision
    && modelChainRevision(configuration.models) === lock.modelChainRevision;
}

function modelChainRevision(models: readonly AiModelProfile[]): string {
  return models.map((model) => `${model.id}:${model.revision}`).join(",");
}
