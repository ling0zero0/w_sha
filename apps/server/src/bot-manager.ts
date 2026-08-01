import {
  botIntentSchema,
  type BotIntent,
  type BotKind,
  type PlayerId,
  type PlayerLobbyView
} from "@werewolf/shared";
import type { BotConfigurationLock, LobbyRoom } from "./room.js";

export interface BotTurnContext {
  playerId: PlayerId;
  signal: AbortSignal;
  revision: number;
  deadlineAt: string;
}

export interface BotAdapter {
  readonly kind: BotKind;
  readonly turnTimeoutMs?: number;
  lockForGame?(gameId: string): void;
  onView(view: PlayerLobbyView, context: BotTurnContext): Promise<BotIntent | null>;
  dispose(): Promise<void>;
}

export type BotAdapterFactory = (
  kind: BotKind,
  playerId: PlayerId,
  botProfileId: string | null,
  lockedConfiguration?: BotConfigurationLock
) => BotAdapter;

interface ManagedBot {
  adapter: BotAdapter;
  kind: BotKind;
  lastAttemptedRevision: number | null;
  task: {
    controller: AbortController;
    revision: number;
    generation: number;
  } | null;
  generation: number;
}

interface BotManagerOptions {
  room: LobbyRoom;
  execute: (playerId: PlayerId, intent: BotIntent, expectedRevision: number) => boolean;
  adapterFactory?: BotAdapterFactory;
  timeoutMs?: number;
  onError?: (error: unknown, playerId: PlayerId) => void;
}

export class BotManager {
  private readonly bots = new Map<PlayerId, ManagedBot>();
  private readonly room: LobbyRoom;
  private readonly execute: BotManagerOptions["execute"];
  private readonly adapterFactory: BotAdapterFactory;
  private readonly timeoutMs: number;
  private readonly onError: NonNullable<BotManagerOptions["onError"]>;
  private disposed = false;

  constructor(options: BotManagerOptions) {
    this.room = options.room;
    this.execute = options.execute;
    this.adapterFactory = options.adapterFactory ?? ((kind) => new DeterministicBotAdapter(kind));
    this.timeoutMs = options.timeoutMs ?? 2_000;
    this.onError = options.onError ?? (() => undefined);
  }

  notify(force = false): void {
    if (this.disposed) return;
    this.reconcileBots();
    for (const { playerId } of this.room.getBotSeats()) {
      const bot = this.bots.get(playerId);
      if (force && bot) {
        bot.lastAttemptedRevision = null;
        bot.task?.controller.abort();
      }
      this.schedule(playerId);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const disposals: Promise<void>[] = [];
    for (const bot of this.bots.values()) {
      bot.task?.controller.abort();
      disposals.push(bot.adapter.dispose().catch(() => undefined));
    }
    this.bots.clear();
    await Promise.all(disposals);
  }

  private reconcileBots(): void {
    const seats = new Map(this.room.getBotSeats().map((seat) => [seat.playerId, seat]));
    for (const [playerId, bot] of this.bots) {
      const currentSeat = seats.get(playerId);
      if (currentSeat?.botKind === bot.kind) continue;
      bot.task?.controller.abort();
      void bot.adapter.dispose().catch((error) => this.onError(error, playerId));
      this.bots.delete(playerId);
    }
    for (const [playerId, seat] of seats) {
      if (this.bots.has(playerId)) continue;
      this.bots.set(playerId, {
        adapter: this.adapterFactory(
          seat.botKind,
          playerId,
          seat.botProfileId,
          seat.lockedConfiguration
        ),
        kind: seat.botKind,
        lastAttemptedRevision: null,
        task: null,
        generation: 0
      });
    }
  }

  private schedule(playerId: PlayerId): void {
    const bot = this.bots.get(playerId);
    const view = this.room.getPlayerView(playerId);
    if (!bot || !view) return;

    const gameId = this.room.getGameSessionId();
    if (gameId) bot.adapter.lockForGame?.(gameId);

    if (bot.task) {
      if (bot.task.revision !== view.revision) bot.task.controller.abort();
      return;
    }
    if (bot.lastAttemptedRevision === view.revision) return;

    bot.lastAttemptedRevision = view.revision;
    const controller = new AbortController();
    const generation = bot.generation + 1;
    bot.generation = generation;
    bot.task = { controller, revision: view.revision, generation };
    queueMicrotask(() => void this.runTurn(playerId, bot, view, controller, generation));
  }

  private async runTurn(
    playerId: PlayerId,
    bot: ManagedBot,
    view: PlayerLobbyView,
    controller: AbortController,
    generation: number
  ): Promise<void> {
    let timeout: NodeJS.Timeout | null = null;
    try {
      const turnTimeoutMs = bot.adapter.turnTimeoutMs ?? this.timeoutMs;
      const decision = Promise.resolve(bot.adapter.onView(view, {
        playerId,
        signal: controller.signal,
        revision: view.revision,
        deadlineAt: new Date(Date.now() + turnTimeoutMs).toISOString()
      })).then(
        (intent) => ({ kind: "decision" as const, intent }),
        (error) => ({ kind: "error" as const, error })
      );
      const timedOut = new Promise<{ kind: "timeout" }>((resolve) => {
        timeout = setTimeout(() => resolve({ kind: "timeout" }), turnTimeoutMs);
        timeout.unref();
      });
      const result = await Promise.race([decision, timedOut]);

      if (result.kind === "timeout") {
        controller.abort();
        return;
      }
      if (result.kind === "error") {
        this.onError(result.error, playerId);
        return;
      }
      if (controller.signal.aborted || result.intent === null) return;

      const currentBot = this.bots.get(playerId);
      const currentView = this.room.getPlayerView(playerId);
      if (
        currentBot !== bot
        || bot.generation !== generation
        || currentView?.revision !== view.revision
      ) return;

      const parsed = botIntentSchema.safeParse(result.intent);
      if (!parsed.success) {
        this.onError(parsed.error, playerId);
        return;
      }
      this.execute(playerId, parsed.data, view.revision);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (bot.task?.generation === generation) bot.task = null;
      if (!this.disposed) this.schedule(playerId);
    }
  }
}

export class DeterministicBotAdapter implements BotAdapter {
  readonly kind: BotKind;
  private sentPublicMessage = false;

  constructor(kind: BotKind = "deterministic") {
    this.kind = kind;
  }

  async onView(view: PlayerLobbyView, context: BotTurnContext): Promise<BotIntent | null> {
    if (context.signal.aborted) return null;

    if (view.phase === "role-reveal" && view.privateRole && !view.privateRole.confirmed) {
      return { type: "confirm-role" };
    }

    if (view.wolfAction?.chatEnabled && !view.wolfAction.locked) {
      if (view.wolfAction.target === null) {
        const teammateIds = new Set(view.privateRole?.wolfTeammates.map((player) => player.id) ?? []);
        const target = view.wolfAction.candidates.find(
          (candidate) => candidate.id !== view.selfId && !teammateIds.has(candidate.id)
        );
        return {
          type: "wolf-select-target",
          payload: { target: target?.id ?? "no-kill" }
        };
      }
      if (!view.wolfAction.confirmed) {
        return { type: "wolf-confirm-vote", payload: { confirmed: true } };
      }
    }

    if (view.seerAction?.active && !view.seerAction.inspectedPlayer) {
      const target = view.seerAction.candidates[0];
      return target ? { type: "seer-inspect", payload: { target: target.id } } : null;
    }
    if (view.guardAction?.active && !view.guardAction.submitted) {
      return {
        type: "guard-protect",
        payload: { target: view.guardAction.candidates[0]?.id ?? null }
      };
    }
    if (view.witchAction?.active && !view.witchAction.submitted) {
      return { type: "witch-submit-action", payload: { action: "none" } };
    }
    if (view.hunterAction?.active && !view.hunterAction.submitted) {
      return { type: "hunter-shoot", payload: { target: null } };
    }

    const currentSpeakerId = view.dayState?.currentSpeaker?.id;
    if (
      currentSpeakerId === view.selfId
      && view.publicChat.canSend
      && (view.phase === "last-words" || view.phase === "day-speech")
    ) {
      if (!this.sentPublicMessage) {
        this.sentPublicMessage = true;
        return {
          type: "chat-send",
          payload: {
            channel: "day-public",
            content: { kind: "text", text: "我会根据当前公开信息参与讨论。" }
          }
        };
      }
      return { type: "finish-speaking" };
    }

    if (view.dayVote?.eligible && !view.dayVote.confirmed) {
      if (view.dayVote.target === null) {
        return {
          type: "day-select-vote",
          payload: { target: view.dayVote.candidates[0]?.id ?? "abstain" }
        };
      }
      return { type: "day-confirm-vote", payload: { confirmed: true } };
    }

    return null;
  }

  async dispose(): Promise<void> {
    this.sentPublicMessage = false;
  }
}
