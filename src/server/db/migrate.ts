import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { createSqliteClient } from "./client";

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

    sqlite.transaction(() => {
      sqlite.exec(sql);
      insertMigration.run(file, new Date().toISOString());
    })();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sqlite = createSqliteClient();
  runMigrations(sqlite);
  sqlite.close();
  console.log("Database migrations completed.");
}
