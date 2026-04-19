import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { createSqliteClient } from "./client";
import { persistDatabaseSnapshot, restoreDatabaseFromStorageIfNeeded } from "../storage/s3-storage";

const currentFile = fileURLToPath(import.meta.url);
const migrationsDirectory = path.join(path.dirname(currentFile), "migrations");

export function runMigrations(sqlite: Database.Database = createSqliteClient()) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    sqlite.prepare("SELECT name FROM schema_migrations").all().map((row) => {
      return (row as { name: string }).name;
    })
  );

  const migrationFiles = fs
    .readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const insertMigration = sqlite.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)"
  );

  for (const file of migrationFiles) {
    if (applied.has(file)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDirectory, file), "utf8");

    // PRAGMA foreign_keys in .sql is ignored inside BEGIN TRANSACTION; some migrations
    // (e.g. rebuilding `users`) must run with FK checks off for the whole batch.
    sqlite.pragma("foreign_keys = OFF");
    try {
      sqlite.transaction(() => {
        sqlite.exec(sql);
        insertMigration.run(file, new Date().toISOString());
      })();
    } finally {
      sqlite.pragma("foreign_keys = ON");
    }
  }
}

const entrypoint = process.argv[1] ? path.basename(process.argv[1]) : "";

if (entrypoint === "migrate.ts" || entrypoint === "migrate.js") {
  await restoreDatabaseFromStorageIfNeeded();
  const sqlite = createSqliteClient();
  runMigrations(sqlite);
  await persistDatabaseSnapshot(sqlite);
  sqlite.close();
  console.log("Database migrations completed.");
}
