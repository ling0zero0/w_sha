import type { DatabaseSync } from "node:sqlite";

interface Migration {
  version: number;
  sql: string;
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE ai_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        protocol TEXT NOT NULL CHECK (protocol = 'openai-compatible-chat'),
        base_url TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE ai_provider_secrets (
        provider_id TEXT PRIMARY KEY
          REFERENCES ai_providers(id) ON DELETE CASCADE,
        key_version INTEGER NOT NULL CHECK (key_version > 0),
        ciphertext BLOB NOT NULL,
        nonce BLOB NOT NULL,
        auth_tag BLOB NOT NULL,
        credential_hint TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE ai_model_profiles (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL REFERENCES ai_providers(id),
        name TEXT NOT NULL UNIQUE,
        model TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        temperature REAL,
        max_output_tokens INTEGER NOT NULL,
        request_timeout_ms INTEGER NOT NULL,
        max_attempts_per_turn INTEGER NOT NULL,
        game_token_budget INTEGER NOT NULL,
        fallback_model_profile_id TEXT REFERENCES ai_model_profiles(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE ai_bot_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        default_nickname TEXT NOT NULL,
        description TEXT NOT NULL,
        personality_prompt TEXT NOT NULL,
        speaking_style TEXT NOT NULL,
        strategy TEXT NOT NULL CHECK (strategy IN ('cautious', 'balanced', 'aggressive')),
        model_profile_id TEXT NOT NULL REFERENCES ai_model_profiles(id),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  }
];

export function runAiConfigMigrations(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = database.prepare(`
    SELECT version
    FROM schema_migrations
  `).all() as unknown as Array<{ version: number }>;
  const appliedVersions = new Set(appliedRows.map((row) => row.version));

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database.prepare(`
        INSERT INTO schema_migrations (version, applied_at)
        VALUES (?, ?)
      `).run(migration.version, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
