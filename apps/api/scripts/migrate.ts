/**
 * Explicit local migration: `pnpm --filter @sense-buddy/api migrate`
 * (or `pnpm db:migrate` from the repo root).
 *
 * Creates/updates the SQLite file at DATABASE_PATH (default
 * ./data/sense-buddy.db) without starting the API. Idempotent — safe to
 * re-run. `pnpm migrate -- --reset` deletes the file first (fresh local DB).
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "../src/env";
import { runMigrations } from "../src/db/migrations";

const reset = process.argv.includes("--reset");
const dbPath = resolve(env.databasePath);

if (reset && existsSync(dbPath)) {
  rmSync(dbPath);
  // WAL sidecars from a previous run — remove if present.
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecar = `${dbPath}${suffix}`;
    if (existsSync(sidecar)) rmSync(sidecar);
  }
  console.log(`Removed ${dbPath} (--reset)`);
}

mkdirSync(dirname(dbPath), { recursive: true });
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
runMigrations(sqlite);

const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(
  (r) => r.name,
);
sqlite.close();

console.log(`${reset ? "Reset + migrated" : "Migrated"} ${dbPath}`);
console.log(`Tables: ${tables.join(", ")}`);
