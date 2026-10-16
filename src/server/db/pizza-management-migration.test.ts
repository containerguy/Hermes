import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const migrationsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const PIZZA_MANAGEMENT_MIGRATION = "0022_pizza_management.sql";

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

describe("0022_pizza_management migration", () => {
  it("archiviert Altlasten, übernimmt Bezahlarten und aktiviert alle Varianten", () => {
    const sqlite = new Database(":memory:");
    applyMigrations(sqlite, (file) => file < PIZZA_MANAGEMENT_MIGRATION);

    const ts = "2026-05-01T00:00:00.000Z";
    sqlite
      .prepare(
        "INSERT INTO users (id, phone_number, username, email, role, created_at, updated_at) VALUES ('u1', '+490', 'gast', 'gast@example.test', 'user', ?, ?)"
      )
      .run(ts, ts);
    const insertSession = sqlite.prepare(
      "INSERT INTO pizza_sessions (id, state, created_at, updated_at) VALUES (?, ?, ?, ?)"
    );
    insertSession.run("old-open", "open", "2026-05-01T10:00:00.000Z", "2026-05-01T11:00:00.000Z");
    insertSession.run("delivered", "delivered", "2026-05-02T10:00:00.000Z", "2026-05-02T12:00:00.000Z");
    insertSession.run("latest", "locked", "2026-05-03T10:00:00.000Z", "2026-05-03T11:00:00.000Z");
    sqlite
      .prepare(
        "INSERT INTO pizza_orders (id, session_id, user_id, payment_status, created_at, updated_at) VALUES ('o1', 'delivered', 'u1', 'paid_cash', ?, ?), ('o2', 'latest', 'u1', 'unpaid', ?, ?)"
      )
      .run(ts, ts, ts, ts);

    applyMigrations(sqlite, (file) => file === PIZZA_MANAGEMENT_MIGRATION);

    const sessions = Object.fromEntries(
      (
        sqlite.prepare("SELECT id, archived_at FROM pizza_sessions").all() as Array<{
          id: string;
          archived_at: string | null;
        }>
      ).map((row) => [row.id, row.archived_at])
    );
    expect(sessions["old-open"]).toBe("2026-05-01T11:00:00.000Z");
    expect(sessions.delivered).toBe("2026-05-02T12:00:00.000Z");
    expect(sessions.latest).toBeNull();

    const methods = Object.fromEntries(
      (
        sqlite.prepare("SELECT id, payment_method FROM pizza_orders").all() as Array<{
          id: string;
          payment_method: string | null;
        }>
      ).map((row) => [row.id, row.payment_method])
    );
    expect(methods).toEqual({ o1: "cash", o2: null });

    const inactive = sqlite
      .prepare("SELECT COUNT(*) AS count FROM pizza_menu_variants WHERE active = 0")
      .get() as { count: number };
    expect(inactive.count).toBe(0);
  });
});
