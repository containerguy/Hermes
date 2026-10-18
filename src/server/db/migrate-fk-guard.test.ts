import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate";

let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-migrations-"));
  fs.writeFileSync(
    path.join(directory, "0001_tables.sql"),
    "CREATE TABLE parent (id TEXT PRIMARY KEY); CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent(id));" +
      "INSERT INTO parent (id) VALUES ('p1'); INSERT INTO child (id, parent_id) VALUES ('c1', 'p1');"
  );
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

function applied(sqlite: Database.Database) {
  return (sqlite.prepare("SELECT name FROM schema_migrations ORDER BY name").all() as Array<{ name: string }>).map(
    (row) => row.name
  );
}

describe("Migrations-Runner: Fremdschlüssel-Wächter", () => {
  it("rollt eine Migration zurück, die Verweise verliert", () => {
    // Neuaufbau, der die Elterntabelle leert (wie ein fehlerhafter Neuaufbau mit abgeschalteten FKs)
    fs.writeFileSync(
      path.join(directory, "0002_broken_rebuild.sql"),
      "CREATE TABLE parent__new (id TEXT PRIMARY KEY); DROP TABLE parent; ALTER TABLE parent__new RENAME TO parent;"
    );
    const sqlite = new Database(":memory:");
    expect(() => runMigrations(sqlite, directory)).toThrow(/0002_broken_rebuild\.sql.*Fremdschlüssel/);
    expect(applied(sqlite)).toEqual(["0001_tables.sql"]);
    expect(sqlite.prepare("SELECT id FROM parent").all()).toEqual([{ id: "p1" }]);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    sqlite.close();
  });

  it("lässt Altlasten von vor der Migration zu", () => {
    const sqlite = new Database(":memory:");
    runMigrations(sqlite, directory);
    sqlite.pragma("foreign_keys = OFF");
    sqlite.prepare("INSERT INTO child (id, parent_id) VALUES ('c2', 'fehlt')").run();
    sqlite.pragma("foreign_keys = ON");
    fs.writeFileSync(path.join(directory, "0002_harmless.sql"), "CREATE TABLE other (id TEXT PRIMARY KEY);");
    runMigrations(sqlite, directory);
    expect(applied(sqlite)).toEqual(["0001_tables.sql", "0002_harmless.sql"]);
    sqlite.close();
  });
});
