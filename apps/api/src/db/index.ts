import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../env";
import * as schema from "./schema";

mkdirSync(dirname(env.databasePath), { recursive: true });
const sqlite = new Database(env.databasePath);
sqlite.pragma("journal_mode = WAL");

// Hackathon-friendly: idempotent DDL instead of a migration toolchain.
sqlite.exec(`
CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ip_address TEXT, user_agent TEXT, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS account (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at INTEGER, refresh_token_expires_at INTEGER, scope TEXT, password TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS preference (user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, mode TEXT NOT NULL DEFAULT 'visual', voice_rate REAL NOT NULL DEFAULT 1, haptics_enabled INTEGER NOT NULL DEFAULT 1, caption_size TEXT NOT NULL DEFAULT 'xlarge', high_contrast INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS usage_event (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, route TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, total_tokens INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_usage_user_day ON usage_event(user_id, created_at);
`);

export const db = drizzle(sqlite, { schema });
export { schema };
