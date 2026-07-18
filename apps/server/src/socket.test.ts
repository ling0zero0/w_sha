import {
  type ClientToServerEvents,
  type HostLobbyView,
  type PlayerLobbyView,
  type PlayerSession,
  type PublicGameState,
  type ServerToClientEvents
} from "@werewolf/shared";
import type { AddressInfo } from "node:net";
import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./app.js";
import type { ServerConfig } from "./config.js";
import { GameRuntime } from "./runtime.js";
import { attachSocketServer } from "./socket.js";

const config: ServerConfig = {
  HOST: "127.0.0.1",
  PORT: 3000,
  WEB_PORT: 5173,
  OPEN_BROWSER: false,
  DATABASE_PATH: ":memory:",
  LOG_LEVEL: "silent",
  NODE_ENV: "test"
};

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const clients: TestSocket[] = [];
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => client.disconnect());
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function waitForHostState(socket: TestSocket): Promise<HostLobbyView> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for host:state")), 2_000);
    socket.once("host:state", (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

function waitForPlayerState(socket: TestSocket): Promise<PlayerLobbyView> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for player:state")), 2_000);
    socket.once("player:state", (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

function waitForTakeoverApproval(socket: TestSocket): Promise<PlayerSession> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for player:takeover-approved")), 2_000);
    socket.once("player:takeover-approved", (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

function waitForPublicGameState(socket: TestSocket): Promise<PublicGameState> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for game:public-state")), 2_000);
    socket.once("game:public-state", (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

function waitForDeparture(socket: TestSocket): Promise<{ message: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for player:departed")), 2_000);
    socket.once("player:departed", (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

function waitForTakeoverRejection(socket: TestSocket): Promise<{ message: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for player:takeover-rejected")), 2_000);
    socket.once("player:takeover-rejected", (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

function connect(url: string, auth?: Record<string, string>): TestSocket {
  const socket: TestSocket = createClient(url, auth
    ? { auth, transports: ["websocket"] }
    : { transports: ["websocket"] });
  clients.push(socket);
  return socket;
}

async function startRuntime(
  automaticPhaseProgression = false,
  stageTimingOverrides: Parameters<typeof attachSocketServer>[5] = {}
) {
  const runtime = new GameRuntime({
    localAddress: "192.168.1.20",
    webPort: 5173,
    roomCode: "123456",
    joinToken: "abcdefghijklmnopqrstuvwxyz123456",
    hostSession: "zyxwvutsrqponmlkjihgfedcba654321"
  });
  const app = buildServer(config, runtime);
  const io = attachSocketServer(
    app.server,
    app.log,
    runtime,
    () => undefined,
    automaticPhaseProgression,
    stageTimingOverrides
  );
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;
  cleanups.push(async () => {
    io.close();
    await app.close();
  });
  return { runtime, url: `http://127.0.0.1:${address.port}` };
}

describe("lobby socket integration", () => {
  it("synchronizes two joined players to host and private player views", async () => {
    const { url } = await startRuntime();
    const host = connect(url, { hostSession: "zyxwvutsrqponmlkjihgfedcba654321" });
    await waitForHostState(host);

    const playerOne = connect(url);
    const firstHostUpdate = waitForHostState(host);
    const firstJoin = await playerOne.emitWithAck("player:join", {
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "林野"
    });
    expect(firstJoin).toMatchObject({ ok: true });
    expect((await firstHostUpdate).players).toHaveLength(1);

    const playerTwo = connect(url);
    const playerOneUpdate = waitForPlayerState(playerOne);
    const secondJoin = await playerTwo.emitWithAck("player:join", {
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "阿岚"
    });

    expect(secondJoin).toMatchObject({ ok: true });
    expect((await playerOneUpdate).players.map((player) => player.nickname)).toEqual(["林野", "阿岚"]);
    expect(JSON.stringify(secondJoin)).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
  });

  it("rejects host controls from an unauthenticated player socket", async () => {
    const { url } = await startRuntime();
    const player = connect(url);
    const result = await player.emitWithAck("host:refresh-join");

    expect(result).toMatchObject({ ok: false, code: "INVALID_HOST_SESSION" });
  });

  it("ignores events without acknowledgements without mutating the room", async () => {
    const { runtime, url } = await startRuntime();
    const player = connect(url);
    await new Promise<void>((resolve) => player.once("connect", () => resolve()));

    const unsafeSocket = player as unknown as {
      emit: (event: string, ...args: unknown[]) => void;
    };
    unsafeSocket.emit("player:join", {
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "无回调玩家"
    });
    unsafeSocket.emit("player:join", {});

    await new Promise((resolve) => setTimeout(resolve, 25));
    const pong = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("server stopped responding")), 2_000);
      player.once("system:pong", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    player.emit("system:ping", { sentAt: Date.now() });

    await pong;
    expect(runtime.room.getHostView().players).toHaveLength(0);
  });

  it("restores a player after reconnect without creating a duplicate", async () => {
    const { runtime, url } = await startRuntime();
    const firstSocket = connect(url);
    const joined = await firstSocket.emitWithAck("player:join", {
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "林野"
    });
    if (!joined.ok) throw new Error("test setup failed");
    firstSocket.disconnect();

    const restoredSocket = connect(url);
    const restored = await restoredSocket.emitWithAck("player:reconnect", joined.data.credentials);
    expect(restored).toMatchObject({
      ok: true,
      data: { lobby: { selfId: joined.data.lobby.selfId } }
    });
    expect(runtime.room.getHostView().players).toHaveLength(1);
    expect(runtime.room.getHostView().players[0]?.connection).toBe("online");
  });

  it("lets the host approve a new device and revokes the old credential", async () => {
    const { url } = await startRuntime();
    const host = connect(url, { hostSession: "zyxwvutsrqponmlkjihgfedcba654321" });
    await waitForHostState(host);
    const oldSocket = connect(url);
    const joinedHostUpdate = waitForHostState(host);
    const joined = await oldSocket.emitWithAck("player:join", {
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "林野"
    });
    if (!joined.ok) throw new Error("test setup failed");
    await joinedHostUpdate;

    const newDevice = connect(url);
    const hostRequestUpdate = waitForHostState(host);
    const request = await newDevice.emitWithAck("player:request-takeover", {
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "林野"
    });
    if (!request.ok) throw new Error("test setup failed");
    expect((await hostRequestUpdate).takeoverRequests).toHaveLength(1);

    const approval = waitForTakeoverApproval(newDevice);
    const resolved = await host.emitWithAck("host:resolve-takeover", {
      requestId: request.data.requestId,
      approved: true
    });
    const replacementSession = await approval;
    expect(resolved).toMatchObject({ ok: true, data: { takeoverRequests: [] } });
    expect(replacementSession.credentials.reconnectToken).not.toBe(joined.data.credentials.reconnectToken);

    const staleSocket = connect(url);
    const staleResult = await staleSocket.emitWithAck("player:reconnect", joined.data.credentials);
    expect(staleResult).toMatchObject({ ok: false, code: "INVALID_RECONNECT_CREDENTIALS" });
  });

  it("synchronizes authenticated host clock controls to joined players", async () => {
    const { runtime, url } = await startRuntime();
    runtime.phaseClock.start(60_000, Date.now());

    const host = connect(url, { hostSession: "zyxwvutsrqponmlkjihgfedcba654321" });
    const initialHostState = await waitForPublicGameState(host);
    expect(initialHostState).toMatchObject({ revision: 0, clock: { status: "running" } });

    const player = connect(url);
    const initialPlayerState = waitForPublicGameState(player);
    const joined = await player.emitWithAck("player:join", {
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "林野"
    });
    expect(joined).toMatchObject({ ok: true });
    expect(await initialPlayerState).toMatchObject({ revision: 0, clock: { status: "running" } });

    const hostPausedState = waitForPublicGameState(host);
    const playerPausedState = waitForPublicGameState(player);
    const paused = await host.emitWithAck("host:pause-phase");
    expect(paused).toMatchObject({ ok: true, data: { revision: 1, clock: { status: "paused" } } });
    expect(await hostPausedState).toMatchObject({ revision: 1, clock: { status: "paused" } });
    const publicPause = await playerPausedState;
    expect(publicPause).toMatchObject({
      revision: 1,
      clock: { status: "paused" },
      interventions: [expect.objectContaining({ type: "pause", detail: "主机暂停了当前阶段" })]
    });

    const adjustedBroadcast = waitForPublicGameState(player);
    const adjusted = await host.emitWithAck("host:adjust-phase-time", { deltaMs: 15_000 });
    expect(adjusted).toMatchObject({ ok: true, data: { revision: 2, clock: { status: "paused" } } });
    expect((await adjustedBroadcast).interventions.at(-1)).toMatchObject({ type: "adjust-time" });

    const resumedBroadcast = waitForPublicGameState(player);
    const resumed = await host.emitWithAck("host:resume-phase");
    expect(resumed).toMatchObject({ ok: true, data: { revision: 3, clock: { status: "running" } } });
    expect(await resumedBroadcast).toMatchObject({ revision: 3, clock: { status: "running" } });

  });

  it("lets only the host terminate an active game and reveals the final record", async () => {
    const { runtime, url } = await startRuntime();
    const host = connect(url, { hostSession: "zyxwvutsrqponmlkjihgfedcba654321" });
    await waitForHostState(host);
    const players = [connect(url), connect(url), connect(url)];
    for (const [index, player] of players.entries()) {
      const joined = await player.emitWithAck("player:join", {
        roomCode: "123456",
        joinToken: "abcdefghijklmnopqrstuvwxyz123456",
        nickname: ["林野", "阿岚", "青禾"][index]!
      });
      if (!joined.ok) throw new Error("test setup failed");
    }
    await host.emitWithAck("host:update-role-configuration", { wolf: 1, villager: 1, seer: 1, witch: 0 });
    await host.emitWithAck("host:start-game");

    expect(await players[0]!.emitWithAck("host:force-end-phase")).toMatchObject({
      ok: false,
      code: "INVALID_HOST_SESSION"
    });
    const playerUpdates = players.map((player) => waitForPlayerState(player));
    const publicUpdate = waitForPublicGameState(players[0]!);
    const terminated = await host.emitWithAck("host:force-end-phase");

    expect(terminated).toMatchObject({ ok: true, data: { clock: { status: "idle" } } });
    expect((await publicUpdate).interventions.at(-1)).toMatchObject({
      type: "force-end",
      detail: "主机强制终止了对局"
    });
    for (const view of await Promise.all(playerUpdates)) {
      expect(view).toMatchObject({
        phase: "game-over",
        gameResult: {
          outcome: "terminated",
          records: [expect.objectContaining({ type: "host-intervention", detail: "主机强制终止了对局" })]
        }
      });
      expect(view.gameResult?.revealedPlayers).toHaveLength(3);
    }
    expect(runtime.room.getHostView().gameResult?.outcome).toBe("terminated");
  });

  it("lets only the host correct player life and broadcasts the public intervention", async () => {
    const { runtime, url } = await startRuntime();
    const host = connect(url, { hostSession: "zyxwvutsrqponmlkjihgfedcba654321" });
    await waitForHostState(host);
    const players = [connect(url), connect(url), connect(url), connect(url)];
    for (const [index, player] of players.entries()) {
      const joined = await player.emitWithAck("player:join", {
        roomCode: "123456",
        joinToken: "abcdefghijklmnopqrstuvwxyz123456",
        nickname: ["林野", "阿岚", "青禾", "南星"][index]!
      });
      if (!joined.ok) throw new Error("test setup failed");
    }
    await host.emitWithAck("host:update-role-configuration", { wolf: 1, villager: 2, seer: 1, witch: 0 });
    const roleUpdates = players.map((player) => waitForPlayerState(player));
    await host.emitWithAck("host:start-game");
    const roles = await Promise.all(roleUpdates);
    const villagerIndex = roles.findIndex((view) => view.privateRole?.role === "villager");
    const target = roles[villagerIndex]!;

    expect(await players[villagerIndex]!.emitWithAck("host:correct-player-life", {
      playerId: target.selfId,
      alive: false
    })).toMatchObject({ ok: false, code: "INVALID_HOST_SESSION" });

    const playerState = waitForPlayerState(players[villagerIndex]!);
    const publicState = waitForPublicGameState(players[villagerIndex]!);
    const corrected = await host.emitWithAck("host:correct-player-life", {
      playerId: target.selfId,
      alive: false
    });

    expect(corrected).toMatchObject({
      ok: true,
      data: { players: expect.arrayContaining([expect.objectContaining({ id: target.selfId, alive: false })]) }
    });
    expect(await playerState).toMatchObject({ players: expect.arrayContaining([
      expect.objectContaining({ id: target.selfId, alive: false })
    ]) });
    const intervention = (await publicState).interventions.at(-1);
    expect(intervention).toMatchObject({ type: "correct-life" });
    expect(intervention?.detail).toContain("修正为死亡");
    expect(JSON.stringify(runtime.getPublicGameState())).not.toMatch(/"role"|privateRole|seer|wolf|witch/);
  });

  it("rejects unauthorized, malformed, and invalid phase controls", async () => {
    const { runtime, url } = await startRuntime();
    const player = connect(url);

    expect(await player.emitWithAck("host:pause-phase")).toMatchObject({
      ok: false,
      code: "INVALID_HOST_SESSION"
    });

    const host = connect(url, { hostSession: "zyxwvutsrqponmlkjihgfedcba654321" });
    await waitForPublicGameState(host);
    expect(await host.emitWithAck("host:pause-phase")).toMatchObject({
      ok: false,
      code: "INVALID_PHASE_CONTROL"
    });
    expect(await host.emitWithAck("host:adjust-phase-time", { deltaMs: 0 })).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST"
    });
    expect(runtime.getPublicGameState()).toMatchObject({ revision: 0, interventions: [] });
  });

  it("marks a player departed while retaining the public seat and revoking reconnect", async () => {
    const { url } = await startRuntime();
    const host = connect(url, { hostSession: "zyxwvutsrqponmlkjihgfedcba654321" });
    await waitForHostState(host);
    const departingPlayer = connect(url);
    const joined = await departingPlayer.emitWithAck("player:join", {
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "林野"
    });
    if (!joined.ok) throw new Error("test setup failed");
    const otherPlayer = connect(url);
    const otherJoined = await otherPlayer.emitWithAck("player:join", {
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "阿岚"
    });
    if (!otherJoined.ok) throw new Error("test setup failed");

    const departureNotice = waitForDeparture(departingPlayer);
    const otherRoster = waitForPlayerState(otherPlayer);
    const publicIntervention = waitForPublicGameState(otherPlayer);
    const result = await host.emitWithAck("host:depart-player", {
      playerId: joined.data.lobby.selfId
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        players: [
          expect.objectContaining({ number: 1, nickname: "林野", connection: "departed" }),
          expect.objectContaining({ number: 2, nickname: "阿岚", connection: "online" })
        ]
      }
    });
    expect(await departureNotice).toEqual({ message: "主机已将你判定为离场" });
    expect((await otherRoster).players[0]).toMatchObject({ number: 1, connection: "departed" });
    const gameState = await publicIntervention;
    expect(gameState.interventions.at(-1)).toMatchObject({
      type: "depart-player",
      detail: "主机将 1 号玩家林野判定为离场"
    });
    expect(JSON.stringify(gameState)).not.toMatch(/reconnectToken|socketId|identity|role/);

    const staleSocket = connect(url);
    expect(await staleSocket.emitWithAck("player:reconnect", joined.data.credentials)).toMatchObject({
      ok: false,
      code: "INVALID_RECONNECT_CREDENTIALS"
    });
    expect(await host.emitWithAck("host:depart-player", {
      playerId: joined.data.lobby.selfId
    })).toMatchObject({ ok: false, code: "PLAYER_ALREADY_DEPARTED" });
  });

  it("cancels a pending takeover when the target player departs", async () => {
    const { url } = await startRuntime();
    const host = connect(url, { hostSession: "zyxwvutsrqponmlkjihgfedcba654321" });
    await waitForHostState(host);
    const player = connect(url);
    const joined = await player.emitWithAck("player:join", {
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "林野"
    });
    if (!joined.ok) throw new Error("test setup failed");
    const requester = connect(url);
    const requested = await requester.emitWithAck("player:request-takeover", {
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "林野"
    });
    if (!requested.ok) throw new Error("test setup failed");

    const rejection = waitForTakeoverRejection(requester);
    await host.emitWithAck("host:depart-player", { playerId: joined.data.lobby.selfId });

    expect(await rejection).toEqual({ message: "该玩家已被主机判定离场，接管申请已取消" });
    expect(await host.emitWithAck("host:resolve-takeover", {
      requestId: requested.data.requestId,
      approved: true
    })).toMatchObject({ ok: false, code: "TAKEOVER_REQUEST_NOT_FOUND" });
  });

  it("lets only the host configure roles without exposing configuration to players", async () => {
    const { runtime, url } = await startRuntime();
    const host = connect(url, { hostSession: "zyxwvutsrqponmlkjihgfedcba654321" });
    await waitForHostState(host);
    const player = connect(url);
    const joined = await player.emitWithAck("player:join", {
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "林野"
    });
    if (!joined.ok) throw new Error("test setup failed");

    const configured = await host.emitWithAck("host:update-role-configuration", {
      wolf: 1,
      villager: 1,
      seer: 1,
      witch: 0
    });
    expect(configured).toMatchObject({
      ok: true,
      data: {
        roleConfiguration: { wolf: 1, villager: 1, seer: 1, witch: 0 },
        startReadiness: { ready: false, participantCount: 1, configuredRoleCount: 3 }
      }
    });

    const playerView = runtime.room.getPlayerView(joined.data.lobby.selfId);
    expect(playerView).not.toHaveProperty("roleConfiguration");
    expect(playerView).not.toHaveProperty("startReadiness");
    expect(JSON.stringify(playerView)).not.toMatch(/"role":"(wolf|villager|seer|witch)"|identity/);

    expect(await player.emitWithAck("host:update-role-configuration", {
      wolf: 0,
      villager: 0,
      seer: 0,
      witch: 0
    })).toMatchObject({ ok: false, code: "INVALID_HOST_SESSION" });
    expect(runtime.room.getHostView().roleConfiguration).toEqual({
      wolf: 1,
      villager: 1,
      seer: 1,
      witch: 0
    });
  });

  it("rejects malformed role configuration without mutating room state", async () => {
    const { runtime, url } = await startRuntime();
    const host = connect(url, { hostSession: "zyxwvutsrqponmlkjihgfedcba654321" });
    await waitForHostState(host);

    const unsafeHost = host as unknown as {
      emitWithAck: (event: string, payload: unknown) => Promise<unknown>;
    };
    expect(await unsafeHost.emitWithAck("host:update-role-configuration", {
      wolf: 1,
      villager: 1,
      seer: 2,
      witch: 0
    })).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(runtime.room.getHostView().roleConfiguration).toEqual({
      wolf: 0,
      villager: 0,
      seer: 0,
      witch: 0
    });
  });

  it("broadcasts only private assigned roles and advances after confirmation", async () => {
    const { runtime, url } = await startRuntime();
    const host = connect(url, { hostSession: "zyxwvutsrqponmlkjihgfedcba654321" });
    await waitForHostState(host);
    const players = [connect(url), connect(url), connect(url)];
    const sessions = [];
    for (const [index, player] of players.entries()) {
      const joined = await player.emitWithAck("player:join", {
        roomCode: "123456",
        joinToken: "abcdefghijklmnopqrstuvwxyz123456",
        nickname: ["林野", "阿岚", "青禾"][index]!
      });
      if (!joined.ok) throw new Error("test setup failed");
      sessions.push(joined.data);
    }
    await host.emitWithAck("host:update-role-configuration", {
      wolf: 1,
      villager: 1,
      seer: 1,
      witch: 0
    });

    const privateUpdates = players.map((player) => waitForPlayerState(player));
    const started = await host.emitWithAck("host:start-game");
    expect(started).toMatchObject({ ok: true, data: { phase: "role-reveal" } });
    expect(JSON.stringify(started)).not.toMatch(/privateRole|wolfTeammates|"role":"/);
    const views = await Promise.all(privateUpdates);
    expect(views.map((view) => view.privateRole?.role).sort()).toEqual(["seer", "villager", "wolf"]);
    expect(views.filter((view) => view.privateRole?.role !== "wolf").every(
      (view) => view.privateRole?.wolfTeammates.length === 0
    )).toBe(true);

    for (let index = 0; index < players.length; index += 1) {
      const hostUpdate = waitForHostState(host);
      const confirmation = await players[index]!.emitWithAck("player:confirm-role");
      expect(confirmation).toMatchObject({ ok: true, data: { privateRole: { confirmed: true } } });
      const hostView = await hostUpdate;
      expect(hostView.roleConfirmation.confirmed).toBe(index + 1);
      if (index === players.length - 1) expect(hostView.phase).toBe("first-night");
    }

    const latePlayer = connect(url);
    expect(await latePlayer.emitWithAck("player:join", {
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "迟到"
    })).toMatchObject({ ok: false, code: "GAME_ALREADY_STARTED" });
    expect(sessions).toHaveLength(3);
  });

  it("automatically advances only after every role is confirmed and the minimum duration passes", async () => {
    const { runtime, url } = await startRuntime(true, {
      "role-reveal": { minimumMs: 80, maximumMs: 500 },
      wolf: { minimumMs: 50, maximumMs: 500 }
    });
    const host = connect(url, { hostSession: "zyxwvutsrqponmlkjihgfedcba654321" });
    await waitForHostState(host);
    const players = ["林野", "阿岚", "青禾"].map(() => connect(url));
    for (const [index, player] of players.entries()) {
      await player.emitWithAck("player:join", {
        roomCode: "123456",
        joinToken: "abcdefghijklmnopqrstuvwxyz123456",
        nickname: ["林野", "阿岚", "青禾"][index]!
      });
    }
    await host.emitWithAck("host:update-role-configuration", { wolf: 1, villager: 1, seer: 1, witch: 0 });
    await host.emitWithAck("host:start-game");

    for (const player of players) await player.emitWithAck("player:confirm-role");
    expect(runtime.room.getHostView()).toMatchObject({
      phase: "role-reveal",
      roleConfirmation: { confirmed: 3, total: 3 }
    });

    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(runtime.room.getHostView().phase).toBe("role-reveal");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(runtime.room.getHostView().phase).toBe("first-night");
  });

  it("routes first-night wolf votes only to authenticated wolves", async () => {
    const { runtime, url } = await startRuntime();
    const host = connect(url, { hostSession: "zyxwvutsrqponmlkjihgfedcba654321" });
    await waitForHostState(host);
    const players = [connect(url), connect(url), connect(url), connect(url)];
    for (const [index, player] of players.entries()) {
      const joined = await player.emitWithAck("player:join", {
        roomCode: "123456",
        joinToken: "abcdefghijklmnopqrstuvwxyz123456",
        nickname: ["林野", "阿岚", "青禾", "南星"][index]!
      });
      if (!joined.ok) throw new Error("test setup failed");
    }
    await host.emitWithAck("host:update-role-configuration", {
      wolf: 2,
      villager: 1,
      seer: 1,
      witch: 0
    });
    const roleUpdates = players.map((player) => waitForPlayerState(player));
    await host.emitWithAck("host:start-game");
    const roles = await Promise.all(roleUpdates);
    for (const player of players) await player.emitWithAck("player:confirm-role");

    const wolfIndexes = roles.flatMap((view, index) => view.privateRole?.role === "wolf" ? [index] : []);
    const nonWolfIndex = roles.findIndex((view) => view.privateRole?.role !== "wolf");
    expect(wolfIndexes).toHaveLength(2);
    expect(roles[nonWolfIndex]!.wolfAction).toBeNull();
    expect(await players[nonWolfIndex]!.emitWithAck("wolf:select-target", { target: "no-kill" })).toMatchObject({
      ok: false,
      code: "INVALID_NIGHT_ACTION"
    });

    const firstWolf = players[wolfIndexes[0]!]!;
    const secondWolf = players[wolfIndexes[1]!]!;
    expect(await firstWolf.emitWithAck("wolf:select-target", { target: "no-kill" })).toMatchObject({
      ok: true,
      data: { wolfAction: { target: "no-kill" } }
    });
    await firstWolf.emitWithAck("wolf:confirm-vote", { confirmed: true });
    await secondWolf.emitWithAck("wolf:select-target", { target: roles[wolfIndexes[0]!]!.selfId });
    expect(await secondWolf.emitWithAck("wolf:confirm-vote", { confirmed: true })).toMatchObject({
      ok: true,
      data: { wolfAction: { locked: true } }
    });
    const publicHostView = runtime.room.getHostView();
    expect(publicHostView.nightProgress).toMatchObject({
      stage: "night-action",
      confirmed: 0,
      required: 0,
      locked: false
    });
    expect(JSON.stringify(publicHostView)).not.toMatch(/wolfAction|seerAction|witchAction|"target"|"candidates"/);
  });

  it("broadcasts wolf chat only inside private wolf views", async () => {
    const { runtime, url } = await startRuntime();
    const host = connect(url, { hostSession: "zyxwvutsrqponmlkjihgfedcba654321" });
    await waitForHostState(host);
    const players = [connect(url), connect(url), connect(url), connect(url)];
    for (const [index, player] of players.entries()) {
      const joined = await player.emitWithAck("player:join", {
        roomCode: "123456",
        joinToken: "abcdefghijklmnopqrstuvwxyz123456",
        nickname: ["林野", "阿岚", "青禾", "南星"][index]!
      });
      if (!joined.ok) throw new Error("test setup failed");
    }
    await host.emitWithAck("host:update-role-configuration", { wolf: 2, villager: 1, seer: 1, witch: 0 });
    const roleUpdates = players.map((player) => waitForPlayerState(player));
    await host.emitWithAck("host:start-game");
    const roles = await Promise.all(roleUpdates);
    for (const player of players) await player.emitWithAck("player:confirm-role");
    const wolfIndexes = roles.flatMap((view, index) => view.privateRole?.role === "wolf" ? [index] : []);
    const nonWolfIndex = roles.findIndex((view) => view.privateRole?.role !== "wolf");

    expect(await players[nonWolfIndex]!.emitWithAck("wolf:send-message", {
      kind: "text",
      text: "越权消息"
    })).toMatchObject({ ok: false, code: "INVALID_NIGHT_ACTION" });
    const sent = await players[wolfIndexes[0]!]!.emitWithAck("wolf:send-message", {
      kind: "text",
      text: "今晚统一目标"
    });
    expect(sent).toMatchObject({ ok: true, data: { wolfAction: { messages: [
      expect.objectContaining({ text: "今晚统一目标" })
    ] } } });
    expect(JSON.stringify(runtime.room.getHostView())).not.toContain("今晚统一目标");
    expect(JSON.stringify(runtime.room.getPlayerView(roles[nonWolfIndex]!.selfId))).not.toContain("今晚统一目标");
    expect(JSON.stringify(runtime.room.getPlayerView(roles[wolfIndexes[1]!]!.selfId))).toContain("今晚统一目标");
  });

  it("starts the night clock, blocks paused actions, and lets the host skip", async () => {
    const { runtime, url } = await startRuntime();
    const host = connect(url, { hostSession: "zyxwvutsrqponmlkjihgfedcba654321" });
    await waitForHostState(host);
    const players = [connect(url), connect(url), connect(url)];
    for (const [index, player] of players.entries()) {
      const joined = await player.emitWithAck("player:join", {
        roomCode: "123456",
        joinToken: "abcdefghijklmnopqrstuvwxyz123456",
        nickname: ["林野", "阿岚", "青禾"][index]!
      });
      if (!joined.ok) throw new Error("test setup failed");
    }
    await host.emitWithAck("host:update-role-configuration", { wolf: 1, villager: 1, seer: 1, witch: 0 });
    const roleUpdates = players.map((player) => waitForPlayerState(player));
    await host.emitWithAck("host:start-game");
    const roles = await Promise.all(roleUpdates);
    for (const player of players) await player.emitWithAck("player:confirm-role");
    expect(runtime.getPublicGameState().clock).toMatchObject({ status: "running" });
    expect(runtime.getPublicGameState().clock.remainingMs).toBeGreaterThan(89_000);

    expect(await host.emitWithAck("host:pause-phase")).toMatchObject({
      ok: true,
      data: { clock: { status: "paused" } }
    });
    const wolfIndex = roles.findIndex((view) => view.privateRole?.role === "wolf");
    expect(await players[wolfIndex]!.emitWithAck("wolf:send-message", {
      kind: "quick",
      code: "agree"
    })).toMatchObject({ ok: false, code: "INVALID_PHASE_CONTROL" });

    const skipped = await host.emitWithAck("host:skip-night-phase");
    expect(skipped).toMatchObject({ ok: true });
    if (!skipped.ok) throw new Error("test setup failed");
    expect(skipped.data.interventions).toContainEqual(expect.objectContaining({ type: "skip-phase" }));
    expect(runtime.room.getNightStage()).toBe("seer");
    expect(runtime.getPublicGameState().clock).toMatchObject({ status: "running" });
    expect(runtime.getPublicGameState().clock.remainingMs).toBeGreaterThan(29_000);
  });
});
