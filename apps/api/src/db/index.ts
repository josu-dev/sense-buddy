import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../env";
import * as schema from "./schema";
import { runMigrations } from "./migrations";

mkdirSync(dirname(env.databasePath), { recursive: true });
const sqlite = new Database(env.databasePath);
sqlite.pragma("journal_mode = WAL");

// Explicit `pnpm migrate` and boot share this (see src/db/migrations.ts).
runMigrations(sqlite);

export const db = drizzle(sqlite, { schema });
export { schema };
