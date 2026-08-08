import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ActionId, RoomActionResult } from "@werewolf/shared";
import type { EncryptedSecret, SecretBox } from "../ai/secret-box.js";

interface ActionEntry {
  actionId: ActionId;
  event: string;
  fingerprint: string;
  result: RoomActionResult<unknown>;
  metadata?: unknown;
  recordedAt: number;
}

interface PersistedActionPayload {
  result: RoomActionResult<unknown>;
  metadata?: unknown;
}

interface PersistedActionRow {
  event: string;
  fingerprint: string;
  encrypted_payload: string;
  recorded_at: number;
}

export interface ActionLedgerOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
  databasePath?: string;
  secretBox?: SecretBox;
}

export type ActionLookup =
  | { kind: "miss" }
  | { kind: "replay"; result: RoomActionResult<unknown>; metadata?: unknown }
  | { kind: "conflict" };

export class ActionLedger {
  private readonly entries = new Map<string, ActionEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly database: DatabaseSync | null;
  private readonly secretBox: SecretBox | null;

  constructor(options?: ActionLedgerOptions);
  constructor(maxEntries?: number, ttlMs?: number, now?: () => number);
  constructor(
    optionsOrMaxEntries: ActionLedgerOptions | number = {},
    ttlMs = 15 * 60_000,
    now = Date.now
  ) {
    const options = typeof optionsOrMaxEntries === "number"
      ? { maxEntries: optionsOrMaxEntries, ttlMs, now }
      : optionsOrMaxEntries;
    this.maxEntries = options.maxEntries ?? 2_048;
    this.ttlMs = options.ttlMs ?? 15 * 60_000;
    this.now = options.now ?? Date.now;
    this.secretBox = options.secretBox ?? null;
    if (options.databasePath && !this.secretBox) {
      throw new Error("persistent action ledger requires a secret box");
    }
    if (options.databasePath && options.databasePath !== ":memory:") {
      mkdirSync(dirname(options.databasePath), { recursive: true });
    }
    this.database = options.databasePath ? new DatabaseSync(options.databasePath) : null;
    this.database?.exec(`
      CREATE TABLE IF NOT EXISTS action_ledger (
        scope TEXT NOT NULL,
        action_id TEXT NOT NULL,
        event TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        encrypted_payload TEXT NOT NULL,
        recorded_at INTEGER NOT NULL,
        PRIMARY KEY (scope, action_id)
      );
      CREATE INDEX IF NOT EXISTS action_ledger_recorded_at
        ON action_ledger (recorded_at)
    `);
    this.enforceCapacity();
  }

  lookup(
    scope: string,
    event: string,
    actionId: ActionId,
    fingerprint: string
  ): ActionLookup {
    this.prune();
    const key = this.key(scope, actionId);
    const entry = this.entries.get(key) ?? this.readPersistentEntry(scope, actionId);
    if (!entry) return { kind: "miss" };
    if (entry.event !== event || entry.fingerprint !== fingerprint) return { kind: "conflict" };
    return entry.metadata === undefined
      ? { kind: "replay", result: entry.result }
      : { kind: "replay", result: entry.result, metadata: entry.metadata };
  }

  record(
    scope: string,
    event: string,
    actionId: ActionId,
    fingerprint: string,
    result: RoomActionResult<unknown>,
    metadata?: unknown
  ): void {
    this.prune();
    const entry: ActionEntry = {
      actionId,
      event,
      fingerprint,
      result,
      ...(metadata === undefined ? {} : { metadata }),
      recordedAt: this.now()
    };
    this.writePersistentEntry(scope, entry);
    this.entries.set(this.key(scope, actionId), entry);
    this.enforceCapacity();
  }

  setMetadata(scope: string, actionId: ActionId, metadata: unknown): boolean {
    this.prune();
    const key = this.key(scope, actionId);
    const entry = this.entries.get(key) ?? this.readPersistentEntry(scope, actionId);
    if (!entry) return false;
    entry.metadata = metadata;
    this.writePersistentEntry(scope, entry);
    this.entries.set(key, entry);
    return true;
  }

  size(): number {
    this.prune();
    if (!this.database) return this.entries.size;
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM action_ledger").get() as {
      count: number | bigint;
    };
    return Number(row.count);
  }

  close(): void {
    this.database?.close();
  }

  private prune(): void {
    const expiresBefore = this.now() - this.ttlMs;
    for (const [key, entry] of this.entries) {
      if (entry.recordedAt < expiresBefore) this.entries.delete(key);
    }
    this.database?.prepare("DELETE FROM action_ledger WHERE recorded_at < ?").run(expiresBefore);
    this.enforceCapacity();
  }

  private enforceCapacity(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    if (!this.database) return;
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM action_ledger").get() as {
      count: number | bigint;
    };
    const excess = Number(row.count) - this.maxEntries;
    if (excess <= 0) return;
    this.database.prepare(`
      DELETE FROM action_ledger
      WHERE rowid IN (
        SELECT rowid
        FROM action_ledger
        ORDER BY recorded_at ASC, rowid ASC
        LIMIT ?
      )
    `).run(excess);
  }

  private readPersistentEntry(scope: string, actionId: ActionId): ActionEntry | null {
    if (!this.database) return null;
    const row = this.database.prepare(`
      SELECT event, fingerprint, encrypted_payload, recorded_at
      FROM action_ledger
      WHERE scope = ? AND action_id = ?
    `).get(scope, actionId) as PersistedActionRow | undefined;
    if (!row) return null;
    const payload = this.openPayload(scope, actionId, row.encrypted_payload);
    const entry: ActionEntry = {
      actionId,
      event: row.event,
      fingerprint: row.fingerprint,
      result: payload.result,
      ...(payload.metadata === undefined ? {} : { metadata: payload.metadata }),
      recordedAt: row.recorded_at
    };
    this.entries.set(this.key(scope, actionId), entry);
    this.enforceCapacity();
    return entry;
  }

  private writePersistentEntry(scope: string, entry: ActionEntry): void {
    if (!this.database) return;
    const payload: PersistedActionPayload = {
      result: entry.result,
      ...(entry.metadata === undefined ? {} : { metadata: entry.metadata })
    };
    const encryptedPayload = this.sealPayload(scope, entry.actionId, payload);
    this.database.prepare(`
      INSERT INTO action_ledger (
        scope, action_id, event, fingerprint, encrypted_payload, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, action_id) DO UPDATE SET
        event = excluded.event,
        fingerprint = excluded.fingerprint,
        encrypted_payload = excluded.encrypted_payload,
        recorded_at = excluded.recorded_at
    `).run(
      scope,
      entry.actionId,
      entry.event,
      entry.fingerprint,
      encryptedPayload,
      entry.recordedAt
    );
  }

  private sealPayload(scope: string, actionId: ActionId, payload: PersistedActionPayload): string {
    if (!this.secretBox) throw new Error("persistent action ledger requires a secret box");
    return JSON.stringify(this.secretBox.seal(
      this.purpose(scope, actionId),
      JSON.stringify(payload)
    ));
  }

  private openPayload(scope: string, actionId: ActionId, encryptedPayload: string): PersistedActionPayload {
    if (!this.secretBox) throw new Error("persistent action ledger requires a secret box");
    let encrypted: EncryptedSecret;
    try {
      encrypted = JSON.parse(encryptedPayload) as EncryptedSecret;
    } catch {
      throw new Error("invalid persisted action ledger payload");
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(this.secretBox.open(this.purpose(scope, actionId), encrypted));
    } catch {
      throw new Error("invalid persisted action ledger payload");
    }
    if (!isPersistedActionPayload(decoded)) {
      throw new Error("invalid persisted action ledger payload");
    }
    return decoded;
  }

  private purpose(scope: string, actionId: ActionId): string {
    return `action-ledger:${scope}:${actionId}`;
  }

  private key(scope: string, actionId: ActionId): string {
    return `${scope}:${actionId}`;
  }
}

export function actionFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(stableSerialize(value), "utf8")
    .digest("hex");
}

function isPersistedActionPayload(value: unknown): value is PersistedActionPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const result = (value as Record<string, unknown>).result;
  return typeof result === "object"
    && result !== null
    && !Array.isArray(result)
    && typeof (result as Record<string, unknown>).ok === "boolean";
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableSerialize(record[key])}`
  )).join(",")}}`;
}
