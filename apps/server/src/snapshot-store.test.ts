import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameRuntime } from "./runtime.js";
import { SnapshotStore } from "./snapshot-store.js";
import { gameRuntimeSnapshotSchema } from "./snapshot-schema.js";

const stores: SnapshotStore[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("SQLite runtime snapshots", () => {
  it("overwrites and loads the latest snapshot", () => {
    const store = new SnapshotStore(":memory:");
    stores.push(store);
    const runtime = new GameRuntime({
      localAddress: "192.168.1.20",
      webPort: 5173,
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456"
    });

    store.save(runtime.createSnapshot(), new Date("2026-07-16T00:00:00.000Z"));
    runtime.room.join({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "林野"
    }, "socket-a");
    store.save(runtime.createSnapshot(), new Date("2026-07-16T00:00:01.000Z"));

    expect(store.load()?.room.players).toHaveLength(1);
    expect(store.load()?.room.players[0]).toMatchObject({ nickname: "林野" });
    expect(store.load()?.room.players[0]).not.toHaveProperty("reconnectToken");
    expect(store.load()?.room.players[0]?.reconnectTokenHash).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("persists an LLM bot profile binding in version 3 snapshots", () => {
    const store = new SnapshotStore(":memory:");
    stores.push(store);
    const runtime = new GameRuntime({
      localAddress: "192.168.1.20",
      webPort: 5173,
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456"
    });
    const botProfileId = "11111111-1111-4111-8111-111111111111";

    expect(runtime.room.addBot({
      nickname: "LLM Bot",
      botKind: "llm",
      botProfileId
    })).toMatchObject({ ok: true });
    const botId = runtime.room.getBotSeats()[0]!.playerId;
    runtime.room.lockBotConfiguration(botId, {
      botProfileRevision: 2,
      modelProfileId: "22222222-2222-4222-8222-222222222222",
      modelProfileRevision: 3,
      modelChainRevision: "22222222-2222-4222-8222-222222222222:3"
    });
    store.save(runtime.createSnapshot());

    const snapshot = store.load();
    expect(snapshot).toMatchObject({
      version: 3,
      room: {
        version: 3,
        players: [{
          controller: "bot",
          botKind: "llm",
          botProfileId,
          aiConfigurationLocked: true,
          aiBotProfileRevision: 2,
          aiModelProfileId: "22222222-2222-4222-8222-222222222222",
          aiModelProfileRevision: 3
        }]
      }
    });

    const restored = new GameRuntime({
      localAddress: "192.168.1.21",
      webPort: 5173,
      snapshot: snapshot!
    });
    expect(restored.room.getBotSeats()).toEqual([
      expect.objectContaining({
        botKind: "llm",
        botProfileId,
        lockedConfiguration: {
          locked: true,
          botProfileRevision: 2,
          modelProfileId: "22222222-2222-4222-8222-222222222222",
          modelProfileRevision: 3,
          modelChainRevision: "22222222-2222-4222-8222-222222222222:3"
        }
      })
    ]);
  });

  it("coalesces scheduled writes and keeps the latest snapshot", () => {
    const store = new SnapshotStore(":memory:");
    stores.push(store);
    const runtime = new GameRuntime({
      localAddress: "192.168.1.20",
      webPort: 5173,
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456"
    });
    const first = runtime.createSnapshot();
    runtime.room.join({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "鏋楅噹"
    }, "socket-a");
    const latest = runtime.createSnapshot();

    store.schedule(first, new Date("2026-07-16T00:00:00.000Z"));
    store.schedule(latest, new Date("2026-07-16T00:00:01.000Z"));
    expect(store.load()).toBeNull();

    store.flush();
    expect(store.load()?.room.players).toHaveLength(1);
  });

  it("rejects snapshots that do not satisfy the persistence schema", () => {
    const runtime = new GameRuntime({
      localAddress: "192.168.1.20",
      webPort: 5173,
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456"
    });
    runtime.room.join({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "鏋楅噹"
    }, "socket-a");
    const snapshot = runtime.createSnapshot();

    expect(() => gameRuntimeSnapshotSchema.parse({
      ...snapshot,
      clockRemainingMs: -1
    })).toThrow();
    expect(() => gameRuntimeSnapshotSchema.parse({
      ...snapshot,
      room: {
        ...snapshot.room,
        players: [{ ...snapshot.room.players[0], reconnectTokenHash: "not-a-base64-hash" }]
      }
    })).toThrow();
  });

  it("recovers a corrupted primary snapshot from the previous valid backup", () => {
    const directory = mkdtempSync(join(tmpdir(), "werewolf-snapshot-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "runtime.sqlite");
    const firstStore = new SnapshotStore(databasePath);
    const runtime = new GameRuntime({
      localAddress: "192.168.1.20",
      webPort: 5173,
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456"
    });
    const firstSnapshot = runtime.createSnapshot();
    firstStore.save(firstSnapshot, new Date("2026-07-16T00:00:00.000Z"));
    runtime.room.join({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "鏋楅噹"
    }, "socket-a");
    firstStore.save(runtime.createSnapshot(), new Date("2026-07-16T00:00:01.000Z"));
    expect(firstStore.checkIntegrity()).toBe(true);
    firstStore.close();

    const database = new DatabaseSync(databasePath);
    database.prepare("UPDATE runtime_snapshot SET payload = ? WHERE id = 1").run("{broken-json");
    database.close();

    const recoveredStore = new SnapshotStore(databasePath);
    stores.push(recoveredStore);
    expect(recoveredStore.load()).toMatchObject({
      room: { players: [] }
    });
    expect(recoveredStore.load()).toEqual(firstSnapshot);
  });
});
