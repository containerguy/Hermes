import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const migrationsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const DEVICES_MIGRATION = "0019_devices.sql";

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

describe("0019_devices migration", () => {
  it("backfills one device per (user, device key) and links sessions to it", () => {
    const sqlite = new Database(":memory:");
    applyMigrations(sqlite, (file) => file < DEVICES_MIGRATION);

    const ts = "2026-01-01T00:00:00.000Z";
    sqlite
      .prepare(
        "INSERT INTO users (id, phone_number, username, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'user', ?, ?)"
      )
      .run("u1", "+490", "spieler", "spieler@example.test", ts, ts);

    const insertSession = sqlite.prepare(
      `INSERT INTO sessions (id, user_id, device_name, user_agent, last_seen_at, created_at, token_hash, revoked_at, device_key_hash, device_signals)
       VALUES (?, 'u1', ?, NULL, ?, ?, ?, ?, ?, 'windows|chrome|desktop|web')`
    );
    // Two sessions with the same key: the most recently used one names the device.
    insertSession.run("s1", "Alter Name", "2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "t1", ts, "keyhash-a");
    insertSession.run("s2", "Gaming-PC", "2026-01-05T00:00:00.000Z", "2026-01-03T00:00:00.000Z", "t2", null, "keyhash-a");
    insertSession.run("s3", null, "2026-01-04T00:00:00.000Z", "2026-01-04T00:00:00.000Z", "t3", null, "keyhash-b");
    insertSession.run("s4", "Legacy", "2026-01-04T00:00:00.000Z", "2026-01-04T00:00:00.000Z", "t4", null, null);

    applyMigrations(sqlite, (file) => file === DEVICES_MIGRATION);

    const devices = sqlite
      .prepare("SELECT id, device_key_hash, name, created_at, last_seen_at FROM devices ORDER BY device_key_hash")
      .all() as Array<{ id: string; device_key_hash: string; name: string; created_at: string; last_seen_at: string }>;
    expect(devices).toHaveLength(2);
    expect(devices[0]).toMatchObject({
      device_key_hash: "keyhash-a",
      name: "Gaming-PC",
      created_at: "2026-01-01T00:00:00.000Z",
      last_seen_at: "2026-01-05T00:00:00.000Z"
    });
    expect(devices[1]).toMatchObject({ device_key_hash: "keyhash-b", name: "Unbekanntes Geraet" });

    const links = Object.fromEntries(
      (sqlite.prepare("SELECT id, device_id FROM sessions").all() as Array<{ id: string; device_id: string | null }>).map(
        (row) => [row.id, row.device_id]
      )
    );
    expect(links.s1).toBe(devices[0].id);
    expect(links.s2).toBe(devices[0].id);
    expect(links.s3).toBe(devices[1].id);
    expect(links.s4).toBeNull();

    expect(sqlite.prepare("PRAGMA foreign_key_check;").all()).toEqual([]);
    sqlite.close();
  });
});
