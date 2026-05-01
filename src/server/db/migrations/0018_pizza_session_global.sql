-- Pizza orders are LAN-party-wide, not per game event. Drop event_id link
-- and enforce a single active session row.

CREATE TABLE pizza_sessions_new (
  id TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'open', 'locked', 'delivered')),
  label TEXT,
  opened_at TEXT,
  opened_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  locked_at TEXT,
  locked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  delivered_at TEXT,
  delivered_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO pizza_sessions_new (id, state, label, opened_at, opened_by_user_id, locked_at, locked_by_user_id, delivered_at, delivered_by_user_id, created_at, updated_at)
SELECT id, state, NULL, opened_at, opened_by_user_id, locked_at, locked_by_user_id, delivered_at, delivered_by_user_id, created_at, updated_at FROM pizza_sessions;

DROP TABLE pizza_sessions;
ALTER TABLE pizza_sessions_new RENAME TO pizza_sessions;
