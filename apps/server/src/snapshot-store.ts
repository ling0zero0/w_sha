import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { GameRuntimeSnapshot } from "./runtime.js";

export class SnapshotStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS runtime_snapshot (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        saved_at TEXT NOT NULL,
        payload TEXT NOT NULL
      )
    `);
  }

  save(snapshot: GameRuntimeSnapshot, now = new Date()): void {
    this.database.prepare(`
      INSERT INTO runtime_snapshot (id, saved_at, payload)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET saved_at = excluded.saved_at, payload = excluded.payload
    `).run(now.toISOString(), JSON.stringify(snapshot));
  }

  load(): GameRuntimeSnapshot | null {
    const row = this.database.prepare("SELECT payload FROM runtime_snapshot WHERE id = 1").get() as
      | { payload: string }
      | undefined;
    if (!row) return null;
    const snapshot = JSON.parse(row.payload) as GameRuntimeSnapshot;
    if (
      ![1, 2, 3].includes(snapshot.version)
      || !snapshot.room
      || ![1, 2, 3].includes(snapshot.room.version)
    ) throw new Error("unsupported snapshot version");
    return snapshot;
  }

  close(): void {
    this.database.close();
  }
}
