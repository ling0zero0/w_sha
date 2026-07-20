import type {
  BotIntent,
  PlayerId,
  PlayerLobbyView
} from "@werewolf/shared";

export type BotIntentType = BotIntent["type"];

export type BotDecisionPlan =
  | { kind: "skip" }
  | { kind: "deterministic"; intent: BotIntent }
  | {
      kind: "llm";
      decisionKey: string;
      allowedIntentTypes: BotIntentType[];
    };

export interface BotDecisionGateInput {
  gameId: string;
  view: PlayerLobbyView;
  handledDecisionKeys?: ReadonlySet<string>;
}

interface LlmDecision {
  action: string;
  candidateIds: readonly string[];
  allowedIntentTypes: BotIntentType[];
}

export function planBotDecision(input: BotDecisionGateInput): BotDecisionPlan {
  const { view } = input;

  if (
    view.phase === "role-reveal"
    && view.privateRole
    && !view.privateRole.confirmed
  ) {
    return deterministic({ type: "confirm-role" });
  }

  const wolfPlan = planWolfDecision(view);
  if (wolfPlan === "no-kill") {
    return deterministic({
      type: "wolf-select-target",
      payload: { target: "no-kill" }
    });
  }
  if (wolfPlan) return finalizeLlmPlan(input, wolfPlan);
  if (
    view.wolfAction?.chatEnabled
    && !view.wolfAction.locked
    && view.wolfAction.target !== null
    && !view.wolfAction.confirmed
  ) {
    return deterministic({
      type: "wolf-confirm-vote",
      payload: { confirmed: true }
    });
  }

  if (view.seerAction?.active && !view.seerAction.inspectedPlayer) {
    if (view.seerAction.candidates.length === 0) return { kind: "skip" };
    return finalizeLlmPlan(input, {
      action: "seer-target",
      candidateIds: ids(view.seerAction.candidates),
      allowedIntentTypes: ["seer-inspect"]
    });
  }

  if (view.guardAction?.active && !view.guardAction.submitted) {
    if (view.guardAction.candidates.length === 0) {
      return deterministic({
        type: "guard-protect",
        payload: { target: null }
      });
    }
    return finalizeLlmPlan(input, {
      action: "guard-target",
      candidateIds: ids(view.guardAction.candidates),
      allowedIntentTypes: ["guard-protect"]
    });
  }

  if (view.witchAction?.active && !view.witchAction.submitted) {
    return finalizeLlmPlan(input, {
      action: "witch-action",
      candidateIds: ids(view.witchAction.poisonCandidates),
      allowedIntentTypes: ["witch-submit-action"]
    });
  }

  if (view.hunterAction?.active && !view.hunterAction.submitted) {
    if (view.hunterAction.candidates.length === 0) {
      return deterministic({
        type: "hunter-shoot",
        payload: { target: null }
      });
    }
    return finalizeLlmPlan(input, {
      action: "hunter-target",
      candidateIds: ids(view.hunterAction.candidates),
      allowedIntentTypes: ["hunter-shoot"]
    });
  }

  if (isCurrentSpeaker(view) && view.publicChat.canSend) {
    if (hasSpokenThisTurn(view)) {
      return deterministic({ type: "finish-speaking" });
    }
    return finalizeLlmPlan(input, {
      action: view.phase === "last-words" ? "last-words" : "day-speech",
      candidateIds: [],
      allowedIntentTypes: ["chat-send"]
    });
  }

  if (view.dayVote?.eligible && !view.dayVote.confirmed) {
    if (view.dayVote.target !== null) {
      return deterministic({
        type: "day-confirm-vote",
        payload: { confirmed: true }
      });
    }
    if (view.dayVote.candidates.length === 0) {
      return deterministic({
        type: "day-select-vote",
        payload: { target: "abstain" }
      });
    }
    return finalizeLlmPlan(input, {
      action: "day-vote",
      candidateIds: ids(view.dayVote.candidates),
      allowedIntentTypes: ["day-select-vote"]
    });
  }

  return { kind: "skip" };
}

function planWolfDecision(
  view: PlayerLobbyView
): LlmDecision | "no-kill" | null {
  const action = view.wolfAction;
  if (!action?.chatEnabled || action.locked || action.target !== null) return null;

  const teammateIds = new Set(
    view.privateRole?.wolfTeammates.map((player) => player.id) ?? []
  );
  const candidateIds = action.candidates
    .map((candidate) => candidate.id)
    .filter((candidateId) => (
      candidateId !== view.selfId && !teammateIds.has(candidateId)
    ));

  if (candidateIds.length === 0) return "no-kill";
  return {
    action: "wolf-target",
    candidateIds,
    allowedIntentTypes: ["wolf-select-target", "chat-send"]
  };
}

function finalizeLlmPlan(
  input: BotDecisionGateInput,
  decision: LlmDecision
): BotDecisionPlan {
  const decisionKey = buildDecisionKey(input.gameId, input.view, decision);
  if (input.handledDecisionKeys?.has(decisionKey)) return { kind: "skip" };
  return {
    kind: "llm",
    decisionKey,
    allowedIntentTypes: [...decision.allowedIntentTypes]
  };
}

function buildDecisionKey(
  gameId: string,
  view: PlayerLobbyView,
  decision: LlmDecision
): string {
  const candidateSummary = [...decision.candidateIds].sort().join(",");
  return [
    "v1",
    `game=${encodeURIComponent(gameId)}`,
    `day=${currentDay(view)}`,
    `phase=${view.phase}`,
    `substage=${nightSubstage(view, decision.action)}`,
    `seat=${view.selfId}`,
    `action=${decision.action}`,
    `candidates=${candidateSummary}`,
    `chat=${latestAuthorizedChatSequence(view)}`
  ].join("|");
}

function deterministic(intent: BotIntent): BotDecisionPlan {
  return { kind: "deterministic", intent };
}

function ids(players: readonly { id: PlayerId }[]): PlayerId[] {
  return players.map((player) => player.id);
}

function isCurrentSpeaker(view: PlayerLobbyView): boolean {
  return (
    (view.phase === "last-words" || view.phase === "day-speech")
    && view.dayState?.currentSpeaker?.id === view.selfId
  );
}

function hasSpokenThisTurn(view: PlayerLobbyView): boolean {
  const day = currentDay(view);
  return view.publicChat.messages.some((message) => (
    message.channel === "day-public"
    && message.day === day
    && message.phase === view.phase
    && message.sender.kind !== "system"
    && message.sender.id === view.selfId
  ));
}

function currentDay(view: PlayerLobbyView): number {
  const messages = [
    ...view.publicChat.messages,
    ...(view.wolfAction?.messages ?? [])
  ];
  return messages.reduce((latest, message) => Math.max(latest, message.day), 1);
}

function latestAuthorizedChatSequence(view: PlayerLobbyView): number {
  const messages = [
    ...view.publicChat.messages,
    ...(view.wolfAction?.messages ?? [])
  ];
  return messages.reduce(
    (latest, message) => Math.max(latest, message.sequence),
    0
  );
}

function nightSubstage(view: PlayerLobbyView, action: string): string {
  if (view.nightProgress?.stage === "night-action") return action;
  return "none";
}
