import { createHash } from "node:crypto";
import type { ActionId, RoomActionResult } from "@werewolf/shared";

interface ActionEntry {
  actionId: ActionId;
  event: string;
  fingerprint: string;
  result: RoomActionResult<unknown>;
  metadata?: unknown;
  recordedAt: number;
}

export type ActionLookup =
  | { kind: "miss" }
  | { kind: "replay"; result: RoomActionResult<unknown>; metadata?: unknown }
  | { kind: "conflict" };

export class ActionLedger {
  private readonly entries = new Map<string, ActionEntry>();

  constructor(
    private readonly maxEntries = 2_048,
    private readonly ttlMs = 15 * 60_000,
    private readonly now = Date.now
  ) {}

  lookup(
    scope: string,
    event: string,
    actionId: ActionId,
    fingerprint: string
  ): ActionLookup {
    this.prune();
    const key = this.key(scope, actionId);
    const entry = this.entries.get(key);
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
    this.entries.set(this.key(scope, actionId), {
      actionId,
      event,
      fingerprint,
      result,
      ...(metadata === undefined ? {} : { metadata }),
      recordedAt: this.now()
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  setMetadata(scope: string, actionId: ActionId, metadata: unknown): boolean {
    this.prune();
    const entry = this.entries.get(this.key(scope, actionId));
    if (!entry) return false;
    entry.metadata = metadata;
    return true;
  }

  size(): number {
    this.prune();
    return this.entries.size;
  }

  private prune(): void {
    const expiresBefore = this.now() - this.ttlMs;
    for (const [key, entry] of this.entries) {
      if (entry.recordedAt < expiresBefore) this.entries.delete(key);
    }
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

function stableSerialize(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableSerialize(record[key])}`
  )).join(",")}}`;
}
