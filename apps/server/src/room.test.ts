import { describe, expect, it } from "vitest";
import type { RoleConfigurationInput } from "@werewolf/shared";
import { LobbyRoom } from "./room.js";
import type { RoomChatPersistence } from "./room.js";

const token = "abcdefghijklmnopqrstuvwxyz123456";

function createRoom(
  deferCompletedStages = false,
  chatPersistence?: RoomChatPersistence
) {
  return new LobbyRoom({
    localAddress: "192.168.1.20",
    webPort: 5173,
    roomCode: "123456",
    joinToken: token,
    deferCompletedStages,
    ...(chatPersistence ? { chatPersistence } : {})
  });
}

function startConfiguredRoom(configuration: RoleConfigurationInput, nicknames: string[]) {
  const room = createRoom();
  const sessions = nicknames.map((nickname, index) =>
    room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-new-role-${index}`)
  );
  if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
  room.updateRoleConfiguration(configuration);
  const started = room.startGame();
  if (!started.ok) throw new Error("test setup failed");
  for (const session of sessions) {
    if (!session.ok) throw new Error("test setup failed");
    room.confirmRole(session.data.lobby.selfId);
  }
  const views = sessions.map((session) => {
    if (!session.ok) throw new Error("test setup failed");
    return room.getPlayerView(session.data.lobby.selfId)!;
  });
  return { room, views };
}

describe("lobby room", () => {
  it("joins players, assigns stable numbers, and exposes public fields only", () => {
    const room = createRoom();
    const first = room.join({ roomCode: "123456", joinToken: token, nickname: "林野" }, "socket-a");
    const second = room.join({ roomCode: "123456", joinToken: token, nickname: "阿岚" }, "socket-b");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(room.getHostView().players).toEqual([
      expect.objectContaining({ number: 1, nickname: "林野", connection: "online" }),
      expect.objectContaining({ number: 2, nickname: "阿岚", connection: "online" })
    ]);
    expect(JSON.stringify(room.getHostView())).not.toContain("socket-a");
  });

  it("rejects stale credentials and duplicate nicknames", () => {
    const room = createRoom();
    expect(room.join({ roomCode: "123456", joinToken: `${token}x`, nickname: "林野" }, "socket-a")).toMatchObject({
      ok: false,
      code: "INVALID_JOIN_CREDENTIALS"
    });

    room.join({ roomCode: "123456", joinToken: token, nickname: "林野" }, "socket-a");
    expect(room.join({ roomCode: "123456", joinToken: token, nickname: "林野" }, "socket-b")).toMatchObject({
      ok: false,
      code: "NICKNAME_TAKEN"
    });
  });

  it("invalidates the previous QR token after refresh", () => {
    const room = createRoom();
    const oldUrl = room.getJoinUrl();
    const nextView = room.refreshJoinToken();

    expect(nextView.joinUrl).not.toBe(oldUrl);
    expect(room.join({ roomCode: "123456", joinToken: token, nickname: "林野" }, "socket-a")).toMatchObject({
      ok: false,
      code: "INVALID_JOIN_CREDENTIALS"
    });
  });

  it("reorders, renumbers, removes, and marks players offline", () => {
    const room = createRoom();
    const first = room.join({ roomCode: "123456", joinToken: token, nickname: "林野" }, "socket-a");
    const second = room.join({ roomCode: "123456", joinToken: token, nickname: "阿岚" }, "socket-b");
    if (!first.ok || !second.ok) throw new Error("test setup failed");

    room.movePlayer(second.data.lobby.selfId, "up");
    expect(room.getHostView().players.map((player) => `${player.number}:${player.nickname}`)).toEqual(["1:阿岚", "2:林野"]);

    const reconnectingPlayer = room.setReconnecting("socket-b");
    expect(reconnectingPlayer).toBe(second.data.lobby.selfId);
    room.setOffline(second.data.lobby.selfId, "socket-b");
    expect(room.getHostView().players[0]?.connection).toBe("offline");

    room.removePlayer(second.data.lobby.selfId);
    expect(room.getHostView().players).toEqual([expect.objectContaining({ number: 1, nickname: "林野" })]);
  });

  it("restores the same player with a valid token and rejects an invalid token", () => {
    const room = createRoom();
    const joined = room.join({ roomCode: "123456", joinToken: token, nickname: "林野" }, "socket-a");
    if (!joined.ok) throw new Error("test setup failed");

    room.setReconnecting("socket-a");
    room.setOffline(joined.data.lobby.selfId, "socket-a");
    expect(room.reconnect({ ...joined.data.credentials, reconnectToken: `${token}x` }, "socket-b")).toMatchObject({
      ok: false,
      code: "INVALID_RECONNECT_CREDENTIALS"
    });

    const restored = room.reconnect(joined.data.credentials, "socket-b");
    expect(restored).toMatchObject({
      ok: true,
      data: { session: { lobby: { selfId: joined.data.lobby.selfId } } }
    });
    expect(room.getHostView().players).toHaveLength(1);
    expect(JSON.stringify(room.getHostView())).not.toContain(joined.data.credentials.reconnectToken);
  });

  it("prevents one socket from binding or taking over multiple player seats", () => {
    const room = createRoom();
    const first = room.join({ roomCode: "123456", joinToken: token, nickname: "林野" }, "socket-a");
    const second = room.join({ roomCode: "123456", joinToken: token, nickname: "阿岚" }, "socket-b");
    if (!first.ok || !second.ok) throw new Error("test setup failed");

    expect(room.reconnect(second.data.credentials, "socket-a")).toMatchObject({
      ok: false,
      code: "ALREADY_JOINED"
    });
    expect(room.requestTakeover(
      { roomCode: "123456", joinToken: token, nickname: "阿岚" },
      "socket-a"
    )).toMatchObject({
      ok: false,
      code: "ALREADY_JOINED"
    });
    expect(room.setReconnecting("socket-a")).toBe(first.data.lobby.selfId);
  });

  it("requires host approval for takeover and invalidates the old credential", () => {
    const room = createRoom();
    const joined = room.join({ roomCode: "123456", joinToken: token, nickname: "林野" }, "socket-a");
    if (!joined.ok) throw new Error("test setup failed");

    const requested = room.requestTakeover(
      { roomCode: "123456", joinToken: token, nickname: "林野" },
      "socket-b",
      new Date("2026-07-15T08:00:00.000Z")
    );
    if (!requested.ok) throw new Error("test setup failed");
    expect(room.getHostView().takeoverRequests).toEqual([
      expect.objectContaining({ nickname: "林野", requestedAt: "2026-07-15T08:00:00.000Z" })
    ]);

    const resolved = room.resolveTakeover(requested.data.requestId, true);
    expect(resolved).toMatchObject({ ok: true, data: { approved: true, replacedSocketId: "socket-a" } });
    expect(room.reconnect(joined.data.credentials, "socket-c")).toMatchObject({
      ok: false,
      code: "INVALID_RECONNECT_CREDENTIALS"
    });
  });

  it("persists the approved takeover credential through snapshot restore", () => {
    const room = createRoom();
    const joined = room.join({ roomCode: "123456", joinToken: token, nickname: "林野" }, "socket-a");
    if (!joined.ok) throw new Error("test setup failed");
    const requested = room.requestTakeover(
      { roomCode: "123456", joinToken: token, nickname: "林野" },
      "socket-b"
    );
    if (!requested.ok) throw new Error("test setup failed");
    const resolved = room.resolveTakeover(requested.data.requestId, true);
    if (!resolved.ok || !resolved.data.session) throw new Error("test setup failed");

    const restoredRoom = new LobbyRoom({
      localAddress: "192.168.1.20",
      webPort: 5173,
      snapshot: room.createSnapshot()
    });
    expect(restoredRoom.reconnect(resolved.data.session.credentials, "socket-restored")).toMatchObject({
      ok: true,
      data: { session: { lobby: { selfId: joined.data.lobby.selfId } } }
    });
  });

  it("marks a player departed without deleting or renumbering the roster", () => {
    const room = createRoom();
    const first = room.join({ roomCode: "123456", joinToken: token, nickname: "林野" }, "socket-a");
    const second = room.join({ roomCode: "123456", joinToken: token, nickname: "阿岚" }, "socket-b");
    const third = room.join({ roomCode: "123456", joinToken: token, nickname: "青禾" }, "socket-c");
    if (!first.ok || !second.ok || !third.ok) throw new Error("test setup failed");

    const departed = room.markPlayerDeparted(second.data.lobby.selfId);

    expect(departed).toMatchObject({
      ok: true,
      data: {
        player: { number: 2, nickname: "阿岚", connection: "departed" },
        socketId: "socket-b"
      }
    });
    expect(room.getHostView().players.map((player) => ({
      number: player.number,
      nickname: player.nickname,
      connection: player.connection
    }))).toEqual([
      { number: 1, nickname: "林野", connection: "online" },
      { number: 2, nickname: "阿岚", connection: "departed" },
      { number: 3, nickname: "青禾", connection: "online" }
    ]);
    expect(room.reconnect(second.data.credentials, "socket-d")).toMatchObject({
      ok: false,
      code: "INVALID_RECONNECT_CREDENTIALS"
    });
    expect(room.setReconnecting("socket-b")).toBeNull();
    expect(room.markPlayerDeparted(second.data.lobby.selfId)).toMatchObject({
      ok: false,
      code: "PLAYER_ALREADY_DEPARTED"
    });
  });

  it("cancels pending takeover requests when a player departs", () => {
    const room = createRoom();
    const joined = room.join({ roomCode: "123456", joinToken: token, nickname: "林野" }, "socket-a");
    if (!joined.ok) throw new Error("test setup failed");
    const requested = room.requestTakeover(
      { roomCode: "123456", joinToken: token, nickname: "林野" },
      "socket-b"
    );
    if (!requested.ok) throw new Error("test setup failed");

    const departed = room.markPlayerDeparted(joined.data.lobby.selfId);

    expect(departed).toMatchObject({ ok: true, data: { takeoverSocketIds: ["socket-b"] } });
    expect(room.getHostView().takeoverRequests).toEqual([]);
    expect(room.resolveTakeover(requested.data.requestId, true)).toMatchObject({
      ok: false,
      code: "TAKEOVER_REQUEST_NOT_FOUND"
    });
    expect(room.requestTakeover(
      { roomCode: "123456", joinToken: token, nickname: "林野" },
      "socket-c"
    )).toMatchObject({ ok: false, code: "PLAYER_NOT_FOUND" });
  });

  it("stores role configuration and derives readiness from non-departed players", () => {
    const room = createRoom();
    const first = room.join({ roomCode: "123456", joinToken: token, nickname: "林野" }, "socket-a");
    const second = room.join({ roomCode: "123456", joinToken: token, nickname: "阿岚" }, "socket-b");
    const third = room.join({ roomCode: "123456", joinToken: token, nickname: "青禾" }, "socket-c");
    if (!first.ok || !second.ok || !third.ok) throw new Error("test setup failed");

    const configured = room.updateRoleConfiguration({ wolf: 1, villager: 1, seer: 1, witch: 0 });
    expect(configured).toMatchObject({
      ok: true,
      data: {
        roleConfiguration: { wolf: 1, villager: 1, seer: 1, witch: 0 },
        startReadiness: { ready: true, participantCount: 3, configuredRoleCount: 3 }
      }
    });

    room.markPlayerDeparted(third.data.lobby.selfId);
    expect(room.getHostView().startReadiness).toMatchObject({
      ready: false,
      participantCount: 2,
      configuredRoleCount: 3,
      issues: [expect.objectContaining({ code: "ROLE_TOTAL_MISMATCH" })]
    });
    expect(room.getPlayerView(first.data.lobby.selfId)).not.toHaveProperty("roleConfiguration");
    expect(room.getPlayerView(first.data.lobby.selfId)).not.toHaveProperty("startReadiness");
  });

  it("starts atomically, assigns exact private roles, and closes the lobby", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾", "南星"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 2, villager: 1, seer: 1, witch: 0 });

    const started = room.startGame();
    expect(started).toMatchObject({
      ok: true,
      data: { phase: "role-reveal", roleConfirmation: { confirmed: 0, total: 4 } }
    });
    expect(JSON.stringify(started)).not.toMatch(/privateRole|wolfTeammates|"role":"/);

    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return room.getPlayerView(session.data.lobby.selfId)!;
    });
    expect(views.map((view) => view.privateRole?.role).sort()).toEqual(["seer", "villager", "wolf", "wolf"]);
    for (const view of views) {
      if (view.privateRole?.role === "wolf") {
        expect(view.privateRole.wolfTeammates).toHaveLength(1);
        expect(view.privateRole.wolfTeammates[0]?.id).not.toBe(view.selfId);
      } else {
        expect(view.privateRole?.wolfTeammates).toEqual([]);
        expect(JSON.stringify(view)).not.toContain('"role":"wolf"');
      }
    }

    expect(room.join({ roomCode: "123456", joinToken: token, nickname: "迟到" }, "late")).toMatchObject({
      ok: false,
      code: "GAME_ALREADY_STARTED"
    });
    expect(room.updateRoleConfiguration({ wolf: 1, villager: 2, seer: 1, witch: 0 })).toMatchObject({
      ok: false,
      code: "GAME_ALREADY_STARTED"
    });
  });

  it("restores private identity and enters first night after all confirmations", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 1, villager: 1, seer: 1, witch: 0 });
    room.startGame();
    const first = sessions[0]!;
    if (!first.ok) throw new Error("test setup failed");
    const assignedRole = room.getPlayerView(first.data.lobby.selfId)?.privateRole?.role;

    room.setReconnecting("socket-0");
    room.setOffline(first.data.lobby.selfId, "socket-0");
    const restored = room.reconnect(first.data.credentials, "restored-socket");
    expect(restored).toMatchObject({
      ok: true,
      data: { session: { lobby: { phase: "role-reveal", privateRole: { role: assignedRole } } } }
    });

    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      expect(room.confirmRole(session.data.lobby.selfId)).toMatchObject({ ok: true });
    }
    expect(room.getHostView()).toMatchObject({
      phase: "first-night",
      roleConfirmation: { confirmed: 3, total: 3 }
    });
    expect(room.confirmRole(first.data.lobby.selfId)).toMatchObject({
      ok: false,
      code: "INVALID_JOIN_CREDENTIALS"
    });
  });

  it("lets only wolves select and lock legal first-night targets", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾", "南星"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 2, villager: 1, seer: 1, witch: 0 });
    room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      room.confirmRole(session.data.lobby.selfId);
    }

    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolves = views.filter((view) => view.privateRole?.role === "wolf");
    const nonWolf = views.find((view) => view.privateRole?.role !== "wolf")!;
    expect(wolves).toHaveLength(2);
    expect(nonWolf.wolfAction).toBeNull();
    expect(JSON.stringify(room.getHostView())).not.toMatch(/wolfAction|seerAction|witchAction|"target"|"candidates"/);

    expect(room.selectWolfTarget(nonWolf.selfId, "no-kill")).toMatchObject({
      ok: false,
      code: "INVALID_NIGHT_ACTION"
    });
    expect(room.selectWolfTarget(wolves[0]!.selfId, wolves[0]!.selfId)).toMatchObject({
      ok: true,
      data: { wolfAction: { target: wolves[0]!.selfId, confirmed: false } }
    });
    expect(room.confirmWolfVote(wolves[0]!.selfId, true)).toMatchObject({
      ok: true,
      data: { wolfAction: { confirmed: true, locked: false } }
    });
    expect(room.confirmWolfVote(wolves[0]!.selfId, false)).toMatchObject({ ok: true });
    room.selectWolfTarget(wolves[0]!.selfId, "no-kill");
    room.confirmWolfVote(wolves[0]!.selfId, true);
    room.selectWolfTarget(wolves[1]!.selfId, wolves[0]!.selfId);
    expect(room.confirmWolfVote(wolves[1]!.selfId, true)).toMatchObject({
      ok: true,
      data: { wolfAction: { locked: true } }
    });
    expect(room.getHostView().nightProgress).toEqual({
      stage: "night-action",
      confirmed: 0,
      required: 0,
      locked: false
    });
    expect(room.selectWolfTarget(wolves[0]!.selfId, null)).toMatchObject({
      ok: false,
      code: "INVALID_NIGHT_ACTION"
    });
  });

  it("advances through seer and lets the witch self-save on the first night", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾", "南星", "石川"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 1, villager: 2, seer: 1, witch: 1 });
    room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      room.confirmRole(session.data.lobby.selfId);
    }
    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const seer = views.find((view) => view.privateRole?.role === "seer")!;
    const witch = views.find((view) => view.privateRole?.role === "witch")!;

    room.selectWolfTarget(wolf.selfId, witch.selfId);
    room.confirmWolfVote(wolf.selfId, true);
    expect(room.getPlayerView(seer.selfId)?.seerAction).toMatchObject({ active: true, result: null });
    expect(room.inspectAsSeer(seer.selfId, seer.selfId)).toMatchObject({
      ok: false,
      code: "INVALID_NIGHT_ACTION"
    });
    expect(room.inspectAsSeer(seer.selfId, wolf.selfId)).toMatchObject({
      ok: true,
      data: { seerAction: { inspectedPlayer: { id: wolf.selfId }, result: "wolf" } }
    });
    expect(room.getPlayerView(witch.selfId)?.witchAction).toMatchObject({
      active: true,
      attackedPlayer: { id: witch.selfId },
      antidoteAvailable: true,
      poisonAvailable: true
    });
    expect(room.submitWitchAction(witch.selfId, { action: "save" })).toMatchObject({
      ok: true,
      data: { phase: "dawn", dawnResult: { deaths: [] } }
    });
    expect(room.getHostView()).toMatchObject({ phase: "dawn", dawnResult: { deaths: [] } });
    expect(JSON.stringify(room.getHostView())).not.toMatch(/attackedPlayer|antidote|poison|inspectedPlayer|result.*wolf/);
  });

  it("settles wolf attack and witch poison together without exposing causes", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾", "南星", "石川"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 1, villager: 2, seer: 1, witch: 1 });
    room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      room.confirmRole(session.data.lobby.selfId);
    }
    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const seer = views.find((view) => view.privateRole?.role === "seer")!;
    const witch = views.find((view) => view.privateRole?.role === "witch")!;
    const villagers = views.filter((view) => view.privateRole?.role === "villager");

    room.selectWolfTarget(wolf.selfId, villagers[0]!.selfId);
    room.confirmWolfVote(wolf.selfId, true);
    room.inspectAsSeer(seer.selfId, wolf.selfId);
    expect(room.submitWitchAction(witch.selfId, { action: "poison", target: witch.selfId })).toMatchObject({
      ok: false,
      code: "INVALID_NIGHT_ACTION"
    });
    room.submitWitchAction(witch.selfId, { action: "poison", target: villagers[1]!.selfId });

    const dawn = room.getHostView();
    expect(dawn.phase).toBe("game-over");
    expect(dawn.gameResult?.outcome).toBe("wolf-win");
    expect(dawn.gameResult?.revealedPlayers.filter((player) => !player.alive).map((player) => player.id).sort()).toEqual(
      [villagers[0]!.selfId, villagers[1]!.selfId].sort()
    );
    expect(JSON.stringify(dawn)).not.toMatch(/wolfAttack|poisonTarget|deathCause/);
  });

  it("lets the guard block a wolf attack, empty-protect, and not protect the same player consecutively", () => {
    const { room, views } = startConfiguredRoom(
      { wolf: 1, villager: 2, seer: 0, witch: 0, guard: 1 },
      ["林野", "阿岚", "青禾", "南星"]
    );
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const guard = views.find((view) => view.privateRole?.role === "guard")!;
    const victim = views.find((view) => view.privateRole?.role === "villager")!;

    room.selectWolfTarget(wolf.selfId, victim.selfId);
    room.confirmWolfVote(wolf.selfId, true);
    expect(room.getNightStage()).toBe("guard");
    expect(room.protectAsGuard(guard.selfId, victim.selfId)).toMatchObject({
      ok: true,
      data: { phase: "dawn", dawnResult: { deaths: [] } }
    });
    expect(JSON.stringify(room.getHostView())).not.toContain("protectedPlayer");

    room.continueFromDawn();
    while (room.getHostView().phase === "day-speech") room.skipCurrentDayStage();
    room.skipCurrentDayStage();
    room.continueFromExile();
    room.selectWolfTarget(wolf.selfId, "no-kill");
    room.confirmWolfVote(wolf.selfId, true);

    expect(room.getPlayerView(guard.selfId)?.guardAction?.candidates.map((candidate) => candidate.id))
      .not.toContain(victim.selfId);
    expect(room.protectAsGuard(guard.selfId, victim.selfId)).toMatchObject({
      ok: false,
      code: "INVALID_NIGHT_ACTION"
    });
    expect(room.protectAsGuard(guard.selfId, null)).toMatchObject({
      ok: true,
      data: { phase: "dawn", dawnResult: { deaths: [] } }
    });
  });

  it("waits for a wolf-killed hunter to shoot before evaluating the winner", () => {
    const { room, views } = startConfiguredRoom(
      { wolf: 1, villager: 2, seer: 0, witch: 0, hunter: 1 },
      ["林野", "阿岚", "青禾", "南星"]
    );
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const hunter = views.find((view) => view.privateRole?.role === "hunter")!;

    room.selectWolfTarget(wolf.selfId, hunter.selfId);
    room.confirmWolfVote(wolf.selfId, true);

    expect(room.getHostView()).toMatchObject({
      phase: "dawn",
      dayState: { hunterPending: true },
      gameResult: null
    });
    expect(room.continueFromDawn()).toMatchObject({ ok: false, code: "INVALID_PHASE_CONTROL" });
    expect(room.getPlayerView(hunter.selfId)?.hunterAction).toMatchObject({ active: true, submitted: false });
    expect(room.shootAsHunter(hunter.selfId, wolf.selfId)).toMatchObject({
      ok: true,
      data: { phase: "game-over", gameResult: { outcome: "draw" } }
    });
  });

  it("does not let a poisoned hunter shoot", () => {
    const { room, views } = startConfiguredRoom(
      { wolf: 1, villager: 2, seer: 0, witch: 1, hunter: 1 },
      ["林野", "阿岚", "青禾", "南星", "石川"]
    );
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const witch = views.find((view) => view.privateRole?.role === "witch")!;
    const hunter = views.find((view) => view.privateRole?.role === "hunter")!;
    const victim = views.find((view) => view.privateRole?.role === "villager")!;

    room.selectWolfTarget(wolf.selfId, victim.selfId);
    room.confirmWolfVote(wolf.selfId, true);
    room.submitWitchAction(witch.selfId, { action: "poison", target: hunter.selfId });

    expect(room.getHostView()).toMatchObject({
      phase: "dawn",
      dayState: { hunterPending: false }
    });
    expect(room.getPlayerView(hunter.selfId)?.hunterAction?.active).toBe(false);
    expect(room.shootAsHunter(hunter.selfId, wolf.selfId)).toMatchObject({
      ok: false,
      code: "INVALID_NIGHT_ACTION"
    });
  });

  it("lets an exiled hunter shoot before resolving the winner", () => {
    const { room, views } = startConfiguredRoom(
      { wolf: 1, villager: 2, seer: 0, witch: 0, guard: 1, hunter: 1 },
      ["林野", "阿岚", "青禾", "南星", "石川"]
    );
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const guard = views.find((view) => view.privateRole?.role === "guard")!;
    const hunter = views.find((view) => view.privateRole?.role === "hunter")!;

    room.selectWolfTarget(wolf.selfId, "no-kill");
    room.confirmWolfVote(wolf.selfId, true);
    room.protectAsGuard(guard.selfId, null);
    room.continueFromDawn();
    while (room.getHostView().phase === "day-speech") room.skipCurrentDayStage();
    for (const voterId of room.getHostView().dayState!.alivePlayerIds) {
      room.selectDayVote(voterId, voterId === hunter.selfId ? "abstain" : hunter.selfId);
      room.confirmDayVote(voterId, true);
    }

    expect(room.getHostView()).toMatchObject({
      phase: "exile-result",
      dayState: { hunterPending: true, voteResult: { exiledPlayer: { id: hunter.selfId } } },
      gameResult: null
    });
    expect(room.continueFromExile()).toMatchObject({ ok: false, code: "INVALID_PHASE_CONTROL" });
    expect(room.shootAsHunter(hunter.selfId, wolf.selfId)).toMatchObject({
      ok: true,
      data: { phase: "game-over", gameResult: { outcome: "good-win" } }
    });
  });

  it("reveals an exiled idiot, preserves the reveal, and removes their vote", () => {
    const { room, views } = startConfiguredRoom(
      { wolf: 1, villager: 2, seer: 0, witch: 0, idiot: 1 },
      ["林野", "阿岚", "青禾", "南星"]
    );
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const idiot = views.find((view) => view.privateRole?.role === "idiot")!;

    room.selectWolfTarget(wolf.selfId, "no-kill");
    room.confirmWolfVote(wolf.selfId, true);
    room.continueFromDawn();
    while (room.getHostView().phase === "day-speech") room.skipCurrentDayStage();
    for (const voterId of room.getHostView().dayState!.alivePlayerIds) {
      room.selectDayVote(voterId, voterId === idiot.selfId ? "abstain" : idiot.selfId);
      room.confirmDayVote(voterId, true);
    }

    expect(room.getHostView()).toMatchObject({
      phase: "exile-result",
      revealedIdiotId: idiot.selfId,
      dayState: {
        revealedIdiot: { id: idiot.selfId },
        voteResult: { exiledPlayer: null }
      }
    });
    expect(room.getHostView().players.find((player) => player.id === idiot.selfId)?.alive).toBe(true);
    const idiotNickname = room.getHostView().players.find((player) => player.id === idiot.selfId)!.nickname;
    expect(room.createSnapshot().gameRecords).not.toContainEqual(expect.objectContaining({
      type: "death",
      detail: expect.stringContaining(idiotNickname)
    }));

    room.continueFromExile();
    room.selectWolfTarget(wolf.selfId, "no-kill");
    room.confirmWolfVote(wolf.selfId, true);
    room.continueFromDawn();
    while (room.getHostView().phase === "day-speech") room.skipCurrentDayStage();

    expect(room.getPlayerView(idiot.selfId)?.dayVote).toMatchObject({ eligible: false, candidates: [] });
    const otherVoter = room.getHostView().dayState!.alivePlayerIds.find((id) => id !== idiot.selfId)!;
    expect(room.getPlayerView(otherVoter)?.dayVote?.candidates.map((candidate) => candidate.id))
      .not.toContain(idiot.selfId);
    expect(room.selectDayVote(idiot.selfId, "abstain")).toMatchObject({ ok: false });
    expect(room.selectDayVote(otherVoter, idiot.selfId)).toMatchObject({ ok: false, code: "PLAYER_NOT_FOUND" });

    const restored = new LobbyRoom({
      localAddress: "192.168.1.20",
      webPort: 5173,
      snapshot: room.createSnapshot()
    });
    expect(restored.getHostView().revealedIdiotId).toBe(idiot.selfId);
    expect(restored.getPlayerView(idiot.selfId)?.dayVote).toMatchObject({ eligible: false, candidates: [] });
  });

  it("treats tied wolf votes as no attack before witch action", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾", "南星", "石川"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 2, villager: 1, seer: 1, witch: 1 });
    room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      room.confirmRole(session.data.lobby.selfId);
    }
    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolves = views.filter((view) => view.privateRole?.role === "wolf");
    const seer = views.find((view) => view.privateRole?.role === "seer")!;
    const witch = views.find((view) => view.privateRole?.role === "witch")!;
    const villager = views.find((view) => view.privateRole?.role === "villager")!;

    room.selectWolfTarget(wolves[0]!.selfId, villager.selfId);
    room.confirmWolfVote(wolves[0]!.selfId, true);
    room.selectWolfTarget(wolves[1]!.selfId, "no-kill");
    room.confirmWolfVote(wolves[1]!.selfId, true);
    room.inspectAsSeer(seer.selfId, wolves[0]!.selfId);
    expect(room.getPlayerView(witch.selfId)?.witchAction?.attackedPlayer).toBeNull();
    expect(room.submitWitchAction(witch.selfId, { action: "save" })).toMatchObject({
      ok: false,
      code: "INVALID_NIGHT_ACTION"
    });
    room.submitWitchAction(witch.selfId, { action: "none" });
    expect(room.getHostView().dawnResult).toEqual({ deaths: [] });
  });

  it("keeps rate-limited wolf chat private and restores it on reconnect", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾", "南星"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 2, villager: 1, seer: 1, witch: 0 });
    room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      room.confirmRole(session.data.lobby.selfId);
    }
    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolves = views.filter((view) => view.privateRole?.role === "wolf");
    const nonWolf = views.find((view) => view.privateRole?.role !== "wolf")!;
    const firstWolfSession = sessions.find((session) => session.ok && session.data.lobby.selfId === wolves[0]!.selfId)!;
    if (!firstWolfSession.ok) throw new Error("test setup failed");

    expect(room.sendWolfMessage(nonWolf.selfId, { kind: "text", text: "越权消息" })).toMatchObject({
      ok: false,
      code: "INVALID_NIGHT_ACTION"
    });
    expect(room.sendWolfMessage(
      wolves[0]!.selfId,
      { kind: "text", text: "先观察票型" },
      new Date("2026-07-15T12:00:00.000Z")
    )).toMatchObject({ ok: true, data: { wolfAction: { messages: [
      expect.objectContaining({ content: { kind: "text", text: "先观察票型" } })
    ] } } });
    expect(room.sendWolfMessage(
      wolves[0]!.selfId,
      { kind: "quick", code: "agree" },
      new Date("2026-07-15T12:00:00.500Z")
    )).toMatchObject({ ok: false, code: "CHAT_RATE_LIMITED" });
    const suggestion = room.sendWolfMessage(
      wolves[1]!.selfId,
      { kind: "target-suggestion", target: nonWolf.selfId },
      new Date("2026-07-15T12:00:00.500Z")
    );
    expect(suggestion).toMatchObject({ ok: true });
    if (!suggestion.ok) throw new Error("test setup failed");
    expect(suggestion.data.wolfAction?.messages).toContainEqual(expect.objectContaining({
      content: expect.objectContaining({
        kind: "target-suggestion",
        target: expect.objectContaining({ id: nonWolf.selfId })
      })
    }));
    expect(JSON.stringify(room.getHostView())).not.toContain("先观察票型");
    expect(JSON.stringify(room.getPlayerView(nonWolf.selfId))).not.toContain("先观察票型");

    room.setReconnecting("socket-0");
    room.setOffline(firstWolfSession.data.lobby.selfId, "socket-0");
    const restored = room.reconnect(firstWolfSession.data.credentials, "restored-wolf");
    expect(restored).toMatchObject({ ok: true });
    if (!restored.ok) throw new Error("test setup failed");
    expect(restored.data.session.lobby.wolfAction?.messages).toContainEqual(expect.objectContaining({
      content: { kind: "text", text: "先观察票型" }
    }));

    room.selectWolfTarget(wolves[0]!.selfId, "no-kill");
    room.confirmWolfVote(wolves[0]!.selfId, true);
    room.selectWolfTarget(wolves[1]!.selfId, "no-kill");
    room.confirmWolfVote(wolves[1]!.selfId, true);
    expect(room.sendWolfMessage(
      wolves[0]!.selfId,
      { kind: "quick", code: "agree" },
      new Date("2026-07-15T12:00:02.000Z")
    )).toMatchObject({ ok: false, code: "INVALID_NIGHT_ACTION" });
  });

  it("increments chat sequence only for accepted messages and rate-limits each sender", () => {
    const { room, views } = startConfiguredRoom(
      { wolf: 2, villager: 1, seer: 1, witch: 0 },
      ["林野", "阿岚", "青禾", "南星"]
    );
    const wolves = views.filter((view) => view.privateRole?.role === "wolf");
    expect(wolves).toHaveLength(2);

    const first = room.sendChat(
      wolves[0]!.selfId,
      { channel: "wolf-private", content: { kind: "text", text: "第一条" } },
      new Date("2026-07-15T12:00:00.000Z")
    );
    const rateLimited = room.sendChat(
      wolves[0]!.selfId,
      { channel: "wolf-private", content: { kind: "quick", code: "agree" } },
      new Date("2026-07-15T12:00:00.999Z")
    );
    const second = room.sendChat(
      wolves[1]!.selfId,
      { channel: "wolf-private", content: { kind: "text", text: "第二条" } },
      new Date("2026-07-15T12:00:00.999Z")
    );
    const third = room.sendChat(
      wolves[0]!.selfId,
      { channel: "wolf-private", content: { kind: "quick", code: "agree" } },
      new Date("2026-07-15T12:00:01.000Z")
    );

    expect(first).toMatchObject({ ok: true, data: { sequence: 1 } });
    expect(rateLimited).toMatchObject({ ok: false, code: "CHAT_RATE_LIMITED" });
    expect(second).toMatchObject({ ok: true, data: { sequence: 2 } });
    expect(third).toMatchObject({ ok: true, data: { sequence: 3 } });
    expect(room.getPlayerView(wolves[0]!.selfId)?.wolfAction?.messages.map((message) => message.sequence))
      .toEqual([1, 2, 3]);
  });

  it("does not advance chat sequence or commit memory when persistence fails", () => {
    let rejectAppend = true;
    const persistedMessages: Parameters<RoomChatPersistence["appendMessage"]>[1][] = [];
    const chatPersistence: RoomChatPersistence = {
      createSession: () => undefined,
      finishSession: () => undefined,
      appendMessage: (_sessionId, message) => {
        if (rejectAppend) throw new Error("database unavailable");
        persistedMessages.push(message);
      },
      importMessages: () => undefined,
      loadRecentForRecovery: () => [],
      queryAfter: (_sessionId, _reader, afterSequence) => ({
        messages: persistedMessages.filter((message) => message.sequence > afterSequence),
        latestSequence: persistedMessages.at(-1)?.sequence ?? afterSequence,
        hasMore: false
      })
    };
    const room = createRoom(false, chatPersistence);
    const sessions = ["林野", "阿岚", "青禾"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-persist-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 1, villager: 1, seer: 1, witch: 0 });
    room.startGame();
    const wolf = sessions
      .map((session) => {
        if (!session.ok) throw new Error("test setup failed");
        room.confirmRole(session.data.lobby.selfId);
        return room.getPlayerView(session.data.lobby.selfId)!;
      })
      .find((view) => view.privateRole?.role === "wolf")!;

    expect(() => room.sendChat(
      wolf.selfId,
      { channel: "wolf-private", content: { kind: "text", text: "不应提交" } },
      new Date("2026-07-19T08:00:00.000Z")
    )).toThrow("database unavailable");
    expect(room.getPlayerView(wolf.selfId)?.wolfAction?.messages).toEqual([]);
    expect(persistedMessages).toEqual([]);

    rejectAppend = false;
    expect(room.sendChat(
      wolf.selfId,
      { channel: "wolf-private", content: { kind: "text", text: "持久化成功" } },
      new Date("2026-07-19T08:00:00.000Z")
    )).toMatchObject({
      ok: true,
      data: {
        sequence: 1,
        content: { kind: "text", text: "持久化成功" }
      }
    });
    expect(persistedMessages).toHaveLength(1);
    expect(room.getPlayerView(wolf.selfId)?.wolfAction?.messages).toEqual([
      expect.objectContaining({
        sequence: 1,
        content: { kind: "text", text: "持久化成功" }
      })
    ]);
  });

  it("allows a dead player to send public chat only during their own last words", () => {
    const { room, views } = startConfiguredRoom(
      { wolf: 1, villager: 2, seer: 1, witch: 1 },
      ["林野", "阿岚", "青禾", "南星", "石川"]
    );
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const seer = views.find((view) => view.privateRole?.role === "seer")!;
    const witch = views.find((view) => view.privateRole?.role === "witch")!;
    const victim = views.find((view) => view.privateRole?.role === "villager")!;

    room.selectWolfTarget(wolf.selfId, victim.selfId);
    room.confirmWolfVote(wolf.selfId, true);
    room.inspectAsSeer(seer.selfId, wolf.selfId);
    room.submitWitchAction(witch.selfId, { action: "none" });
    expect(room.getHostView()).toMatchObject({
      phase: "dawn",
      players: expect.arrayContaining([expect.objectContaining({ id: victim.selfId, alive: false })])
    });
    expect(room.sendChat(
      victim.selfId,
      { channel: "day-public", content: { kind: "text", text: "黎明阶段不能发言" } },
      new Date("2026-07-15T12:00:00.000Z")
    )).toMatchObject({ ok: false, code: "INVALID_PHASE_CONTROL" });

    expect(room.continueFromDawn()).toMatchObject({
      ok: true,
      data: { phase: "last-words", dayState: { currentSpeaker: { id: victim.selfId } } }
    });
    expect(room.getPlayerView(victim.selfId)?.publicChat.canSend).toBe(true);
    expect(room.sendChat(
      wolf.selfId,
      { channel: "day-public", content: { kind: "text", text: "插话" } },
      new Date("2026-07-15T12:00:01.000Z")
    )).toMatchObject({ ok: false, code: "INVALID_PHASE_CONTROL" });
    expect(room.sendChat(
      victim.selfId,
      { channel: "day-public", content: { kind: "text", text: "这是我的遗言" } },
      new Date("2026-07-15T12:00:01.000Z")
    )).toMatchObject({
      ok: true,
      data: {
        phase: "last-words",
        sender: { id: victim.selfId },
        content: { kind: "text", text: "这是我的遗言" }
      }
    });

    expect(room.finishSpeaking(victim.selfId)).toMatchObject({ ok: true });
    expect(room.getPlayerView(victim.selfId)?.publicChat.canSend).toBe(false);
    expect(room.sendChat(
      victim.selfId,
      { channel: "day-public", content: { kind: "text", text: "遗言轮次已经结束" } },
      new Date("2026-07-15T12:00:02.000Z")
    )).toMatchObject({ ok: false, code: "INVALID_PHASE_CONTROL" });

    while (room.getHostView().phase === "day-speech") room.skipCurrentDayStage();
    expect(room.getHostView().phase).toBe("day-vote");
    expect(room.sendChat(
      wolf.selfId,
      { channel: "day-public", content: { kind: "text", text: "投票阶段不能公开聊天" } },
      new Date("2026-07-15T12:00:03.000Z")
    )).toMatchObject({ ok: false, code: "INVALID_PHASE_CONTROL" });
    expect(room.getHostView().publicChat.messages).toContainEqual(expect.objectContaining({
      sender: { kind: "player", id: victim.selfId, number: victim.players.find(
        (player) => player.id === victim.selfId
      )!.number, nickname: victim.players.find((player) => player.id === victim.selfId)!.nickname },
      content: { kind: "text", text: "这是我的遗言" }
    }));
  });

  it("restores public chat history when the current speaker reconnects", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-history-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 1, villager: 1, seer: 0, witch: 0, hunter: 1 });
    room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      room.confirmRole(session.data.lobby.selfId);
    }
    room.skipCurrentNightStage();
    room.continueFromDawn();

    const speakerId = room.getHostView().dayState?.currentSpeaker?.id;
    const speakerIndex = sessions.findIndex(
      (session) => session.ok && session.data.lobby.selfId === speakerId
    );
    const speakerSession = sessions[speakerIndex];
    if (speakerIndex < 0 || !speakerSession?.ok) throw new Error("test setup failed");

    const sent = room.sendChat(
      speakerSession.data.lobby.selfId,
      { channel: "day-public", content: { kind: "text", text: "重连前的公开发言" } },
      new Date("2026-07-15T12:00:00.000Z")
    );
    expect(sent).toMatchObject({ ok: true, data: { sequence: 1 } });
    room.setReconnecting(`socket-history-${speakerIndex}`);
    room.setOffline(speakerSession.data.lobby.selfId, `socket-history-${speakerIndex}`);

    const restored = room.reconnect(speakerSession.data.credentials, "socket-history-restored");
    expect(restored).toMatchObject({
      ok: true,
      data: {
        session: {
          lobby: {
            selfId: speakerSession.data.lobby.selfId,
            publicChat: {
              canSend: true,
              messages: [
                expect.objectContaining({
                  sequence: 1,
                  channel: "day-public",
                  content: { kind: "text", text: "重连前的公开发言" }
                })
              ]
            }
          }
        }
      }
    });
  });

  it("runs first-night last words, day speech, and a private exile vote", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾", "南星", "石川"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 1, villager: 2, seer: 1, witch: 1 });
    room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      room.confirmRole(session.data.lobby.selfId);
    }
    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const seer = views.find((view) => view.privateRole?.role === "seer")!;
    const witch = views.find((view) => view.privateRole?.role === "witch")!;
    const victim = views.find((view) => view.privateRole?.role === "villager")!;
    room.selectWolfTarget(wolf.selfId, victim.selfId);
    room.confirmWolfVote(wolf.selfId, true);
    room.inspectAsSeer(seer.selfId, wolf.selfId);
    room.submitWitchAction(witch.selfId, { action: "none" });

    expect(room.continueFromDawn()).toMatchObject({
      ok: true,
      data: { phase: "last-words", dayState: { currentSpeaker: { id: victim.selfId } } }
    });
    expect(room.finishSpeaking(wolf.selfId)).toMatchObject({ ok: false, code: "INVALID_PHASE_CONTROL" });
    room.finishSpeaking(victim.selfId);
    expect(room.getHostView().phase).toBe("day-speech");
    for (const speaker of room.getHostView().dayState!.speechOrder) {
      expect(room.finishSpeaking(speaker.id)).toMatchObject({ ok: true });
    }
    expect(room.getHostView().phase).toBe("day-vote");
    expect(room.getPlayerView(victim.selfId)?.dayVote).toBeNull();
    expect(room.selectDayVote(victim.selfId, "abstain")).toMatchObject({ ok: false });

    const aliveIds = room.getHostView().dayState!.alivePlayerIds;
    const target = witch.selfId;
    for (const voterId of aliveIds) {
      const choice = voterId === target ? "abstain" : target;
      room.selectDayVote(voterId, choice);
      const privateView = room.getPlayerView(voterId)!;
      expect(privateView.dayVote?.target).toBe(choice);
      expect(JSON.stringify(room.getHostView())).not.toContain(`"target":"${target}"`);
      room.confirmDayVote(voterId, true);
    }
    const result = room.getHostView();
    expect(result.phase).toBe("exile-result");
    expect(result.dayState?.voteResult?.exiledPlayer?.id).toBe(target);
    expect(result.dayState?.voteResult?.ballots).toHaveLength(aliveIds.length);
  });

  it("advances immediately when the current speaker finishes in deferred mode", () => {
    const room = createRoom(true);
    const sessions = ["林野", "阿岚", "青禾"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 1, villager: 1, seer: 1, witch: 0 });
    room.startGame();

    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      room.confirmRole(session.data.lobby.selfId);
      return room.getPlayerView(session.data.lobby.selfId)!;
    });
    room.advanceCompletedTimedStage();

    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const seer = views.find((view) => view.privateRole?.role === "seer")!;
    room.selectWolfTarget(wolf.selfId, "no-kill");
    room.confirmWolfVote(wolf.selfId, true);
    room.advanceCompletedTimedStage();
    room.inspectAsSeer(seer.selfId, wolf.selfId);
    room.advanceCompletedTimedStage();
    room.continueFromDawn();

    const firstStageKey = room.getTimedStageKey();
    const firstSpeakerId = room.getHostView().dayState!.currentSpeaker!.id;
    const result = room.finishSpeaking(firstSpeakerId);

    expect(result).toMatchObject({ ok: true });
    expect(room.getHostView().dayState!.currentSpeaker!.id).not.toBe(firstSpeakerId);
    expect(room.getTimedStageKey()).not.toBe(firstStageKey);
  });

  it("exiles nobody when the highest day vote is tied", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 1, villager: 1, seer: 1, witch: 0 });
    room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      room.confirmRole(session.data.lobby.selfId);
    }
    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const seer = views.find((view) => view.privateRole?.role === "seer")!;
    room.selectWolfTarget(wolf.selfId, "no-kill");
    room.confirmWolfVote(wolf.selfId, true);
    room.inspectAsSeer(seer.selfId, wolf.selfId);
    room.continueFromDawn();
    for (const speaker of room.getHostView().dayState!.speechOrder) room.finishSpeaking(speaker.id);
    const aliveIds = room.getHostView().dayState!.alivePlayerIds;
    const choices = [aliveIds[1]!, aliveIds[0]!, "abstain" as const];
    aliveIds.forEach((voterId, index) => {
      room.selectDayVote(voterId, choices[index]!);
      room.confirmDayVote(voterId, true);
    });
    expect(room.getHostView()).toMatchObject({
      phase: "exile-result",
      dayState: { voteResult: { exiledPlayer: null } }
    });
  });

  it("treats unconfirmed timeout ballots as abstentions and starts the next night", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 1, villager: 1, seer: 1, witch: 0 });
    room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      room.confirmRole(session.data.lobby.selfId);
    }
    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const seer = views.find((view) => view.privateRole?.role === "seer")!;
    room.selectWolfTarget(wolf.selfId, "no-kill");
    room.confirmWolfVote(wolf.selfId, true);
    room.inspectAsSeer(seer.selfId, wolf.selfId);
    room.continueFromDawn();
    while (room.getHostView().phase === "day-speech") room.skipCurrentDayStage();
    const voters = room.getHostView().dayState!.alivePlayerIds;
    room.selectDayVote(voters[0]!, voters[1]!);
    room.confirmDayVote(voters[0]!, true);
    room.selectDayVote(voters[1]!, voters[0]!);

    room.skipCurrentDayStage();

    const result = room.getHostView();
    expect(result.phase).toBe("game-over");
    expect(result.gameResult).not.toBeNull();
    expect(result.gameResult?.revealedPlayers.find((player) => player.id === voters[1]!)?.alive).toBe(false);
  });

  it("ends immediately when wolves are eliminated and reveals roles", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾", "南星"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 1, villager: 2, seer: 1, witch: 0 });
    room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      room.confirmRole(session.data.lobby.selfId);
    }
    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const seer = views.find((view) => view.privateRole?.role === "seer")!;
    room.selectWolfTarget(wolf.selfId, "no-kill");
    room.confirmWolfVote(wolf.selfId, true);
    room.inspectAsSeer(seer.selfId, wolf.selfId);
    room.continueFromDawn();
    for (const speaker of room.getHostView().dayState!.speechOrder) room.finishSpeaking(speaker.id);
    const voters = room.getHostView().dayState!.alivePlayerIds;
    for (const voterId of voters) {
      room.selectDayVote(voterId, voterId === wolf.selfId ? "abstain" : wolf.selfId);
      room.confirmDayVote(voterId, true);
    }

    const result = room.getHostView();
    expect(result.phase).toBe("game-over");
    expect(result.gameResult).toMatchObject({ outcome: "good-win" });
    expect(result.gameResult?.revealedPlayers).toHaveLength(4);
    expect(result.players.find((player) => player.id === wolf.selfId)?.alive).toBe(false);
    expect(room.getPlayerView(wolf.selfId)).toMatchObject({
      wolfAction: null,
      dayVote: null,
      gameResult: { outcome: "good-win" }
    });
  });

  it("returns to lobby or starts a clean rematch after game over", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 1, villager: 1, seer: 1, witch: 0 });
    room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      room.confirmRole(session.data.lobby.selfId);
    }
    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const seer = views.find((view) => view.privateRole?.role === "seer")!;
    room.selectWolfTarget(wolf.selfId, seer.selfId);
    room.confirmWolfVote(wolf.selfId, true);
    room.inspectAsSeer(seer.selfId, wolf.selfId);
    expect(room.getHostView().phase).toBe("game-over");

    expect(room.returnToLobby()).toMatchObject({ ok: true, data: { phase: "lobby", gameResult: null } });
    expect(room.getHostView().players.every((player) => player.alive)).toBe(true);
  });

  it("keeps private actions hidden until game over and clears records for a rematch", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 1, villager: 1, seer: 1, witch: 0 });
    room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      room.confirmRole(session.data.lobby.selfId);
    }
    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const seer = views.find((view) => view.privateRole?.role === "seer")!;
    room.selectWolfTarget(wolf.selfId, "no-kill");
    room.confirmWolfVote(wolf.selfId, true);
    room.inspectAsSeer(seer.selfId, wolf.selfId);

    expect(room.getHostView()).not.toHaveProperty("gameRecords");
    expect(JSON.stringify(room.getHostView())).not.toContain("查验");
    const terminated = room.terminateGame();
    expect(terminated).toMatchObject({
      ok: true,
      data: {
        phase: "game-over",
        gameResult: {
          outcome: "terminated"
        }
      }
    });
    if (!terminated.ok) throw new Error("test setup failed");
    expect(terminated.data.gameResult?.records).toContainEqual(expect.objectContaining({ type: "seer-inspection" }));
    expect(room.playAgain()).toMatchObject({ ok: true, data: { phase: "role-reveal", gameResult: null } });
  });

  it("completes two nights and a tied day before declaring the winner", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾", "南星", "石川"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 1, villager: 2, seer: 1, witch: 1 });
    room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      room.confirmRole(session.data.lobby.selfId);
    }
    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const seer = views.find((view) => view.privateRole?.role === "seer")!;
    const witch = views.find((view) => view.privateRole?.role === "witch")!;
    const villager = views.find((view) => view.privateRole?.role === "villager")!;

    room.selectWolfTarget(wolf.selfId, "no-kill");
    room.confirmWolfVote(wolf.selfId, true);
    room.inspectAsSeer(seer.selfId, wolf.selfId);
    room.submitWitchAction(witch.selfId, { action: "none" });
    expect(room.getHostView()).toMatchObject({ phase: "dawn", dawnResult: { deaths: [] } });

    room.continueFromDawn();
    while (room.getHostView().phase === "day-speech") room.skipCurrentDayStage();
    room.skipCurrentDayStage();
    expect(room.getHostView()).toMatchObject({
      phase: "exile-result",
      dayState: { voteResult: { exiledPlayer: null } }
    });
    room.continueFromExile();

    expect(room.getHostView()).toMatchObject({ phase: "first-night", gameResult: null });
    room.selectWolfTarget(wolf.selfId, wolf.selfId);
    room.confirmWolfVote(wolf.selfId, true);
    room.inspectAsSeer(seer.selfId, villager.selfId);
    room.submitWitchAction(witch.selfId, { action: "none" });

    const result = room.getHostView();
    expect(result).toMatchObject({ phase: "game-over", gameResult: { outcome: "good-win" } });
    expect(result.gameResult?.records).toContainEqual(expect.objectContaining({
      type: "death",
      day: 1,
      detail: "夜间无人死亡"
    }));
    expect(result.gameResult?.records).toContainEqual(expect.objectContaining({
      type: "death",
      day: 2,
      detail: expect.stringContaining("夜间死亡")
    }));
    expect(room.selectWolfTarget(wolf.selfId, "no-kill")).toMatchObject({
      ok: false,
      code: "INVALID_NIGHT_ACTION"
    });
  });

  it("lets the host correct life without last words and immediately re-evaluates the winner", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾", "南星"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 1, villager: 2, seer: 1, witch: 0 });
    room.startGame();
    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;

    expect(room.correctPlayerLife(wolf.selfId, false)).toMatchObject({
      ok: true,
      data: {
        view: {
          phase: "game-over",
          gameResult: { outcome: "good-win" }
        },
        player: { id: wolf.selfId, alive: false }
      }
    });
    expect(room.getHostView().dayState).toBeNull();
    expect(room.correctPlayerLife(wolf.selfId, true)).toMatchObject({
      ok: false,
      code: "INVALID_PHASE_CONTROL"
    });
  });

  it("skips the current speaker when the host corrects them to dead", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾", "南星", "石川"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 1, villager: 2, seer: 1, witch: 1 });
    room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      room.confirmRole(session.data.lobby.selfId);
    }
    room.skipCurrentNightStage();
    room.skipCurrentNightStage();
    room.skipCurrentNightStage();
    room.continueFromDawn();
    let firstSpeaker = room.getHostView().dayState!.currentSpeaker!;
    const firstRole = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return room.getPlayerView(session.data.lobby.selfId)!;
    }).find((view) => view.selfId === firstSpeaker.id)?.privateRole?.role;
    if (firstRole === "wolf") {
      room.finishSpeaking(firstSpeaker.id);
      firstSpeaker = room.getHostView().dayState!.currentSpeaker!;
    }

    const corrected = room.correctPlayerLife(firstSpeaker.id, false);

    expect(corrected).toMatchObject({ ok: true, data: { player: { alive: false } } });
    expect(room.getHostView().dayState?.currentSpeaker?.id).not.toBe(firstSpeaker.id);
    expect(room.getHostView().phase).toBe("day-speech");
  });

  it("re-evaluates the winner when the last wolf departs", () => {
    const room = createRoom();
    const sessions = ["林野", "阿岚", "青禾", "南星"].map((nickname, index) =>
      room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
    );
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    room.updateRoleConfiguration({ wolf: 1, villager: 2, seer: 1, witch: 0 });
    room.startGame();
    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;

    expect(room.markPlayerDeparted(wolf.selfId)).toMatchObject({
      ok: true,
      data: { view: { phase: "game-over", gameResult: { outcome: "good-win" } } }
    });
  });
});
