import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrate";
import { restorableTables } from "./s3-storage";

describe("restorable tables", () => {
  it("include every parent table that restorable rows reference (otherwise restore into an empty DB fails the FK check)", () => {
    const sqlite = new Database(":memory:");
    runMigrations(sqlite);
    const restorable = new Set(restorableTables);
    const missingParents: string[] = [];
    for (const table of restorableTables) {
      if (table === "schema_migrations") continue;
      const fks = sqlite.prepare(`PRAGMA foreign_key_list(${JSON.stringify(table)})`).all() as Array<{ table: string }>;
      for (const fk of fks) {
        if (!restorable.has(fk.table)) missingParents.push(`${table} -> ${fk.table}`);
      }
    }
    sqlite.close();
    expect(missingParents).toEqual([]);
  });
});
