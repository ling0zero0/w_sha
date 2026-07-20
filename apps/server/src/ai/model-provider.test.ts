import { describe, expect, it } from "vitest";
import { parseAiModelDecision } from "./model-provider.js";

describe("AI model decision parsing", () => {
  it("accepts a strict shared BotIntent", () => {
    expect(parseAiModelDecision({
      protocolVersion: 1,
      intent: {
        type: "day-confirm-vote",
        payload: { confirmed: true }
      }
    })).toEqual({
      protocolVersion: 1,
      intent: {
        type: "day-confirm-vote",
        payload: { confirmed: true }
      }
    });
  });

  it("rejects unknown actions, actor fields and wrapper fields", () => {
    expect(() => parseAiModelDecision({
      protocolVersion: 1,
      intent: { type: "invent-action" }
    })).toThrow();
    expect(() => parseAiModelDecision({
      protocolVersion: 1,
      intent: {
        type: "confirm-role",
        actor: "player-secret"
      }
    })).toThrow();
    expect(() => parseAiModelDecision({
      protocolVersion: 1,
      intent: null,
      rawResponse: "must not be accepted"
    })).toThrow();
  });
});
