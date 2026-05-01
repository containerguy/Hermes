CREATE TABLE pizza_menu_items (
  id TEXT PRIMARY KEY NOT NULL,
  number TEXT,
  name TEXT NOT NULL,
  ingredients TEXT,
  allergens TEXT,
  category TEXT NOT NULL DEFAULT 'pizza' CHECK (category IN ('pizza', 'pasta')),
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX pizza_menu_items_active_sort_idx ON pizza_menu_items(active, sort_order);

CREATE TABLE pizza_menu_variants (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL REFERENCES pizza_menu_items(id) ON DELETE CASCADE,
  size_label TEXT,
  price_cents INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX pizza_menu_variants_item_idx ON pizza_menu_variants(item_id);

CREATE TABLE pizza_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES game_events(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'open', 'locked', 'delivered')),
  opened_at TEXT,
  opened_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  locked_at TEXT,
  locked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  delivered_at TEXT,
  delivered_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX pizza_sessions_event_unique ON pizza_sessions(event_id);

CREATE TABLE pizza_orders (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES pizza_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid_paypal', 'paid_cash')),
  paid_at TEXT,
  paid_by_admin_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX pizza_orders_session_user_unique ON pizza_orders(session_id, user_id);

CREATE TABLE pizza_order_lines (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES pizza_orders(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES pizza_menu_variants(id) ON DELETE RESTRICT,
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 3),
  price_cents_snapshot INTEGER NOT NULL,
  custom_note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX pizza_order_lines_order_idx ON pizza_order_lines(order_id);
