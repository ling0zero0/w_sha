import { describe, expect, it } from "vitest";
import {
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
      botKind: null
    });
  });

  it("identifies deterministic bots and rejects unknown bot kinds", () => {
    expect(lobbyPlayerSchema.parse({
      id: playerId,
      number: 1,
      nickname: "Bot 1",
      connection: "online",
      controller: "bot",
      botKind: "deterministic"
    })).toMatchObject({
      controller: "bot",
      botKind: "deterministic"
    });

    expect(lobbyPlayerSchema.safeParse({
      id: playerId,
      number: 1,
      nickname: "Bot 1",
      connection: "online",
      controller: "bot",
      botKind: "random"
    }).success).toBe(false);
  });

  it("validates strict deterministic host add-bot requests and event typing", () => {
    const request: HostAddBotRequest = addBotPayload;

    expect(hostAddBotRequestSchema.parse(request)).toEqual(request);
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
