import type Database from "better-sqlite3";
import type { TarEntry } from "./tar";

export class ModuleMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleMigrationError";
  }
}

type SchemaObject = { type: string; name: string; tbl_name: string; sql: string | null };

function readSchema(sqlite: Database.Database) {
  const rows = sqlite
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
    .all() as SchemaObject[];
  return new Map(rows.map((row) => [`${row.type}:${row.name}`, row]));
}

/**
 * Nur Tabellen mit dem Präfix des Moduls dürfen angelegt, geändert oder gelöscht werden.
 * `allowedForeignTables` ist eine fest im Kern hinterlegte Ausnahme (z. B. für die AMP-Entkopplung).
 */
function checkSchemaChanges(
  moduleId: string,
  before: Map<string, SchemaObject>,
  after: Map<string, SchemaObject>,
  allowedForeignTables: readonly string[]
) {
  const prefix = `${moduleId}_`;
  const owns = (object: SchemaObject) =>
    object.tbl_name.startsWith(prefix) || object.name.startsWith(prefix) || allowedForeignTables.includes(object.tbl_name);
  const violations: string[] = [];
  for (const [key, object] of after) {
    const previous = before.get(key);
    if ((!previous || previous.sql !== object.sql) && !owns(object)) {
      violations.push(`${object.type} ${object.name}`);
    }
  }
  for (const [key, object] of before) {
    if (!after.has(key) && !owns(object)) {
      violations.push(`${object.type} ${object.name} (gelöscht)`);
    }
  }
  return violations;
}

function countForeignKeyViolations(sqlite: Database.Database) {
  return sqlite.prepare("PRAGMA foreign_key_check").all().length;
}

export function moduleMigrationFiles(files: TarEntry[] | Map<string, Buffer>) {
  const entries = files instanceof Map ? [...files.entries()].map(([path, data]) => ({ path, data })) : files;
  return entries
    .filter((entry) => /^migrations\/[^/]+\.sql$/.test(entry.path))
    .map((entry) => ({ name: entry.path.slice("migrations/".length), sql: entry.data.toString("utf8") }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function appliedModuleMigrations(sqlite: Database.Database, moduleId: string) {
  return (
    sqlite.prepare("SELECT name FROM schema_migrations WHERE name LIKE ? ESCAPE '\\'").all(`${moduleId.replace(/_/g, "\\_")}/%`) as Array<{
      name: string;
    }>
  ).map((row) => row.name.slice(moduleId.length + 1));
}

/**
 * Führt die noch fehlenden Migrationen eines Moduls aus, jede in eigener Transaktion, und vermerkt
 * sie in `schema_migrations` als `<id>/<datei>`. Greift eine Migration auf fremde Tabellen zu oder
 * erzeugt neue Fremdschlüssel-Verletzungen, wird sie zurückgerollt.
 */
export function runModuleMigrations(
  sqlite: Database.Database,
  moduleId: string,
  migrations: Array<{ name: string; sql: string }>,
  allowedForeignTables: readonly string[] = []
) {
  const applied = new Set(appliedModuleMigrations(sqlite, moduleId));
  const insert = sqlite.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)");
  const ran: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    sqlite.pragma("foreign_keys = OFF");
    try {
      sqlite.transaction(() => {
        const schemaBefore = readSchema(sqlite);
        const fkBefore = countForeignKeyViolations(sqlite);
        sqlite.exec(migration.sql);
        const violations = checkSchemaChanges(moduleId, schemaBefore, readSchema(sqlite), allowedForeignTables);
        if (violations.length > 0) {
          throw new ModuleMigrationError(
            `Migration ${moduleId}/${migration.name} ändert fremde Tabellen: ${violations.join(", ")}`
          );
        }
        const fkAfter = countForeignKeyViolations(sqlite);
        if (fkAfter > fkBefore) {
          throw new ModuleMigrationError(
            `Migration ${moduleId}/${migration.name} würde ${fkAfter - fkBefore} Fremdschlüssel-Verletzung(en) erzeugen.`
          );
        }
        insert.run(`${moduleId}/${migration.name}`, new Date().toISOString());
      })();
    } finally {
      sqlite.pragma("foreign_keys = ON");
    }
    ran.push(migration.name);
  }
  return ran;
}

/** Löscht die Tabellen des Moduls über uninstall.sql und prüft, dass nichts mit dem Präfix übrig ist. */
export function runModuleUninstall(sqlite: Database.Database, moduleId: string, uninstallSql: string | undefined, tables: string[]) {
  sqlite.pragma("foreign_keys = OFF");
  try {
    sqlite.transaction(() => {
      const schemaBefore = readSchema(sqlite);
      if (uninstallSql?.trim()) {
        sqlite.exec(uninstallSql);
      } else {
        for (const table of [...tables].reverse()) {
          sqlite.exec(`DROP TABLE IF EXISTS "${table}"`);
        }
      }
      const violations = checkSchemaChanges(moduleId, schemaBefore, readSchema(sqlite), []);
      if (violations.length > 0) {
        throw new ModuleMigrationError(`uninstall.sql von ${moduleId} ändert fremde Tabellen: ${violations.join(", ")}`);
      }
      const leftovers = (
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ? ESCAPE '\\'")
          .all(`${moduleId.replace(/_/g, "\\_")}\\_%`) as Array<{ name: string }>
      ).map((row) => row.name);
      if (leftovers.length > 0) {
        throw new ModuleMigrationError(`Nach der Deinstallation sind noch Tabellen übrig: ${leftovers.join(", ")}`);
      }
      sqlite
        .prepare("DELETE FROM schema_migrations WHERE name LIKE ? ESCAPE '\\'")
        .run(`${moduleId.replace(/_/g, "\\_")}/%`);
      if (countForeignKeyViolations(sqlite) > 0) {
        throw new ModuleMigrationError("Deinstallation würde Fremdschlüssel-Verletzungen hinterlassen.");
      }
    })();
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
}
