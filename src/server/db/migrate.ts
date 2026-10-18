import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { createSqliteClient } from "./client";
import { persistDatabaseSnapshot, restoreDatabaseFromStorageIfNeeded } from "../storage/s3-storage";

const currentFile = fileURLToPath(import.meta.url);
const migrationsDirectory = path.join(path.dirname(currentFile), "migrations");

function countForeignKeyViolations(sqlite: Database.Database) {
  return sqlite.prepare("PRAGMA foreign_key_check").all().length;
}

export function runMigrations(
  sqlite: Database.Database = createSqliteClient(),
  directory: string = migrationsDirectory
) {
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
    .readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const insertMigration = sqlite.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)"
  );

  for (const file of migrationFiles) {
    if (applied.has(file)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(directory, file), "utf8");

    // PRAGMA foreign_keys in .sql is ignored inside BEGIN TRANSACTION; some migrations
    // (e.g. rebuilding `users`) must run with FK checks off for the whole batch.
    sqlite.pragma("foreign_keys = OFF");
    try {
      sqlite.transaction(() => {
        // Mit abgeschalteten Fremdschlüsseln fällt ein verlorener Verweis (z. B. beim Neuaufbau
        // einer Tabelle) nicht auf. Darum vorher/nachher zählen: Neue Verletzungen rollen die
        // Migration zurück. Altlasten vor der Migration blockieren den Start nicht.
        const before = countForeignKeyViolations(sqlite);
        sqlite.exec(sql);
        const after = countForeignKeyViolations(sqlite);
        if (after > before) {
          throw new Error(
            `[Hermes] Migration ${file} würde ${after - before} Fremdschlüssel-Verletzung(en) erzeugen und wurde zurückgerollt.`
          );
        }
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
