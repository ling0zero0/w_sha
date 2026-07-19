import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  chatModeSchema,
  chatMessageSchema,
  roleConfigurationSchema,
  roomCodeSchema,
  type ChatMessage,
  type ChatMode,
  type GameResult,
  type RoleConfiguration,
  type RoleConfigurationInput
} from "@werewolf/shared";

export type ChatReader =
  | { kind: "host" }
  | { kind: "player"; canReadWolfPrivate: boolean };

export interface GameSession {
  id: string;
  roomCode: string;
  startedAt: string;
  endedAt: string | null;
  outcome: string | null;
  roleConfiguration: RoleConfiguration;
  chatMode: ChatMode;
}

export interface CreateSessionInput {
  id: string;
  roomCode: string;
  startedAt: string;
  roleConfiguration: RoleConfigurationInput;
  chatMode?: ChatMode;
}

export interface FinishSessionInput {
  endedAt: string;
  outcome: NonNullable<GameResult>["outcome"];
}

export interface ChatMessagePage {
  messages: ChatMessage[];
  latestSequence: number;
  hasMore: boolean;
}

interface SessionRow {
  id: string;
  room_code: string;
  started_at: string;
  ended_at: string | null;
  outcome: string | null;
  role_configuration_json: string;
  chat_mode: string;
}

interface MessageRow {
  id: string;
  session_id?: string;
  sequence: number;
  channel: string;
  day: number;
  phase: string;
  sender_json: string;
  content_json: string;
  created_at: string;
}

function assertIsoDateTime(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value)) || !value.includes("T")) {
    throw new Error(`${field} must be an ISO date-time`);
  }
}

function parseSession(row: SessionRow): GameSession {
  return {
    id: row.id,
    roomCode: roomCodeSchema.parse(row.room_code),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    outcome: row.outcome,
    roleConfiguration: roleConfigurationSchema.parse(JSON.parse(row.role_configuration_json)),
    chatMode: chatModeSchema.parse(row.chat_mode)
  };
}

function sessionMetadataEqual(
  session: GameSession,
  input: {
    roomCode: string;
    startedAt: string;
    roleConfiguration: RoleConfiguration;
    chatMode: ChatMode;
  }
): boolean {
  return session.roomCode === input.roomCode
    && session.startedAt === input.startedAt
    && session.chatMode === input.chatMode
    && JSON.stringify(session.roleConfiguration) === JSON.stringify(input.roleConfiguration);
}

function parseMessage(row: MessageRow): ChatMessage {
  return chatMessageSchema.parse({
    id: row.id,
    sequence: row.sequence,
    channel: row.channel,
    day: row.day,
    phase: row.phase,
    sender: JSON.parse(row.sender_json),
    content: JSON.parse(row.content_json),
    createdAt: row.created_at
  });
}

function messagesEqual(left: ChatMessage, right: ChatMessage): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

const sessionOutcomes = new Set<NonNullable<GameResult>["outcome"]>([
  "good-win",
  "wolf-win",
  "draw",
  "terminated"
]);

export class ChatStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS game_sessions (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        outcome TEXT,
        role_configuration_json TEXT NOT NULL,
        chat_mode TEXT NOT NULL DEFAULT 'ordered'
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        channel TEXT NOT NULL CHECK (channel IN ('day-public', 'wolf-private', 'system')),
        day INTEGER NOT NULL CHECK (day > 0),
        phase TEXT NOT NULL,
        sender_json TEXT NOT NULL,
        content_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (session_id, sequence)
      );

      CREATE INDEX IF NOT EXISTS chat_messages_session_channel_sequence_idx
      ON chat_messages (session_id, channel, sequence);
    `);
    const sessionColumns = this.database.prepare("PRAGMA table_info(game_sessions)").all() as unknown as
      Array<{ name: string }>;
    if (!sessionColumns.some((column) => column.name === "chat_mode")) {
      this.database.exec(`
        ALTER TABLE game_sessions
        ADD COLUMN chat_mode TEXT NOT NULL DEFAULT 'ordered'
      `);
    }
  }

  createSession(input: CreateSessionInput): GameSession {
    if (!input.id.trim()) throw new Error("session id must not be empty");
    const roomCode = roomCodeSchema.parse(input.roomCode);
    const roleConfiguration = roleConfigurationSchema.parse(input.roleConfiguration);
    const chatMode = chatModeSchema.parse(input.chatMode);
    assertIsoDateTime(input.startedAt, "startedAt");

    try {
      this.database.prepare(`
        INSERT INTO game_sessions (
          id,
          room_code,
          started_at,
          role_configuration_json,
          chat_mode
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        input.id,
        roomCode,
        input.startedAt,
        JSON.stringify(roleConfiguration),
        chatMode
      );

      return {
        id: input.id,
        roomCode,
        startedAt: input.startedAt,
        endedAt: null,
        outcome: null,
        roleConfiguration,
        chatMode
      };
    } catch (error) {
      const existingRow = this.database.prepare(`
        SELECT id, room_code, started_at, ended_at, outcome, role_configuration_json, chat_mode
        FROM game_sessions
        WHERE id = ?
      `).get(input.id) as unknown as SessionRow | undefined;
      if (!existingRow) {
        throw new Error(`could not create chat session ${input.id}`, { cause: error });
      }

      const existing = parseSession(existingRow);
      if (sessionMetadataEqual(existing, {
        roomCode,
        startedAt: input.startedAt,
        roleConfiguration,
        chatMode
      })) return existing;
      throw new Error(`chat session id conflict: ${input.id}`, { cause: error });
    }
  }

  getSession(sessionId: string): GameSession | null {
    const row = this.database.prepare(`
      SELECT id, room_code, started_at, ended_at, outcome, role_configuration_json, chat_mode
      FROM game_sessions
      WHERE id = ?
    `).get(sessionId) as unknown as SessionRow | undefined;
    return row ? parseSession(row) : null;
  }

  finishSession(sessionId: string, input: FinishSessionInput): GameSession {
    assertIsoDateTime(input.endedAt, "endedAt");
    if (!sessionOutcomes.has(input.outcome)) throw new Error("invalid game outcome");

    const result = this.database.prepare(`
      UPDATE game_sessions
      SET ended_at = ?, outcome = ?
      WHERE id = ?
    `).run(input.endedAt, input.outcome, sessionId);
    if (result.changes === 0) throw new Error(`chat session not found: ${sessionId}`);

    const row = this.database.prepare(`
      SELECT id, room_code, started_at, ended_at, outcome, role_configuration_json, chat_mode
      FROM game_sessions
      WHERE id = ?
    `).get(sessionId) as unknown as SessionRow;
    return parseSession(row);
  }

  appendMessage(sessionId: string, rawMessage: ChatMessage): ChatMessage {
    const message = chatMessageSchema.parse(rawMessage);

    try {
      this.insertMessage(sessionId, message);
      return message;
    } catch (error) {
      const existingRow = this.database.prepare(`
        SELECT id, session_id, sequence, channel, day, phase, sender_json, content_json, created_at
        FROM chat_messages
        WHERE id = ?
      `).get(message.id) as MessageRow | undefined;

      if (existingRow) {
        const existing = parseMessage(existingRow);
        if (existingRow.session_id === sessionId && messagesEqual(existing, message)) {
          return existing;
        }
        throw new Error(`chat message id conflict: ${message.id}`, { cause: error });
      }

      throw new Error(
        `could not append chat message ${message.id} to session ${sessionId}`,
        { cause: error }
      );
    }
  }

  importMessages(sessionId: string, rawMessages: readonly ChatMessage[]): ChatMessage[] {
    const messages = rawMessages.map((message) => chatMessageSchema.parse(message));
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const imported = messages.map((message) => this.appendMessage(sessionId, message));
      this.database.exec("COMMIT");
      return imported;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  loadRecentForRecovery(
    sessionId: string,
    limit = 300
  ): ChatMessage[] {
    this.assertRecoveryLimit(limit);
    const rows = this.database.prepare(`
      SELECT id, sequence, channel, day, phase, sender_json, content_json, created_at
      FROM (
        SELECT id, sequence, channel, day, phase, sender_json, content_json, created_at
        FROM chat_messages
        WHERE session_id = ?
        ORDER BY sequence DESC
        LIMIT ?
      )
      ORDER BY sequence ASC
    `).all(sessionId, limit) as unknown as MessageRow[];
    return rows.map(parseMessage);
  }

  queryAfter(
    sessionId: string,
    reader: ChatReader,
    afterSequence: number,
    limit: number
  ): ChatMessagePage {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new Error("afterSequence must be a nonnegative safe integer");
    }
    this.assertQueryLimit(limit);

    const { clause, parameters } = this.readerClause(reader);
    const rows = this.database.prepare(`
      SELECT id, sequence, channel, day, phase, sender_json, content_json, created_at
      FROM chat_messages
      WHERE session_id = ?
        AND sequence > ?
        AND ${clause}
      ORDER BY sequence ASC
      LIMIT ?
    `).all(
      sessionId,
      afterSequence,
      ...parameters,
      limit + 1
    ) as unknown as MessageRow[];

    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).map(parseMessage);
    let latestSequence = messages.at(-1)?.sequence ?? afterSequence;

    if (!hasMore) {
      const latestRow = this.database.prepare(`
        SELECT MAX(sequence) AS latest_sequence
        FROM chat_messages
        WHERE session_id = ?
      `).get(sessionId) as { latest_sequence: number | null };
      latestSequence = Math.max(latestSequence, latestRow.latest_sequence ?? 0);
    }

    return { messages, latestSequence, hasMore };
  }

  close(): void {
    this.database.close();
  }

  private insertMessage(sessionId: string, message: ChatMessage): void {
    this.database.prepare(`
      INSERT INTO chat_messages (
        id,
        session_id,
        sequence,
        channel,
        day,
        phase,
        sender_json,
        content_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      sessionId,
      message.sequence,
      message.channel,
      message.day,
      message.phase,
      JSON.stringify(message.sender),
      JSON.stringify(message.content),
      message.createdAt
    );
  }

  private readerClause(reader: ChatReader): { clause: string; parameters: string[] } {
    if (reader.kind === "host") {
      return {
        clause: "channel IN (?, ?)",
        parameters: ["day-public", "system"]
      };
    }
    if (reader.kind === "player" && reader.canReadWolfPrivate) {
      return {
        clause: "channel IN (?, ?, ?)",
        parameters: ["day-public", "system", "wolf-private"]
      };
    }
    if (reader.kind === "player") {
      return {
        clause: "channel IN (?, ?)",
        parameters: ["day-public", "system"]
      };
    }
    throw new Error("unsupported chat reader");
  }

  private assertQueryLimit(limit: number): void {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("limit must be an integer between 1 and 100");
    }
  }

  private assertRecoveryLimit(limit: number): void {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error("recovery limit must be an integer between 1 and 1000");
    }
  }
}
