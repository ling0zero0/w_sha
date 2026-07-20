import type { PlayerLobbyView } from "@werewolf/shared";
import { describe, expect, it } from "vitest";
import { planBotDecision } from "./decision-gate.js";

const selfId = "019bf178-7f24-7e40-b8dc-0c2dd948d5aa";
const targetId = "019bf178-7f24-7e40-b8dc-0c2dd948d5ab";

function createView(
  overrides: Partial<PlayerLobbyView> = {}
): PlayerLobbyView {
  return {
    phase: "lobby",
    roomCode: "123456",
    revision: 1,
    selfId,
    players: [],
    chatMode: "ordered",
    revealedIdiotId: null,
    privateRole: null,
    roleConfirmation: { confirmed: 0, total: 0 },
    nightProgress: null,
    wolfAction: null,
    seerAction: null,
    witchAction: null,
    guardAction: null,
    hunterAction: null,
    dawnResult: null,
    dayState: null,
    dayVote: null,
    gameResult: null,
    publicChat: { canSend: false, messages: [] },
    ...overrides
  };
}

const candidate = {
  id: targetId,
  number: 2,
  nickname: "Target"
};

describe("LLM decision gate", () => {
  it("skips revisions without a semantic action", () => {
    expect(planBotDecision({
      gameId: "game-1",
      view: createView({ revision: 42 })
    })).toEqual({ kind: "skip" });
  });

  it("handles mechanical confirmations and completed speech deterministically", () => {
    expect(planBotDecision({
      gameId: "game-1",
      view: createView({
        phase: "role-reveal",
        privateRole: {
          role: "villager",
          confirmed: false,
          wolfTeammates: []
        }
      })
    })).toEqual({
      kind: "deterministic",
      intent: { type: "confirm-role" }
    });

    const speechView = createView({
      phase: "day-speech",
      dayState: {
        alivePlayerIds: [selfId, targetId],
        revealedIdiot: null,
        hunterPending: false,
        currentSpeaker: { id: selfId, number: 1, nickname: "Bot" },
        speechOrder: [],
        voteProgress: null,
        voteResult: null
      },
      publicChat: {
        canSend: true,
        messages: [{
          id: "019bf178-7f24-7e40-b8dc-0c2dd948d5ac",
          sequence: 7,
          channel: "day-public",
          day: 2,
          phase: "day-speech",
          sender: {
            kind: "bot",
            id: selfId,
            number: 1,
            nickname: "Bot"
          },
          content: { kind: "text", text: "My read." },
          createdAt: "2026-07-19T12:00:00.000Z"
        }]
      }
    });
    expect(planBotDecision({ gameId: "game-1", view: speechView })).toEqual({
      kind: "deterministic",
      intent: { type: "finish-speaking" }
    });

    expect(planBotDecision({
      gameId: "game-1",
      view: createView({
        phase: "day-vote",
        dayVote: {
          eligible: true,
          candidates: [candidate],
          target: targetId,
          confirmed: false
        }
      })
    })).toEqual({
      kind: "deterministic",
      intent: {
        type: "day-confirm-vote",
        payload: { confirmed: true }
      }
    });
  });

  it("uses deterministic empty actions when no legal target exists", () => {
    expect(planBotDecision({
      gameId: "game-1",
      view: createView({
        phase: "first-night",
        privateRole: {
          role: "wolf",
          confirmed: true,
          wolfTeammates: [candidate]
        },
        wolfAction: {
          candidates: [candidate],
          target: null,
          confirmed: false,
          locked: false,
          chatEnabled: true,
          messages: []
        }
      })
    })).toEqual({
      kind: "deterministic",
      intent: {
        type: "wolf-select-target",
        payload: { target: "no-kill" }
      }
    });
  });

  it("creates stable semantic keys and suppresses handled decisions", () => {
    const first = planBotDecision({
      gameId: "game-1",
      view: createView({
        phase: "first-night",
        revision: 10,
        privateRole: {
          role: "seer",
          confirmed: true,
          wolfTeammates: []
        },
        nightProgress: {
          stage: "night-action",
          confirmed: 0,
          required: 1,
          locked: false
        },
        seerAction: {
          active: true,
          candidates: [candidate],
          inspectedPlayer: null,
          result: null
        }
      })
    });
    const second = planBotDecision({
      gameId: "game-1",
      view: createView({
        phase: "first-night",
        revision: 11,
        privateRole: {
          role: "seer",
          confirmed: true,
          wolfTeammates: []
        },
        nightProgress: {
          stage: "night-action",
          confirmed: 0,
          required: 1,
          locked: false
        },
        seerAction: {
          active: true,
          candidates: [candidate],
          inspectedPlayer: null,
          result: null
        }
      })
    });

    expect(first).toMatchObject({
      kind: "llm",
      allowedIntentTypes: ["seer-inspect"]
    });
    expect(second).toEqual(first);
    if (first.kind !== "llm") throw new Error("expected an LLM plan");
    expect(first.decisionKey).toContain("game=game-1");
    expect(first.decisionKey).toContain(`seat=${selfId}`);
    expect(planBotDecision({
      gameId: "game-1",
      view: createView({
        phase: "first-night",
        revision: 12,
        privateRole: {
          role: "seer",
          confirmed: true,
          wolfTeammates: []
        },
        nightProgress: {
          stage: "night-action",
          confirmed: 0,
          required: 1,
          locked: false
        },
        seerAction: {
          active: true,
          candidates: [candidate],
          inspectedPlayer: null,
          result: null
        }
      }),
      handledDecisionKeys: new Set([first.decisionKey])
    })).toEqual({ kind: "skip" });
  });

  it("allows only the intents relevant to targets, speech and voting", () => {
    const wolf = planBotDecision({
      gameId: "game-1",
      view: createView({
        phase: "first-night",
        privateRole: {
          role: "wolf",
          confirmed: true,
          wolfTeammates: []
        },
        wolfAction: {
          candidates: [candidate],
          target: null,
          confirmed: false,
          locked: false,
          chatEnabled: true,
          messages: []
        }
      })
    });
    expect(wolf).toMatchObject({
      kind: "llm",
      allowedIntentTypes: ["wolf-select-target", "chat-send"]
    });

    const vote = planBotDecision({
      gameId: "game-1",
      view: createView({
        phase: "day-vote",
        dayVote: {
          eligible: true,
          candidates: [candidate],
          target: null,
          confirmed: false
        }
      })
    });
    expect(vote).toMatchObject({
      kind: "llm",
      allowedIntentTypes: ["day-select-vote"]
    });
  });
});
