import { describe, expect, it } from "vitest";
import {
  botConfigurationSchema,
  botIntentSchema,
  hostAddBotRequestSchema,
  lobbyPlayerSchema
} from "./index.js";
import type {
  ClientToServerEvents,
  HostAddBotRequest,
  HostLobbyView
} from "./index.js";

const playerId = "019bf178-7f24-7e40-b8dc-0c2dd948d5a7";
const targetId = "019bf178-7f24-7e40-b8dc-0c2dd948d5a8";
const botProfileId = "019bf178-7f24-7e40-b8dc-0c2dd948d5a9";

const addBotPayload: Parameters<ClientToServerEvents["host:add-bot"]>[0] = {
  nickname: "Bot 1",
  botKind: "deterministic"
};

const addBotAck: Parameters<ClientToServerEvents["host:add-bot"]>[1] = (result) => {
  if (result.ok) {
    const lobby: HostLobbyView = result.data;
    void lobby;
  }
};

describe("shared bot schemas", () => {
  it("defaults legacy lobby players to human controllers", () => {
    expect(lobbyPlayerSchema.parse({
      id: playerId,
      number: 1,
      nickname: "Player 1",
      connection: "online"
    })).toMatchObject({
      controller: "human",
      botKind: null,
      botProfileId: null
    });
  });

  it("enforces human, deterministic bot, and LLM bot field consistency", () => {
    expect(botConfigurationSchema.parse({
      controller: "bot",
      botKind: "llm",
      botProfileId
    })).toEqual({
      controller: "bot",
      botKind: "llm",
      botProfileId
    });

    expect(lobbyPlayerSchema.parse({
      id: playerId,
      number: 1,
      nickname: "Bot 1",
      connection: "online",
      controller: "bot",
      botKind: "deterministic"
    })).toMatchObject({
      controller: "bot",
      botKind: "deterministic",
      botProfileId: null
    });

    expect(lobbyPlayerSchema.parse({
      id: playerId,
      number: 1,
      nickname: "Bot 1",
      connection: "online",
      controller: "bot",
      botKind: "llm",
      botProfileId
    })).toMatchObject({
      controller: "bot",
      botKind: "llm",
      botProfileId
    });

    for (const invalidConfiguration of [
      { controller: "human", botKind: "deterministic", botProfileId: null },
      { controller: "human", botKind: null, botProfileId },
      { controller: "bot", botKind: null, botProfileId: null },
      { controller: "bot", botKind: "deterministic", botProfileId },
      { controller: "bot", botKind: "llm", botProfileId: null },
      { controller: "bot", botKind: "random", botProfileId: null }
    ]) {
      expect(lobbyPlayerSchema.safeParse({
        id: playerId,
        number: 1,
        nickname: "Bot 1",
        connection: "online",
        ...invalidConfiguration
      }).success).toBe(false);
    }
  });

  it("preserves deterministic add-bot payloads and accepts strict LLM payloads", () => {
    const request: HostAddBotRequest = addBotPayload;

    expect(hostAddBotRequestSchema.parse(request)).toEqual(request);
    expect(hostAddBotRequestSchema.parse({
      nickname: "LLM Bot",
      botKind: "llm",
      botProfileId
    })).toEqual({
      nickname: "LLM Bot",
      botKind: "llm",
      botProfileId
    });
    expect(hostAddBotRequestSchema.safeParse({
      nickname: "LLM Bot",
      botKind: "llm"
    }).success).toBe(false);
    expect(hostAddBotRequestSchema.safeParse({
      ...request,
      botProfileId
    }).success).toBe(false);
    expect(hostAddBotRequestSchema.safeParse({
      nickname: "Bot 1",
      botKind: "random"
    }).success).toBe(false);
    expect(hostAddBotRequestSchema.safeParse({
      ...request,
      playerId
    }).success).toBe(false);
    expect(typeof addBotAck).toBe("function");
  });

  it("accepts every supported bot intent", () => {
    const intents = [
      { type: "confirm-role" },
      { type: "wolf-select-target", payload: { target: targetId } },
      { type: "wolf-confirm-vote", payload: { confirmed: true } },
      {
        type: "chat-send",
        payload: {
          channel: "day-public",
          content: { kind: "text", text: "I am the seer" }
        }
      },
      { type: "seer-inspect", payload: { target: targetId } },
      { type: "witch-submit-action", payload: { action: "poison", target: targetId } },
      { type: "guard-protect", payload: { target: targetId } },
      { type: "hunter-shoot", payload: { target: null } },
      { type: "finish-speaking" },
      { type: "day-select-vote", payload: { target: "abstain" } },
      { type: "day-confirm-vote", payload: { confirmed: true } }
    ];

    expect(intents.map((intent) => botIntentSchema.parse(intent).type)).toEqual(
      intents.map((intent) => intent.type)
    );
  });

  it("rejects actor ids and malformed nested action payloads", () => {
    for (const intent of [
      { type: "confirm-role", playerId },
      {
        type: "seer-inspect",
        payload: { target: targetId },
        playerId
      },
      {
        type: "seer-inspect",
        payload: { target: targetId, playerId }
      },
      {
        type: "chat-send",
        payload: {
          channel: "day-public",
          content: { kind: "text", text: "Claim" },
          playerId
        }
      }
    ]) {
      expect(botIntentSchema.safeParse(intent).success).toBe(false);
    }
  });
});
