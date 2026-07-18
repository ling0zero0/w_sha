import { afterEach, describe, expect, it } from "vitest";
import { GameRuntime } from "./runtime.js";
import { SnapshotStore } from "./snapshot-store.js";

const stores: SnapshotStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
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
});
