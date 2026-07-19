import { describe, expect, it } from "vitest";
import {
  clientPingSchema,
  gameRecordSchema,
  guardProtectRequestSchema,
  hostAdjustPhaseTimeRequestSchema,
  hostCorrectPlayerLifeRequestSchema,
  hostLobbyViewSchema,
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
  });

  it("accepts records for every extended role action", () => {
    for (const type of ["guard-action", "hunter-shot", "idiot-reveal"] as const) {
      expect(gameRecordSchema.parse({ type, day: 1, detail: `${type} detail` }).type).toBe(type);
    }
  });
});
