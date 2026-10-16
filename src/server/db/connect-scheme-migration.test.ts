import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const migrationsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const CONNECT_SCHEME_MIGRATION = "0023_connect_scheme_ut2004_factorio.sql";

function applyMigrations(sqlite: Database.Database, filter: (file: string) => boolean) {
  const files = fs
    .readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql") && filter(file))
    .sort();
  sqlite.pragma("foreign_keys = OFF");
  for (const file of files) {
    sqlite.exec(fs.readFileSync(path.join(migrationsDirectory, file), "utf8"));
  }
  sqlite.pragma("foreign_keys = ON");
}

const ts = "2026-10-17T00:00:00.000Z";

function insertBinding(sqlite: Database.Database, id: string, title: string, scheme: string) {
  sqlite
    .prepare(
      `INSERT INTO game_server_bindings
        (id, game_title_norm, display_title, amp_instance_id, amp_instance_name, host, port, connect_scheme, enabled, created_at, updated_at, auto_stop_enabled)
       VALUES (?, ?, ?, ?, ?, 'retro.example', 7777, ?, 1, ?, ?, 1)`
    )
    .run(id, title.toLowerCase(), title, `i-${id}`, `${title}01`, scheme, ts, ts);
}

describe("0023_connect_scheme_ut2004_factorio migration", () => {
  it("erweitert den CHECK um ut2004/factorio und behält Bindungen, Index und Event-Verknüpfung", () => {
    const sqlite = new Database(":memory:");
    applyMigrations(sqlite, (file) => file < CONNECT_SCHEME_MIGRATION);

    insertBinding(sqlite, "b-cs2", "CS2", "steam");
    sqlite
      .prepare(
        "INSERT INTO users (id, phone_number, username, email, role, created_at, updated_at) VALUES ('u1', '+490', 'gast', 'gast@example.test', 'admin', ?, ?)"
      )
      .run(ts, ts);
    sqlite
      .prepare(
        `INSERT INTO game_events (id, game_title, start_mode, starts_at, min_players, max_players, created_by_user_id, created_at, updated_at, server_binding_id)
         VALUES ('e1', 'CS2', 'now', ?, 2, 10, 'u1', ?, ?, 'b-cs2')`
      )
      .run(ts, ts, ts);
    // Vorher lehnt der CHECK die neuen Schemata ab
    expect(() => insertBinding(sqlite, "b-ut-old", "UT2004", "ut2004")).toThrow(/CHECK/);

    applyMigrations(sqlite, (file) => file === CONNECT_SCHEME_MIGRATION);

    const kept = sqlite
      .prepare("SELECT connect_scheme, auto_stop_enabled FROM game_server_bindings WHERE id = 'b-cs2'")
      .get() as { connect_scheme: string; auto_stop_enabled: number };
    expect(kept).toEqual({ connect_scheme: "steam", auto_stop_enabled: 1 });

    insertBinding(sqlite, "b-ut", "UT2004", "ut2004");
    insertBinding(sqlite, "b-fa", "Factorio", "factorio");
    expect(() => insertBinding(sqlite, "b-x", "Quake", "quake")).toThrow(/CHECK/);

    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'game_server_bindings'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(indexes).toContain("game_server_bindings_title_unique");
    expect(() => insertBinding(sqlite, "b-ut-2", "UT2004", "ut2004")).toThrow(/UNIQUE/);

    // Fremdschlüssel aus game_events zeigt weiter auf game_server_bindings und greift (ON DELETE SET NULL)
    const fks = sqlite.prepare("SELECT \"table\" AS target FROM pragma_foreign_key_list('game_events')").all() as Array<{
      target: string;
    }>;
    expect(fks.map((fk) => fk.target)).toContain("game_server_bindings");
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.prepare("DELETE FROM game_server_bindings WHERE id = 'b-cs2'").run();
    const event = sqlite.prepare("SELECT server_binding_id FROM game_events WHERE id = 'e1'").get() as {
      server_binding_id: string | null;
    };
    expect(event.server_binding_id).toBeNull();
  });
});
