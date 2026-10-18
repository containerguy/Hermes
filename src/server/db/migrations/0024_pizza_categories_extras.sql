-- v0.15.0: Freie Kategorien und Extras mit Aufpreis für das Pizza-Menü.
--
-- 1. Neue Tabelle pizza_menu_categories; „Pizza“ und „Pasta“ werden mit festen IDs angelegt.
-- 2. pizza_menu_items wird neu aufgebaut (Muster wie 0013/0023): Die Spalte `category` mit
--    CHECK ('pizza', 'pasta') wird durch `category_id` (FK) ersetzt. IDs und alle übrigen Werte
--    bleiben unverändert. pizza_menu_variants verweist per Namen auf pizza_menu_items und bleibt
--    gültig, weil nur die neue Tabelle umbenannt wird (die alte wird gelöscht, nicht umbenannt).
--    Fremdschlüssel: migrate.ts schaltet foreign_keys vor der Transaktion aus.
-- 3. Extras: pizza_menu_extras, Zuordnung zu Kategorien (n:m) und pizza_order_line_extras mit
--    Name- und Preis-Snapshot je Bestellposition. Ein Preis pro Variante lässt sich später als
--    eigene Tabelle (z. B. pizza_extra_variant_prices) ergänzen, ohne diese Tabellen umzubauen.

CREATE TABLE pizza_menu_categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX pizza_menu_categories_name_unique ON pizza_menu_categories(name COLLATE NOCASE);

INSERT INTO pizza_menu_categories (id, name, sort_order, active, created_at, updated_at) VALUES
  ('cat-pizza', 'Pizza', 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('cat-pasta', 'Pasta', 2, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE pizza_menu_items__new (
  id TEXT PRIMARY KEY NOT NULL,
  number TEXT,
  name TEXT NOT NULL,
  ingredients TEXT,
  allergens TEXT,
  category_id TEXT NOT NULL REFERENCES pizza_menu_categories(id) ON DELETE RESTRICT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO pizza_menu_items__new (
  id,
  number,
  name,
  ingredients,
  allergens,
  category_id,
  active,
  sort_order,
  created_at,
  updated_at
)
SELECT
  id,
  number,
  name,
  ingredients,
  allergens,
  CASE category WHEN 'pasta' THEN 'cat-pasta' ELSE 'cat-pizza' END,
  active,
  sort_order,
  created_at,
  updated_at
FROM pizza_menu_items;

DROP TABLE pizza_menu_items;
ALTER TABLE pizza_menu_items__new RENAME TO pizza_menu_items;

CREATE INDEX IF NOT EXISTS pizza_menu_items_active_sort_idx ON pizza_menu_items(active, sort_order);
CREATE INDEX IF NOT EXISTS pizza_menu_items_category_idx ON pizza_menu_items(category_id);

CREATE TABLE pizza_menu_extras (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 0 AND 100000),
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX pizza_menu_extras_name_unique ON pizza_menu_extras(name COLLATE NOCASE);

CREATE TABLE pizza_menu_extra_categories (
  extra_id TEXT NOT NULL REFERENCES pizza_menu_extras(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES pizza_menu_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (extra_id, category_id)
);

CREATE INDEX pizza_menu_extra_categories_category_idx ON pizza_menu_extra_categories(category_id);

-- extra_id ON DELETE RESTRICT: Ein bestelltes Extra wird nur deaktiviert. Name und Preis stehen
-- zusätzlich als Snapshot an der Position, damit alte Bestellungen unverändert bleiben.
CREATE TABLE pizza_order_line_extras (
  line_id TEXT NOT NULL REFERENCES pizza_order_lines(id) ON DELETE CASCADE,
  extra_id TEXT NOT NULL REFERENCES pizza_menu_extras(id) ON DELETE RESTRICT,
  name_snapshot TEXT NOT NULL,
  price_cents_snapshot INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (line_id, extra_id)
);

CREATE INDEX pizza_order_line_extras_extra_idx ON pizza_order_line_extras(extra_id);
