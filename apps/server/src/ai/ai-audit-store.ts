import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";

export type AiDecisionAttemptStatus =
  | "success"
  | "provider-unavailable"
  | "provider-error"
  | "invalid-response"
  | "budget-exhausted"
  | "fallback";

export interface AiDecisionAttemptRecord {
  id: string;
  gameSessionId: string | null;
  playerId: string;
  decisionKey: string;
  roomRevision: number;
  botProfileId: string | null;
  botProfileRevision: number | null;
  modelProfileId: string | null;
  modelProfileRevision: number | null;
  providerId: string | null;
  model: string | null;
  status: AiDecisionAttemptStatus;
  intentType: string | null;
  latencyMs: number | null;
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
}

export interface AiUsageEventRecord {
  id: string;
  decisionId: string;
  gameSessionId: string | null;
  playerId: string;
  botProfileId: string | null;
  modelProfileId: string;
  modelProfileRevision: number | null;
  providerId: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  createdAt: string;
}

export class AiAuditStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS ai_decision_attempts (
        id TEXT PRIMARY KEY,
        game_session_id TEXT,
        player_id TEXT NOT NULL,
        decision_key TEXT NOT NULL,
        room_revision INTEGER NOT NULL,
        bot_profile_id TEXT,
        bot_profile_revision INTEGER,
        model_profile_id TEXT,
        model_profile_revision INTEGER,
        provider_id TEXT,
        model TEXT,
        status TEXT NOT NULL,
        intent_type TEXT,
        latency_ms INTEGER,
        error_code TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_usage_events (
        id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL REFERENCES ai_decision_attempts(id) ON DELETE CASCADE,
        game_session_id TEXT,
        player_id TEXT NOT NULL,
        bot_profile_id TEXT,
        model_profile_id TEXT NOT NULL,
        model_profile_revision INTEGER,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ai_decision_attempts_game
        ON ai_decision_attempts(game_session_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_ai_usage_events_game
        ON ai_usage_events(game_session_id, created_at);
    `);
  }

  close(): void {
    this.database.close();
  }

  recordAttempt(input: Omit<AiDecisionAttemptRecord, "id">): string {
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO ai_decision_attempts (
        id,
        game_session_id,
        player_id,
        decision_key,
        room_revision,
        bot_profile_id,
        bot_profile_revision,
        model_profile_id,
        model_profile_revision,
        provider_id,
        model,
        status,
        intent_type,
        latency_ms,
        error_code,
        started_at,
        completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.gameSessionId,
      input.playerId,
      input.decisionKey,
      input.roomRevision,
      input.botProfileId,
      input.botProfileRevision,
      input.modelProfileId,
      input.modelProfileRevision,
      input.providerId,
      input.model,
      input.status,
      input.intentType,
      input.latencyMs,
      input.errorCode,
      input.startedAt,
      input.completedAt
    );
    return id;
  }

  recordUsage(input: Omit<AiUsageEventRecord, "id">): string {
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO ai_usage_events (
        id,
        decision_id,
        game_session_id,
        player_id,
        bot_profile_id,
        model_profile_id,
        model_profile_revision,
        provider_id,
        model,
        input_tokens,
        output_tokens,
        total_tokens,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.decisionId,
      input.gameSessionId,
      input.playerId,
      input.botProfileId,
      input.modelProfileId,
      input.modelProfileRevision,
      input.providerId,
      input.model,
      input.inputTokens,
      input.outputTokens,
      input.totalTokens,
      input.createdAt
    );
    return id;
  }

  listAttempts(limit = 100): AiDecisionAttemptRecord[] {
    const rows = this.database.prepare(`
      SELECT
        id,
        game_session_id,
        player_id,
        decision_key,
        room_revision,
        bot_profile_id,
        bot_profile_revision,
        model_profile_id,
        model_profile_revision,
        provider_id,
        model,
        status,
        intent_type,
        latency_ms,
        error_code,
        started_at,
        completed_at
      FROM ai_decision_attempts
      ORDER BY started_at DESC, id DESC
      LIMIT ?
    `).all(normalizeLimit(limit)) as unknown as AiDecisionAttemptRow[];
    return rows.map(parseAttempt);
  }

  listUsage(limit = 100): AiUsageEventRecord[] {
    const rows = this.database.prepare(`
      SELECT
        id,
        decision_id,
        game_session_id,
        player_id,
        bot_profile_id,
        model_profile_id,
        model_profile_revision,
        provider_id,
        model,
        input_tokens,
        output_tokens,
        total_tokens,
        created_at
      FROM ai_usage_events
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(normalizeLimit(limit)) as unknown as AiUsageEventRow[];
    return rows.map(parseUsage);
  }
}

interface AiDecisionAttemptRow {
  id: string;
  game_session_id: string | null;
  player_id: string;
  decision_key: string;
  room_revision: number;
  bot_profile_id: string | null;
  bot_profile_revision: number | null;
  model_profile_id: string | null;
  model_profile_revision: number | null;
  provider_id: string | null;
  model: string | null;
  status: AiDecisionAttemptStatus;
  intent_type: string | null;
  latency_ms: number | null;
  error_code: string | null;
  started_at: string;
  completed_at: string;
}

interface AiUsageEventRow {
  id: string;
  decision_id: string;
  game_session_id: string | null;
  player_id: string;
  bot_profile_id: string | null;
  model_profile_id: string;
  model_profile_revision: number | null;
  provider_id: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  created_at: string;
}

function parseAttempt(row: AiDecisionAttemptRow): AiDecisionAttemptRecord {
  return {
    id: row.id,
    gameSessionId: row.game_session_id,
    playerId: row.player_id,
    decisionKey: row.decision_key,
    roomRevision: row.room_revision,
    botProfileId: row.bot_profile_id,
    botProfileRevision: row.bot_profile_revision,
    modelProfileId: row.model_profile_id,
    modelProfileRevision: row.model_profile_revision,
    providerId: row.provider_id,
    model: row.model,
    status: row.status,
    intentType: row.intent_type,
    latencyMs: row.latency_ms,
    errorCode: row.error_code,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

function parseUsage(row: AiUsageEventRow): AiUsageEventRecord {
  return {
    id: row.id,
    decisionId: row.decision_id,
    gameSessionId: row.game_session_id,
    playerId: row.player_id,
    botProfileId: row.bot_profile_id,
    modelProfileId: row.model_profile_id,
    modelProfileRevision: row.model_profile_revision,
    providerId: row.provider_id,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    createdAt: row.created_at
  };
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.min(500, Math.max(1, Math.trunc(limit)));
}
