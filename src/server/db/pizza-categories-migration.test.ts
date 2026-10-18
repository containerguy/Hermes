import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { listOrdersForSession } from "../domain/pizza/orders";
import { listArchivedSessions } from "../domain/pizza/sessions";
import { orderTotalCents } from "../domain/pizza/totals";
import type { DatabaseContext } from "./client";
import { runMigrations } from "./migrate";
import * as schema from "./schema";

const migrationsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const MIGRATION = "0024_pizza_categories_extras.sql";

/** Stand von main (v0.14.2): alle Migrationen vor 0024, eingetragen wie vom Runner. */
function buildMainDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
  const files = fs
    .readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql") && file < MIGRATION)
    .sort();
  sqlite.pragma("foreign_keys = OFF");
  for (const file of files) {
    sqlite.exec(fs.readFileSync(path.join(migrationsDirectory, file), "utf8"));
    sqlite.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(file, "2026-10-01T00:00:00.000Z");
  }
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

const ts = "2026-10-01T18:00:00.000Z";

/** Realistische Daten: Seed-Menü (0017), eine archivierte und eine offene Runde, Bezahlarten. */
function fillRealisticData(sqlite: Database.Database) {
  const insertUser = sqlite.prepare(
    "INSERT INTO users (id, phone_number, username, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const users = ["anna", "ben", "chris", "dora", "emil", "fritz"];
  users.forEach((name, index) => insertUser.run(`u-${name}`, `+4917000000${index}`, name, `${name}@example.test`, index === 0 ? "manager" : "user", ts, ts));

  // Menüpflege wie in Produktion: ein Preis geändert, eine Variante und ein Artikel deaktiviert.
  sqlite.prepare("UPDATE pizza_menu_variants SET price_cents = 900 WHERE id = 'v-001-30'").run();
  sqlite.prepare("UPDATE pizza_menu_variants SET active = 0 WHERE id = 'v-002-45'").run();
  sqlite.prepare("UPDATE pizza_menu_items SET active = 0, updated_at = ? WHERE id = 'pi-005'").run(ts);

  const insertSession = sqlite.prepare(
    `INSERT INTO pizza_sessions (id, state, label, opened_at, opened_by_user_id, locked_at, delivered_at, archived_at, archived_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'u-anna', ?, ?, ?, ?, ?, ?)`
  );
  insertSession.run("s-archiv", "delivered", "Mai-LAN", "2026-05-01T18:00:00.000Z", "2026-05-01T19:00:00.000Z", "2026-05-01T20:00:00.000Z", "2026-05-02T10:00:00.000Z", "u-anna", "2026-05-01T17:00:00.000Z", "2026-05-02T10:00:00.000Z");
  insertSession.run("s-offen", "open", "Oktober-LAN", ts, null, null, null, null, ts, ts);

  const insertOrder = sqlite.prepare(
    `INSERT INTO pizza_orders (id, session_id, user_id, payment_status, payment_method, paid_at, paid_by_admin_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertLine = sqlite.prepare(
    `INSERT INTO pizza_order_lines (id, order_id, variant_id, qty, price_cents_snapshot, custom_note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  // Archivierte Runde: Snapshot 700 obwohl v-001-30 heute 900 kostet.
  insertOrder.run("o-a1", "s-archiv", "u-anna", "paid_cash", "cash", ts, "u-anna", ts, ts);
  insertLine.run("l-a1", "o-a1", "v-001-30", 2, 700, "extra scharf", ts);
  insertLine.run("l-a2", "o-a1", "v-pa-055", 1, 650, null, ts);
  insertOrder.run("o-a2", "s-archiv", "u-ben", "paid_paypal", "paypal", ts, "u-anna", ts, ts);
  insertLine.run("l-a3", "o-a2", "v-002-45", 1, 1800, null, ts);
  insertOrder.run("o-a3", "s-archiv", "u-chris", "unpaid", null, null, null, ts, ts);
  insertLine.run("l-a4", "o-a3", "v-005-30", 3, 700, "ohne Zwiebeln", ts);
  // Offene Runde
  insertOrder.run("o-b1", "s-offen", "u-dora", "unpaid", "paypal", null, null, ts, ts);
  insertLine.run("l-b1", "o-b1", "v-001-30", 1, 900, null, ts);
  insertLine.run("l-b2", "o-b1", "v-003-45", 2, 2100, null, ts);
  insertOrder.run("o-b2", "s-offen", "u-emil", "unpaid", "cash", null, null, ts, ts);
  insertLine.run("l-b3", "o-b2", "v-pa-pladina", 1, 850, "mit Käse", ts);
  insertOrder.run("o-b3", "s-offen", "u-fritz", "unpaid", null, null, null, ts, ts);
  insertLine.run("l-b4", "o-b3", "v-004-24", 3, 550, null, ts);
}

function rows(sqlite: Database.Database, sql: string) {
  return sqlite.prepare(sql).all() as Array<Record<string, unknown>>;
}

function sessionTotalsBySql(sqlite: Database.Database) {
  return rows(
    sqlite,
    `SELECT o.session_id AS session, o.id AS orderId, SUM(l.qty * l.price_cents_snapshot) AS total
     FROM pizza_orders o JOIN pizza_order_lines l ON l.order_id = o.id GROUP BY o.id ORDER BY o.id`
  );
}

describe("0024_pizza_categories_extras migration", () => {
  it("baut pizza_menu_items mit category_id neu auf, ohne IDs, Verweise oder Summen zu verlieren", () => {
    const sqlite = buildMainDatabase();
    fillRealisticData(sqlite);

    const itemsBefore = rows(
      sqlite,
      "SELECT id, number, name, ingredients, allergens, category, active, sort_order, created_at, updated_at FROM pizza_menu_items ORDER BY id"
    );
    const variantsBefore = rows(sqlite, "SELECT * FROM pizza_menu_variants ORDER BY id");
    const sessionsBefore = rows(sqlite, "SELECT * FROM pizza_sessions ORDER BY id");
    const ordersBefore = rows(sqlite, "SELECT * FROM pizza_orders ORDER BY id");
    const linesBefore = rows(sqlite, "SELECT * FROM pizza_order_lines ORDER BY id");
    const totalsBefore = sessionTotalsBySql(sqlite);
    expect(itemsBefore).toHaveLength(90);
    expect(variantsBefore.length).toBeGreaterThanOrEqual(190);

    // Echter Runner: wendet nur die noch fehlende 0024 an (foreign_keys aus, Transaktion).
    runMigrations(sqlite);
    const applied = rows(sqlite, "SELECT name FROM schema_migrations WHERE name = '0024_pizza_categories_extras.sql'");
    expect(applied).toHaveLength(1);

    // Kategorien angelegt und zugeordnet
    expect(rows(sqlite, "SELECT id, name, sort_order, active FROM pizza_menu_categories ORDER BY sort_order")).toEqual([
      { id: "cat-pizza", name: "Pizza", sort_order: 1, active: 1 },
      { id: "cat-pasta", name: "Pasta", sort_order: 2, active: 1 }
    ]);
    const itemsAfter = rows(
      sqlite,
      "SELECT id, number, name, ingredients, allergens, category_id, active, sort_order, created_at, updated_at FROM pizza_menu_items ORDER BY id"
    );
    expect(itemsAfter.map(({ category_id: _categoryId, ...rest }) => rest)).toEqual(
      itemsBefore.map(({ category: _category, ...rest }) => rest)
    );
    for (const [index, item] of itemsAfter.entries()) {
      expect(item.category_id).toBe(itemsBefore[index].category === "pasta" ? "cat-pasta" : "cat-pizza");
    }
    expect(itemsAfter.filter((item) => item.category_id === "cat-pizza")).toHaveLength(62);
    expect(itemsAfter.filter((item) => item.category_id === "cat-pasta")).toHaveLength(28);
    expect(rows(sqlite, "PRAGMA table_info(pizza_menu_items)").map((column) => column.name)).not.toContain("category");

    // Varianten, Runden, Bestellungen, Zeilen unverändert
    expect(rows(sqlite, "SELECT * FROM pizza_menu_variants ORDER BY id")).toEqual(variantsBefore);
    expect(rows(sqlite, "SELECT * FROM pizza_sessions ORDER BY id")).toEqual(sessionsBefore);
    expect(rows(sqlite, "SELECT * FROM pizza_orders ORDER BY id")).toEqual(ordersBefore);
    expect(rows(sqlite, "SELECT * FROM pizza_order_lines ORDER BY id")).toEqual(linesBefore);

    // Verweise zeigen weiter auf die richtigen Tabellen
    const variantFks = rows(sqlite, "PRAGMA foreign_key_list(pizza_menu_variants)");
    expect(variantFks.map((fk) => fk.table)).toEqual(["pizza_menu_items"]);
    const lineFks = rows(sqlite, "PRAGMA foreign_key_list(pizza_order_lines)").map((fk) => fk.table).sort();
    expect(lineFks).toEqual(["pizza_menu_variants", "pizza_orders"]);
    expect(rows(sqlite, "SELECT name FROM sqlite_master WHERE instr(sql, 'pizza_menu_items__new') > 0")).toEqual([]);

    expect(rows(sqlite, "PRAGMA foreign_key_check")).toEqual([]);
    expect(rows(sqlite, "PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);

    // Alte Bestellungen zeigen dieselben Summen (SQL und Domain mit Extras-Logik)
    expect(sessionTotalsBySql(sqlite)).toEqual(totalsBefore);
    const context = { sqlite, db: drizzle(sqlite, { schema }) } as DatabaseContext;
    const archived = listArchivedSessions(context);
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ id: "s-archiv", orderCount: 3, unpaidCount: 1, totalCents: 1400 + 650 + 1800 + 2100 });
    for (const sessionId of ["s-archiv", "s-offen"]) {
      for (const order of listOrdersForSession(context, sessionId)) {
        const before = totalsBefore.find((row) => row.orderId === order.id);
        expect(orderTotalCents(order.lines)).toBe(before?.total);
      }
    }

    // Kategorien sind case-insensitiv eindeutig, Positions-Extras verweisen per RESTRICT
    expect(() =>
      sqlite.prepare("INSERT INTO pizza_menu_categories (id, name, sort_order, active, created_at, updated_at) VALUES ('x', 'PIZZA', 3, 1, ?, ?)").run(ts, ts)
    ).toThrow(/UNIQUE/);
    const lineExtraFks = rows(sqlite, "PRAGMA foreign_key_list(pizza_order_line_extras)");
    expect(lineExtraFks.find((fk) => fk.table === "pizza_menu_extras")?.on_delete).toBe("RESTRICT");
    expect(lineExtraFks.find((fk) => fk.table === "pizza_order_lines")?.on_delete).toBe("CASCADE");
    sqlite.close();
  });

  it("läuft auch auf einer leeren Datenbank durch", () => {
    const sqlite = new Database(":memory:");
    runMigrations(sqlite);
    expect(rows(sqlite, "SELECT COUNT(*) AS count FROM pizza_menu_items WHERE category_id = 'cat-pizza'")).toEqual([{ count: 62 }]);
    expect(rows(sqlite, "PRAGMA foreign_key_check")).toEqual([]);
    sqlite.close();
  });
});
