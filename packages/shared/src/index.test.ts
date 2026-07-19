import { describe, expect, it } from "vitest";
import {
  chatHistoryPageSchema,
  chatHistoryRequestSchema,
  chatModeSchema,
  chatMessageSchema,
  chatSendRequestSchema,
  clientPingSchema,
  gameSessionIdSchema,
  gameRecordSchema,
  guardProtectRequestSchema,
  hostAdjustPhaseTimeRequestSchema,
  hostCorrectPlayerLifeRequestSchema,
  hostLobbyViewSchema,
  hostUpdateChatModeRequestSchema,
  hunterShootRequestSchema,
  joinLobbyRequestSchema,
  nicknameSchema,
  playerLobbyViewSchema,
  playerCredentialsSchema,
  publicGameStateSchema,
  gameResultSchema,
  roleConfigurationSchema,
  roleSchema,
  serviceStatusSchema
} from "./index.js";
import type {
  ClientToServerEvents,
  NormalizedRoleConfiguration,
  RoleConfiguration,
  RoleConfigurationInput
} from "./index.js";

const legacyRoleConfiguration: RoleConfigurationInput = {
  wolf: 1,
  villager: 2,
  seer: 1,
  witch: 0
};
const updateRoleConfigurationPayload: Parameters<
  ClientToServerEvents["host:update-role-configuration"]
>[0] = legacyRoleConfiguration;
const updateChatModePayload: Parameters<
  ClientToServerEvents["host:update-chat-mode"]
>[0] = { chatMode: "open" };

describe("shared transport schemas", () => {
  it("accepts the public service status", () => {
    const parsed = serviceStatusSchema.parse({
      name: "werewolf-lan-server",
      version: "0.1.0",
      status: "ok",
      serverTime: "2026-07-15T04:00:00.000Z"
    });

    expect(parsed.status).toBe("ok");
  });

  it("rejects malformed client timestamps", () => {
    expect(() => clientPingSchema.parse({ sentAt: -1 })).toThrow();
  });

  it("normalizes and validates lobby nicknames", () => {
    expect(nicknameSchema.parse("  林野  ")).toBe("林野");
    expect(() => nicknameSchema.parse("1234567890123")).toThrow();
  });

  it("requires a room code and an active join token", () => {
    const join = joinLobbyRequestSchema.parse({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "林野"
    });

    expect(join.nickname).toBe("林野");
    expect(() => joinLobbyRequestSchema.parse({ roomCode: "123456", nickname: "林野" })).toThrow();
  });

  it("keeps join credentials out of validated host lobby fields except the join URL", () => {
    const view = hostLobbyViewSchema.parse({
      phase: "lobby",
      roomCode: "123456",
      revision: 0,
      players: [],
      joinUrl: "http://192.168.1.8:5173/join/123456?t=abcdefghijklmnopqrstuvwxyz123456",
      localAddress: "192.168.1.8",
      takeoverRequests: [],
      roleConfiguration: { wolf: 0, villager: 0, seer: 0, witch: 0 },
      roleConfirmation: { confirmed: 0, total: 0 },
      nightProgress: null,
      dawnResult: null,
      dayState: null,
      gameResult: null,
      startReadiness: {
        ready: false,
        participantCount: 0,
        configuredRoleCount: 0,
        issues: [
          { code: "WOLF_REQUIRED", message: "至少需要 1 名狼人" },
          { code: "VILLAGER_REQUIRED", message: "至少需要 1 名村民" },
          { code: "GOD_REQUIRED", message: "至少需要 1 名神职" }
        ]
      }
    });

    expect(Object.keys(view)).not.toContain("joinToken");
    expect(view.chatMode).toBe("ordered");
    expect(view.revealedIdiotId).toBeNull();
    expect(view.roleConfiguration).toEqual({
      wolf: 0,
      villager: 0,
      seer: 0,
      witch: 0,
      guard: 0,
      hunter: 0,
      idiot: 0
    });
  });

  it("defaults chat mode and validates strict host updates", () => {
    expect(chatModeSchema.parse(undefined)).toBe("ordered");
    expect(chatModeSchema.parse("open")).toBe("open");
    expect(hostUpdateChatModeRequestSchema.parse(updateChatModePayload)).toEqual({
      chatMode: "open"
    });
    expect(hostUpdateChatModeRequestSchema.safeParse({}).success).toBe(false);
    expect(hostUpdateChatModeRequestSchema.safeParse({
      chatMode: "ordered",
      extra: true
    }).success).toBe(false);
    expect(hostUpdateChatModeRequestSchema.safeParse({ chatMode: "free" }).success).toBe(false);
  });

  it("validates stable player reconnect credentials", () => {
    const credentials = playerCredentialsSchema.parse({
      roomCode: "123456",
      playerId: "019bf178-7f24-7e40-b8dc-0c2dd948d5a7",
      reconnectToken: "abcdefghijklmnopqrstuvwxyz123456"
    });

    expect(credentials.roomCode).toBe("123456");
    expect(() => playerCredentialsSchema.parse({ ...credentials, reconnectToken: "short" })).toThrow();
  });

  it("validates public clock state and host intervention records", () => {
    const state = publicGameStateSchema.parse({
      revision: 2,
      clock: {
        status: "paused",
        deadlineAt: null,
        remainingMs: 45_000
      },
      interventions: [{
        id: "019bf178-7f24-7e40-b8dc-0c2dd948d5a7",
        type: "pause",
        createdAt: "2026-07-15T04:00:00.000Z",
        detail: "主机暂停了当前阶段"
      }]
    });

    expect(state.clock.remainingMs).toBe(45_000);
    expect(JSON.stringify(state)).not.toMatch(/sessionToken|joinToken|reconnectToken|role|identity/);
    expect(() => publicGameStateSchema.parse({ ...state, clock: { ...state.clock, remainingMs: -1 } })).toThrow();
  });

  it("accepts a public player departure intervention", () => {
    const state = publicGameStateSchema.parse({
      revision: 1,
      clock: { status: "idle", deadlineAt: null, remainingMs: 0 },
      interventions: [{
        id: "019bf178-7f24-7e40-b8dc-0c2dd948d5a7",
        type: "depart-player",
        createdAt: "2026-07-15T04:00:00.000Z",
        detail: "主机将 2 号玩家阿岚判定为离场"
      }]
    });

    expect(state.interventions[0]?.type).toBe("depart-player");
  });

  it("limits host time adjustments", () => {
    expect(hostAdjustPhaseTimeRequestSchema.parse({ deltaMs: 15_000 })).toEqual({ deltaMs: 15_000 });
    expect(() => hostAdjustPhaseTimeRequestSchema.parse({ deltaMs: 0 })).toThrow();
    expect(() => hostAdjustPhaseTimeRequestSchema.parse({ deltaMs: 300_001 })).toThrow();
  });

  it("validates host life corrections", () => {
    expect(hostCorrectPlayerLifeRequestSchema.parse({
      playerId: "019bf178-7f24-7e40-b8dc-0c2dd948d5a7",
      alive: false
    })).toMatchObject({ alive: false });
    expect(() => hostCorrectPlayerLifeRequestSchema.parse({
      playerId: "019bf178-7f24-7e40-b8dc-0c2dd948d5a7",
      alive: "false"
    })).toThrow();
  });

  it("validates records disclosed only with the final game result", () => {
    const result = gameResultSchema.parse({
      outcome: "terminated",
      revealedPlayers: [{
        id: "019bf178-7f24-7e40-b8dc-0c2dd948d5a7",
        number: 1,
        nickname: "林野",
        role: "seer",
        alive: true
      }],
      records: [{ type: "seer-inspection", day: 1, detail: "1 号林野查验 2 号阿岚：狼人" }]
    });

    expect(result?.records[0]?.type).toBe("seer-inspection");
  });

  it("validates the extended role configuration", () => {
    expect(["guard", "hunter", "idiot"].map((role) => roleSchema.parse(role))).toEqual([
      "guard",
      "hunter",
      "idiot"
    ]);
    const normalized: NormalizedRoleConfiguration = roleConfigurationSchema.parse(
      updateRoleConfigurationPayload
    );
    const configuration: RoleConfiguration = normalized;
    expect(configuration).toEqual({
      wolf: 1,
      villager: 2,
      seer: 1,
      witch: 0,
      guard: 0,
      hunter: 0,
      idiot: 0
    });
    expect(roleConfigurationSchema.parse({ wolf: 2, villager: 3, seer: 1, witch: 1 })).toEqual({
      wolf: 2,
      villager: 3,
      seer: 1,
      witch: 1,
      guard: 0,
      hunter: 0,
      idiot: 0
    });
    expect(roleConfigurationSchema.parse({
      wolf: 2,
      villager: 3,
      seer: 1,
      witch: 1,
      guard: 1,
      hunter: 1,
      idiot: 1
    })).toEqual({
      wolf: 2,
      villager: 3,
      seer: 1,
      witch: 1,
      guard: 1,
      hunter: 1,
      idiot: 1
    });
    expect(() => roleConfigurationSchema.parse({
      wolf: -1,
      villager: 3,
      seer: 1,
      witch: 0,
      guard: 0,
      hunter: 0,
      idiot: 0
    })).toThrow();
    for (const role of ["guard", "hunter", "idiot"] as const) {
      expect(() => roleConfigurationSchema.parse({
        wolf: 1,
        villager: 3,
        seer: 1,
        witch: 0,
        [role]: 2
      })).toThrow();
    }
    expect(() => roleConfigurationSchema.parse({
      wolf: 1,
      villager: 3,
      seer: 1,
      witch: 0,
      guard: 0,
      hunter: 1,
      idiot: 0,
      unknown: 1
    })).toThrow();
  });

  it("validates strict guard and hunter action payloads", () => {
    const target = "019bf178-7f24-7e40-b8dc-0c2dd948d5a7";

    expect(guardProtectRequestSchema.parse({ target })).toEqual({ target });
    expect(guardProtectRequestSchema.parse({ target: null })).toEqual({ target: null });
    expect(hunterShootRequestSchema.parse({ target: null })).toEqual({ target: null });
    expect(() => guardProtectRequestSchema.parse({ target, extra: true })).toThrow();
    expect(() => hunterShootRequestSchema.parse({ target: "not-a-player-id" })).toThrow();
    expect(() => hunterShootRequestSchema.parse({ target: null, extra: true })).toThrow();
  });

  it("validates private guard and hunter actions plus public idiot state", () => {
    const selfId = "019bf178-7f24-7e40-b8dc-0c2dd948d5a7";
    const candidate = {
      id: "019bf178-7f24-7e40-b8dc-0c2dd948d5a8",
      number: 2,
      nickname: "Player 2"
    };
    const view = playerLobbyViewSchema.parse({
      phase: "day-vote",
      roomCode: "123456",
      revision: 4,
      players: [],
      chatMode: "open",
      revealedIdiotId: candidate.id,
      selfId,
      privateRole: null,
      roleConfirmation: { confirmed: 0, total: 0 },
      nightProgress: null,
      wolfAction: null,
      seerAction: null,
      witchAction: null,
      guardAction: {
        active: false,
        candidates: [candidate],
        protectedPlayer: candidate,
        submitted: true
      },
      hunterAction: {
        active: true,
        candidates: [candidate],
        shotPlayer: null,
        submitted: false
      },
      dawnResult: null,
      dayState: {
        alivePlayerIds: [selfId, candidate.id],
        revealedIdiot: candidate,
        hunterPending: true,
        currentSpeaker: null,
        speechOrder: [],
        voteProgress: { confirmed: 0, total: 1 },
        voteResult: null
      },
      dayVote: {
        eligible: false,
        candidates: [],
        target: null,
        confirmed: false
      },
      gameResult: null
    });

    expect(view.guardAction?.protectedPlayer?.id).toBe(candidate.id);
    expect(view.hunterAction?.active).toBe(true);
    expect(view.revealedIdiotId).toBe(candidate.id);
    expect(view.dayState?.revealedIdiot?.id).toBe(candidate.id);
    expect(view.dayState?.hunterPending).toBe(true);
    expect(view.dayVote?.eligible).toBe(false);
    expect(view.chatMode).toBe("open");
  });

  it("accepts records for every extended role action", () => {
    for (const type of ["guard-action", "hunter-shot", "idiot-reveal"] as const) {
      expect(gameRecordSchema.parse({ type, day: 1, detail: `${type} detail` }).type).toBe(type);
    }
  });
});

describe("shared chat schemas", () => {
  const playerId = "019bf178-7f24-7e40-b8dc-0c2dd948d5a7";
  const targetId = "019bf178-7f24-7e40-b8dc-0c2dd948d5a8";
  const sessionId = "019bf178-7f24-7e40-b8dc-0c2dd948d5aa";
  const messageBase = {
    id: "019bf178-7f24-7e40-b8dc-0c2dd948d5a9",
    sequence: 1,
    day: 1,
    phase: "day-vote",
    createdAt: "2026-07-19T04:00:00.000Z"
  };

  it("parses every chat channel, sender kind, and content kind", () => {
    const messages = [
      {
        ...messageBase,
        channel: "day-public",
        sender: {
          kind: "player",
          id: playerId,
          number: 1,
          nickname: "Player 1"
        },
        content: { kind: "text", text: "  Public claim  " }
      },
      {
        ...messageBase,
        sequence: 2,
        channel: "wolf-private",
        sender: {
          kind: "bot",
          id: targetId,
          number: 2,
          nickname: "Bot 2"
        },
        content: { kind: "quick", code: "agree" }
      },
      {
        ...messageBase,
        sequence: 3,
        channel: "wolf-private",
        sender: {
          kind: "player",
          id: playerId,
          number: 1,
          nickname: "Player 1"
        },
        content: {
          kind: "target-suggestion",
          target: {
            id: targetId,
            number: 2,
            nickname: "Player 2"
          }
        }
      },
      {
        ...messageBase,
        sequence: 4,
        channel: "system",
        sender: {
          kind: "system",
          label: "Moderator"
        },
        content: { kind: "system", text: "  Discussion started  " }
      }
    ];

    const parsed = messages.map((message) => chatMessageSchema.parse(message));

    expect(parsed.map((message) => [
      message.channel,
      message.sender.kind,
      message.content.kind
    ])).toEqual([
      ["day-public", "player", "text"],
      ["wolf-private", "bot", "quick"],
      ["wolf-private", "player", "target-suggestion"],
      ["system", "system", "system"]
    ]);
    expect(parsed[0]?.content).toEqual({ kind: "text", text: "Public claim" });
    expect(parsed[3]?.content).toEqual({ kind: "system", text: "Discussion started" });
  });

  it("accepts only text content for day-public client messages", () => {
    expect(chatSendRequestSchema.parse({
      channel: "day-public",
      content: { kind: "text", text: "  I am the seer  " }
    })).toEqual({
      channel: "day-public",
      content: { kind: "text", text: "I am the seer" }
    });

    for (const content of [
      { kind: "quick", code: "agree" },
      { kind: "target-suggestion", target: targetId },
      { kind: "system", text: "Injected notice" }
    ]) {
      expect(chatSendRequestSchema.safeParse({
        channel: "day-public",
        content
      }).success).toBe(false);
    }
  });

  it("accepts wolf-private text, quick replies, and target suggestions", () => {
    expect(chatSendRequestSchema.parse({
      channel: "wolf-private",
      content: { kind: "text", text: ` ${"x".repeat(80)} ` }
    }).content).toEqual({ kind: "text", text: "x".repeat(80) });

    for (const code of ["agree", "disagree", "no-kill"] as const) {
      expect(chatSendRequestSchema.parse({
        channel: "wolf-private",
        content: { kind: "quick", code }
      }).content).toEqual({ kind: "quick", code });
    }

    expect(chatSendRequestSchema.parse({
      channel: "wolf-private",
      content: { kind: "target-suggestion", target: targetId }
    }).content).toEqual({ kind: "target-suggestion", target: targetId });
  });

  it("rejects system client messages and invalid text boundaries", () => {
    expect(chatSendRequestSchema.safeParse({
      channel: "system",
      content: { kind: "system", text: "Forged system message" }
    }).success).toBe(false);

    for (const request of [
      { channel: "day-public", content: { kind: "text", text: "   " } },
      { channel: "day-public", content: { kind: "text", text: "x".repeat(201) } },
      { channel: "wolf-private", content: { kind: "text", text: "\t\n" } },
      { channel: "wolf-private", content: { kind: "text", text: "x".repeat(81) } }
    ]) {
      expect(chatSendRequestSchema.safeParse(request).success).toBe(false);
    }
  });

  it("rejects invalid wolf target suggestions", () => {
    for (const target of [
      "not-a-player-id",
      null,
      {
        id: targetId,
        number: 2,
        nickname: "Player 2"
      }
    ]) {
      expect(chatSendRequestSchema.safeParse({
        channel: "wolf-private",
        content: { kind: "target-suggestion", target }
      }).success).toBe(false);
    }
  });

  it("defaults chat history pagination without accepting authorization fields", () => {
    expect(chatHistoryRequestSchema.parse({})).toEqual({
      afterSequence: 0,
      limit: 100
    });

    for (const request of [
      { sessionId },
      { channels: ["day-public"] },
      { afterSequence: 0, limit: 100, extra: true }
    ]) {
      expect(chatHistoryRequestSchema.safeParse(request).success).toBe(false);
    }
  });

  it("validates chat history pagination boundaries", () => {
    expect(chatHistoryRequestSchema.parse({
      afterSequence: 0,
      limit: 1
    })).toEqual({
      afterSequence: 0,
      limit: 1
    });
    expect(chatHistoryRequestSchema.parse({
      afterSequence: Number.MAX_SAFE_INTEGER,
      limit: 100
    })).toEqual({
      afterSequence: Number.MAX_SAFE_INTEGER,
      limit: 100
    });

    for (const request of [
      { afterSequence: -1 },
      { afterSequence: 0.5 },
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 }
    ]) {
      expect(chatHistoryRequestSchema.safeParse(request).success).toBe(false);
    }
  });

  it("parses strict chat history pages", () => {
    expect(gameSessionIdSchema.parse(sessionId)).toBe(sessionId);
    expect(() => gameSessionIdSchema.parse("not-a-session-id")).toThrow();

    const message = chatMessageSchema.parse({
      ...messageBase,
      channel: "day-public",
      sender: {
        kind: "player",
        id: playerId,
        number: 1,
        nickname: "Player 1"
      },
      content: { kind: "text", text: "History message" }
    });
    const page = {
      sessionId,
      messages: [message],
      latestSequence: 1,
      hasMore: false
    };

    expect(chatHistoryPageSchema.parse(page)).toEqual(page);
    expect(chatHistoryPageSchema.safeParse({
      ...page,
      latestSequence: -1
    }).success).toBe(false);
    expect(chatHistoryPageSchema.safeParse({
      ...page,
      extra: true
    }).success).toBe(false);
  });
});
