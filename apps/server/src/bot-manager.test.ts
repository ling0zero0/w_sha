import type {
  BotIntent,
  BotKind,
  PlayerId,
  PlayerLobbyView
} from "@werewolf/shared";
import { describe, expect, it, vi } from "vitest";
import { executeBotIntent } from "./bot-executor.js";
import {
  BotManager,
  type BotAdapter,
  type BotAdapterFactory,
  type BotTurnContext
} from "./bot-manager.js";
import { LobbyRoom } from "./room.js";

function createRoom(): LobbyRoom {
  return new LobbyRoom({
    localAddress: "192.168.1.20",
    webPort: 5173,
    roomCode: "123456",
    joinToken: "abcdefghijklmnopqrstuvwxyz123456"
  });
}

function addBots(room: LobbyRoom, count: number): PlayerId[] {
  for (let index = 0; index < count; index += 1) {
    expect(room.addBot(`Bot ${index + 1}`, "deterministic")).toMatchObject({ ok: true });
  }
  return room.getBotSeats().map((seat) => seat.playerId);
}

function configureThreePlayers(room: LobbyRoom): void {
  expect(room.updateRoleConfiguration({
    wolf: 1,
    villager: 1,
    seer: 1,
    witch: 0,
    guard: 0,
    hunter: 0,
    idiot: 0
  })).toMatchObject({ ok: true });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not reached");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

class CallbackAdapter implements BotAdapter {
  readonly kind: BotKind = "deterministic";

  constructor(
    private readonly callback: (
      view: PlayerLobbyView,
      context: BotTurnContext
    ) => Promise<BotIntent | null>
  ) {}

  onView(view: PlayerLobbyView, context: BotTurnContext): Promise<BotIntent | null> {
    return this.callback(view, context);
  }

  async dispose(): Promise<void> {}
}

describe("bot seats", () => {
  it("adds lobby-only bot seats and restores them online without exposing reconnect takeover", () => {
    const room = createRoom();
    const added = room.addBot("Atlas", "deterministic");
    expect(added).toMatchObject({
      ok: true,
      data: {
        players: [
          expect.objectContaining({
            nickname: "Atlas",
            connection: "online",
            controller: "bot",
            botKind: "deterministic"
          })
        ]
      }
    });
    expect(room.addBot("atlas", "deterministic")).toMatchObject({
      ok: false,
      code: "NICKNAME_TAKEN"
    });
    expect(room.requestTakeover({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "Atlas"
    }, "socket-1")).toMatchObject({ ok: false, code: "PLAYER_NOT_FOUND" });

    const restored = new LobbyRoom({
      localAddress: "192.168.1.20",
      webPort: 5173,
      snapshot: room.createSnapshot()
    });
    expect(restored.getHostView().players[0]).toMatchObject({
      connection: "online",
      controller: "bot",
      botKind: "deterministic"
    });

    addBots(room, 3);
    expect(room.updateRoleConfiguration({
      wolf: 2,
      villager: 1,
      seer: 1,
      witch: 0,
      guard: 0,
      hunter: 0,
      idiot: 0
    })).toMatchObject({ ok: true });
    expect(room.startGame()).toMatchObject({ ok: true });
    for (const { playerId } of room.getBotSeats()) {
      expect(room.confirmRole(playerId)).toMatchObject({ ok: true });
    }
    const views = room.getBotSeats().map((seat) => room.getPlayerView(seat.playerId)!);
    const wolfViews = views.filter((view) => view.privateRole?.role === "wolf");
    const goodViews = views.filter((view) => view.privateRole?.role !== "wolf");
    expect(wolfViews).toHaveLength(2);
    expect(wolfViews.every((view) => view.privateRole?.wolfTeammates.length === 1)).toBe(true);
    expect(wolfViews.every((view) => view.wolfAction !== null)).toBe(true);
    expect(goodViews.every((view) => view.wolfAction === null)).toBe(true);
    expect(room.getHostView().players.every((player) => !("role" in player))).toBe(true);
    expect(room.addBot("Late Bot", "deterministic")).toMatchObject({
      ok: false,
      code: "GAME_ALREADY_STARTED"
    });
  });
});

describe("BotManager", () => {
  it("passes exactly the bot's private player view to its adapter", async () => {
    const room = createRoom();
    const [playerId] = addBots(room, 1);
    let received: PlayerLobbyView | null = null;
    const manager = new BotManager({
      room,
      adapterFactory: () => new CallbackAdapter(async (view) => {
        received = structuredClone(view);
        return null;
      }),
      execute: () => false
    });

    manager.notify();
    await waitFor(() => received !== null);
    expect(received).toEqual(room.getPlayerView(playerId!));
    expect(JSON.stringify(received)).not.toContain("joinToken");
    expect(JSON.stringify(received)).not.toContain("reconnectToken");
    await manager.dispose();
  });

  it("rejects stale and timed-out decisions before they mutate the room", async () => {
    const room = createRoom();
    const playerIds = addBots(room, 3);
    configureThreePlayers(room);
    expect(room.startGame()).toMatchObject({ ok: true });
    const targetId = playerIds[0]!;
    let release: ((intent: BotIntent) => void) | null = null;
    const started = vi.fn();
    const factory: BotAdapterFactory = (_kind, playerId) => new CallbackAdapter(async () => {
      if (playerId !== targetId) return null;
      started();
      return new Promise<BotIntent>((resolve) => {
        release = resolve;
      });
    });
    const manager = new BotManager({
      room,
      adapterFactory: factory,
      timeoutMs: 500,
      execute: (playerId, intent, revision) => executeBotIntent(
        room,
        playerId,
        intent,
        revision
      ).accepted
    });

    manager.notify();
    await waitFor(() => started.mock.calls.length === 1);
    expect(room.confirmRole(playerIds[1]!)).toMatchObject({ ok: true });
    manager.notify();
    release!({ type: "confirm-role" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(room.getPlayerView(targetId)?.privateRole?.confirmed).toBe(false);
    await manager.dispose();

    const timeoutRoom = createRoom();
    const timeoutIds = addBots(timeoutRoom, 3);
    configureThreePlayers(timeoutRoom);
    expect(timeoutRoom.startGame()).toMatchObject({ ok: true });
    const timeoutManager = new BotManager({
      room: timeoutRoom,
      timeoutMs: 10,
      adapterFactory: (_kind, playerId) => new CallbackAdapter(async () => {
        if (playerId !== timeoutIds[0]) return null;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { type: "confirm-role" };
      }),
      execute: (playerId, intent, revision) => executeBotIntent(
        timeoutRoom,
        playerId,
        intent,
        revision
      ).accepted
    });
    timeoutManager.notify();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(timeoutRoom.getPlayerView(timeoutIds[0]!)?.privateRole?.confirmed).toBe(false);
    await timeoutManager.dispose();
  });

  it("contains adapter errors and keeps processing after the next room revision", async () => {
    const room = createRoom();
    const playerIds = addBots(room, 3);
    configureThreePlayers(room);
    expect(room.startGame()).toMatchObject({ ok: true });
    const targetId = playerIds[0]!;
    const onError = vi.fn();
    let calls = 0;
    const manager = new BotManager({
      room,
      onError,
      adapterFactory: (_kind, playerId) => new CallbackAdapter(async () => {
        if (playerId !== targetId) return null;
        calls += 1;
        if (calls === 1) throw new Error("adapter failed");
        return { type: "confirm-role" };
      }),
      execute: (playerId, intent, revision) => executeBotIntent(
        room,
        playerId,
        intent,
        revision
      ).accepted
    });

    manager.notify();
    await waitFor(() => onError.mock.calls.length === 1);
    expect(room.confirmRole(playerIds[1]!)).toMatchObject({ ok: true });
    manager.notify();
    await waitFor(() => room.getPlayerView(targetId)?.privateRole?.confirmed === true);
    expect(calls).toBeGreaterThanOrEqual(2);
    await manager.dispose();
  });

  it("retries the same room revision after a paused execution is resumed", async () => {
    const room = createRoom();
    const playerIds = addBots(room, 3);
    configureThreePlayers(room);
    expect(room.startGame()).toMatchObject({ ok: true });
    const targetId = playerIds[0]!;
    let paused = true;
    const attempts = vi.fn();
    const manager = new BotManager({
      room,
      adapterFactory: (_kind, playerId) => new CallbackAdapter(async (view) => (
        playerId === targetId && !view.privateRole?.confirmed
          ? { type: "confirm-role" }
          : null
      )),
      execute: (playerId, intent, revision) => {
        if (playerId !== targetId) return false;
        attempts();
        if (paused) return false;
        return executeBotIntent(room, playerId, intent, revision).accepted;
      }
    });

    manager.notify();
    await waitFor(() => attempts.mock.calls.length === 1);
    expect(room.getPlayerView(targetId)?.privateRole?.confirmed).toBe(false);

    paused = false;
    manager.notify(true);
    await waitFor(() => room.getPlayerView(targetId)?.privateRole?.confirmed === true);
    expect(attempts).toHaveBeenCalledTimes(2);
    await manager.dispose();
  });

  it("cancels and disposes an in-flight adapter when its bot seat is removed", async () => {
    const room = createRoom();
    const [playerId] = addBots(room, 1);
    let aborted = false;
    let disposed = false;
    const started = vi.fn();
    const manager = new BotManager({
      room,
      adapterFactory: () => ({
        kind: "deterministic",
        async onView(_view, context) {
          started();
          await new Promise<void>((resolve) => {
            context.signal.addEventListener("abort", () => {
              aborted = true;
              resolve();
            }, { once: true });
          });
          return null;
        },
        async dispose() {
          disposed = true;
        }
      }),
      execute: () => false
    });

    manager.notify();
    await waitFor(() => started.mock.calls.length === 1);
    expect(room.removePlayer(playerId!)).toMatchObject({ ok: true });
    manager.notify();
    await waitFor(() => aborted && disposed);
    await manager.dispose();
  });

  it("runs a deterministic all-bot game through the normal state machine", async () => {
    const room = createRoom();
    addBots(room, 5);
    expect(room.updateRoleConfiguration({
      wolf: 1,
      villager: 2,
      seer: 1,
      witch: 1,
      guard: 0,
      hunter: 0,
      idiot: 0
    })).toMatchObject({ ok: true });
    expect(room.startGame()).toMatchObject({ ok: true });

    let manager: BotManager;
    manager = new BotManager({
      room,
      execute: (playerId, intent, revision) => {
        const execution = executeBotIntent(room, playerId, intent, revision);
        if (execution.accepted) queueMicrotask(() => manager.notify());
        return execution.accepted;
      }
    });
    manager.notify();

    const deadline = Date.now() + 4_000;
    while (room.getHostView().phase !== "game-over" && Date.now() < deadline) {
      const phase = room.getHostView().phase;
      if (phase === "dawn") {
        expect(room.continueFromDawn()).toMatchObject({ ok: true });
        manager.notify();
      } else if (phase === "exile-result") {
        expect(room.continueFromExile()).toMatchObject({ ok: true });
        manager.notify();
      }
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    expect(room.getHostView().phase).toBe("game-over");
    expect(room.getHostView().publicChat.messages.length).toBeGreaterThan(0);
    await manager.dispose();
  }, 5_000);
});
