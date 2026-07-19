import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ChatMessage } from "@werewolf/shared";
import { ChatStore } from "./chat-store.js";

const stores: ChatStore[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createStore(path = ":memory:"): ChatStore {
  const store = new ChatStore(path);
  stores.push(store);
  return store;
}

function createSession(store: ChatStore, id = "session-1", chatMode: "ordered" | "open" = "ordered"): void {
  store.createSession({
    id,
    roomCode: "123456",
    startedAt: "2026-07-19T08:00:00.000Z",
    chatMode,
    roleConfiguration: {
      wolf: 1,
      villager: 1,
      seer: 1,
      witch: 0,
      guard: 0,
      hunter: 0,
      idiot: 0
    }
  });
}

function message(
  sequence: number,
  channel: ChatMessage["channel"] = "day-public",
  overrides: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    id: `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
    sequence,
    channel,
    day: 1,
    phase: "day-speech",
    sender: {
      kind: "player",
      id: "10000000-0000-4000-8000-000000000001",
      number: 1,
      nickname: "林野"
    },
    content: { kind: "text", text: `消息 ${sequence}` },
    createdAt: new Date(Date.UTC(2026, 6, 19, 8, 0, sequence)).toISOString(),
    ...overrides
  };
}

describe("SQLite chat store", () => {
  it("creates the normalized tables and indexes without replacing existing data", () => {
    const directory = mkdtempSync(join(tmpdir(), "werewolf-chat-store-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "runtime.sqlite");

    const legacyDatabase = new DatabaseSync(path);
    legacyDatabase.exec(`
      CREATE TABLE runtime_snapshot (
        id INTEGER PRIMARY KEY,
        saved_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      INSERT INTO runtime_snapshot (id, saved_at, payload)
      VALUES (1, '2026-07-19T07:59:00.000Z', '{"version":1}');
    `);
    legacyDatabase.close();

    const first = createStore(path);
    createSession(first);
    first.appendMessage("session-1", message(1));
    first.close();
    stores.splice(stores.indexOf(first), 1);

    const second = createStore(path);
    expect(second.loadRecentForRecovery("session-1")).toEqual([message(1)]);

    const database = new DatabaseSync(path);
    const objects = database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE name IN (
        'game_sessions',
        'chat_messages',
        'chat_messages_session_channel_sequence_idx'
      )
      ORDER BY name
    `).all() as unknown as { name: string }[];
    const legacyRow = database.prepare(`
      SELECT payload
      FROM runtime_snapshot
      WHERE id = 1
    `).get() as unknown as { payload: string };
    database.close();

    expect(objects.map((row) => row.name)).toEqual([
      "chat_messages",
      "chat_messages_session_channel_sequence_idx",
      "game_sessions"
    ]);
    expect(legacyRow.payload).toBe('{"version":1}');
    expect(existsSync(path)).toBe(true);
  });

  it("creates and finishes a session with validated metadata", () => {
    const store = createStore();
    const created = store.createSession({
      id: "session-finish",
      roomCode: "654321",
      startedAt: "2026-07-19T09:00:00.000Z",
      chatMode: "open",
      roleConfiguration: { wolf: 1, villager: 1, seer: 1, witch: 0 }
    });

    expect(created).toMatchObject({
      id: "session-finish",
      roomCode: "654321",
      endedAt: null,
      outcome: null,
      chatMode: "open",
      roleConfiguration: { guard: 0, hunter: 0, idiot: 0 }
    });
    expect(store.finishSession("session-finish", {
      endedAt: "2026-07-19T09:30:00.000Z",
      outcome: "good-win"
    })).toMatchObject({
      endedAt: "2026-07-19T09:30:00.000Z",
      outcome: "good-win"
    });
  });

  it("smoothly adds chat_mode to an existing game_sessions table", () => {
    const directory = mkdtempSync(join(tmpdir(), "werewolf-chat-store-migration-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "runtime.sqlite");
    const legacyDatabase = new DatabaseSync(path);
    legacyDatabase.exec(`
      CREATE TABLE game_sessions (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        outcome TEXT,
        role_configuration_json TEXT NOT NULL
      );
      INSERT INTO game_sessions (
        id,
        room_code,
        started_at,
        role_configuration_json
      ) VALUES (
        'legacy-session',
        '123456',
        '2026-07-19T07:00:00.000Z',
        '{"wolf":1,"villager":1,"seer":1,"witch":0,"guard":0,"hunter":0,"idiot":0}'
      );
    `);
    legacyDatabase.close();

    createStore(path);
    const database = new DatabaseSync(path);
    const row = database.prepare(`
      SELECT chat_mode
      FROM game_sessions
      WHERE id = 'legacy-session'
    `).get() as unknown as { chat_mode: string };
    database.close();

    expect(row.chat_mode).toBe("ordered");
  });

  it("treats matching session metadata as idempotent and rejects conflicts", () => {
    const store = createStore();
    const input = {
      id: "session-idempotent",
      roomCode: "123456",
      startedAt: "2026-07-19T08:00:00.000Z",
      chatMode: "open" as const,
      roleConfiguration: {
        wolf: 1,
        villager: 1,
        seer: 1,
        witch: 0
      }
    };

    const created = store.createSession(input);
    expect(store.createSession({ ...input })).toEqual(created);
    expect(() => store.createSession({
      ...input,
      chatMode: "ordered"
    })).toThrow(/session id conflict/);
    expect(() => store.createSession({
      ...input,
      roomCode: "654321"
    })).toThrow(/session id conflict/);
    expect(() => store.createSession({
      ...input,
      startedAt: "2026-07-19T08:00:01.000Z"
    })).toThrow(/session id conflict/);
    expect(() => store.createSession({
      ...input,
      roleConfiguration: { ...input.roleConfiguration, villager: 2 }
    })).toThrow(/session id conflict/);
  });

  it("treats an identical message ID as idempotent and rejects conflicting data", () => {
    const store = createStore();
    createSession(store);
    createSession(store, "session-2");
    const original = message(1);

    expect(store.appendMessage("session-1", original)).toEqual(original);
    expect(store.appendMessage("session-1", { ...original })).toEqual(original);
    expect(() => store.appendMessage("session-1", {
      ...original,
      content: { kind: "text", text: "冲突内容" }
    })).toThrow(/message id conflict/);
    expect(() => store.appendMessage("session-2", original)).toThrow(/message id conflict/);
    expect(store.loadRecentForRecovery("session-1")).toEqual([original]);
  });

  it("imports messages atomically and preserves stable cursor pagination", () => {
    const store = createStore();
    createSession(store);
    store.importMessages("session-1", [
      message(1),
      message(2, "wolf-private"),
      message(3),
      message(4, "system", {
        sender: { kind: "system", label: "法官" },
        content: { kind: "system", text: "进入投票" }
      }),
      message(5)
    ]);

    expect(store.queryAfter("session-1", { kind: "host" }, 0, 2)).toEqual({
      messages: [message(1), message(3)],
      latestSequence: 3,
      hasMore: true
    });
    expect(store.queryAfter("session-1", { kind: "host" }, 3, 2)).toEqual({
      messages: [
        message(4, "system", {
          sender: { kind: "system", label: "法官" },
          content: { kind: "system", text: "进入投票" }
        }),
        message(5)
      ],
      latestSequence: 5,
      hasMore: false
    });
  });

  it("isolates private wolf messages by reader context", () => {
    const store = createStore();
    createSession(store);
    store.importMessages("session-1", [
      message(1),
      message(2, "wolf-private"),
      message(3, "system", {
        sender: { kind: "system", label: "法官" },
        content: { kind: "system", text: "天亮了" }
      })
    ]);

    expect(store.queryAfter(
      "session-1",
      { kind: "host" },
      0,
      100
    ).messages.map((entry) => entry.sequence)).toEqual([1, 3]);
    expect(store.queryAfter(
      "session-1",
      { kind: "player", canReadWolfPrivate: false },
      0,
      100
    ).messages.map((entry) => entry.sequence)).toEqual([1, 3]);
    expect(store.queryAfter(
      "session-1",
      { kind: "player", canReadWolfPrivate: true },
      0,
      100
    ).messages.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
  });

  it("loads only the latest authorized recovery window in ascending order", () => {
    const store = createStore();
    createSession(store);
    store.importMessages("session-1", [
      message(1),
      message(2, "wolf-private"),
      message(3),
      message(4),
      message(5, "wolf-private")
    ]);

    expect(store.loadRecentForRecovery(
      "session-1",
      3
    ).map((entry) => entry.sequence)).toEqual([3, 4, 5]);
  });

  it("rolls back a batch when one imported message conflicts", () => {
    const store = createStore();
    createSession(store);
    store.appendMessage("session-1", message(2));

    expect(() => store.importMessages("session-1", [
      message(1),
      message(2, "day-public", {
        content: { kind: "text", text: "不同内容" }
      }),
      message(3)
    ])).toThrow(/message id conflict/);
    expect(store.loadRecentForRecovery(
      "session-1"
    ).map((entry) => entry.sequence)).toEqual([2]);
  });

  it("validates cursor and page limits", () => {
    const store = createStore();
    createSession(store);

    expect(() => store.queryAfter(
      "session-1",
      { kind: "host" },
      -1,
      10
    )).toThrow(/afterSequence/);
    expect(() => store.queryAfter(
      "session-1",
      { kind: "host" },
      0,
      101
    )).toThrow(/limit/);
    expect(() => store.loadRecentForRecovery(
      "session-1",
      0
    )).toThrow(/limit/);
  });
});
