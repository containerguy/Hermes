import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getDatabasePath } from "../env";
import * as schema from "./schema";

export function createSqliteClient(databasePath = getDatabasePath()) {
  const directory = path.dirname(databasePath);
  fs.mkdirSync(directory, { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  return sqlite;
}

export function createDb(databasePath = getDatabasePath()) {
  const sqlite = createSqliteClient(databasePath);

  return {
    sqlite,
    db: drizzle(sqlite, { schema })
  };
}

export type DatabaseContext = ReturnType<typeof createDb>;
