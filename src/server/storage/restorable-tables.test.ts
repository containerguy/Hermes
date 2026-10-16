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

  it("decide for every table whether a restore brings it back (new tables must be added to one of the lists)", () => {
    // Bewusst nicht wiederhergestellt: kurzlebige Anmelde-/Sperrdaten und der Zustand des Backups selbst.
    // user_api_tokens und rate_limit_allowlist fehlen schon länger im Restore (Stand PR #14).
    const notRestored = [
      "email_change_challenges",
      "pairing_tokens",
      "rate_limit_allowlist",
      "rate_limit_entries",
      "storage_backup_status",
      "storage_restore_recoveries",
      "user_api_tokens"
    ];
    const sqlite = new Database(":memory:");
    runMigrations(sqlite);
    const tables = (
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    sqlite.close();
    const decided = new Set([...restorableTables, ...notRestored]);
    expect(tables.filter((table) => !decided.has(table))).toEqual([]);
    expect(restorableTables).toEqual(
      expect.arrayContaining(["pizza_menu_items", "pizza_menu_variants", "pizza_sessions", "pizza_orders", "pizza_order_lines"])
    );
  });
});
