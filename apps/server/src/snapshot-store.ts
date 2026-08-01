import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { GameRuntimeSnapshot } from "./runtime.js";
import { parseGameRuntimeSnapshot } from "./snapshot-schema.js";

export class SnapshotStore {
  private readonly database: DatabaseSync;
  private pendingWrite: { snapshot: GameRuntimeSnapshot; now: Date } | null = null;
  private scheduledWrite: NodeJS.Immediate | null = null;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS runtime_snapshot (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        saved_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_snapshot_backup (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        saved_at TEXT NOT NULL,
        payload TEXT NOT NULL
      )
    `);
  }

  save(snapshot: GameRuntimeSnapshot, now = new Date()): void {
    this.flush();
    this.write(snapshot, now);
  }

  schedule(snapshot: GameRuntimeSnapshot, now = new Date()): void {
    this.pendingWrite = { snapshot, now };
    if (this.scheduledWrite) return;
    this.scheduledWrite = setImmediate(() => {
      this.scheduledWrite = null;
      this.flush();
    });
  }

  flush(): void {
    if (this.scheduledWrite) {
      clearImmediate(this.scheduledWrite);
      this.scheduledWrite = null;
    }
    const pendingWrite = this.pendingWrite;
    this.pendingWrite = null;
    if (pendingWrite) this.write(pendingWrite.snapshot, pendingWrite.now);
  }

  private write(snapshot: GameRuntimeSnapshot, now: Date): void {
    const savedAt = now.toISOString();
    const payload = JSON.stringify(snapshot);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.readStoredRow("runtime_snapshot");
      if (current) {
        this.database.prepare(`
          INSERT INTO runtime_snapshot_backup (id, saved_at, payload)
          VALUES (1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET saved_at = excluded.saved_at, payload = excluded.payload
        `).run(current.saved_at, current.payload);
      }
      this.writePrimary(savedAt, payload);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  load(): GameRuntimeSnapshot | null {
    const primary = this.readStoredRow("runtime_snapshot");
    const parsedPrimary = primary ? this.parsePayload(primary.payload) : null;
    if (parsedPrimary) return parsedPrimary;

    const backup = this.readStoredRow("runtime_snapshot_backup");
    const parsedBackup = backup ? this.parsePayload(backup.payload) : null;
    if (backup && parsedBackup) {
      this.writePrimary(backup.saved_at, backup.payload);
      return parsedBackup;
    }

    if (!primary && !backup) return null;
    throw new Error("invalid persisted snapshot");
  }

  checkIntegrity(): boolean {
    try {
      const row = this.database.prepare("PRAGMA integrity_check").get() as
        | Record<string, unknown>
        | undefined;
      return row !== undefined && Object.values(row)[0] === "ok";
    } catch {
      return false;
    }
  }

  private parsePayload(payload: string): GameRuntimeSnapshot | null {
    try {
      return parseGameRuntimeSnapshot(JSON.parse(payload));
    } catch {
      return null;
    }
  }

  private readStoredRow(table: "runtime_snapshot" | "runtime_snapshot_backup"): {
    saved_at: string;
    payload: string;
  } | null {
    const row = this.database.prepare(`
      SELECT saved_at, payload
      FROM ${table}
      WHERE id = 1
    `).get() as { saved_at: string; payload: string } | undefined;
    return row ?? null;
  }

  private writePrimary(savedAt: string, payload: string): void {
    this.database.prepare(`
      INSERT INTO runtime_snapshot (id, saved_at, payload)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET saved_at = excluded.saved_at, payload = excluded.payload
    `).run(savedAt, payload);
  }

  close(): void {
    this.flush();
    this.database.close();
  }
}
