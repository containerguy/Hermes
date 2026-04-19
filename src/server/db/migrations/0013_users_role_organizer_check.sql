-- Erweitere users.role CHECK um 'organizer' (SQLite: Tabelle neu aufbauen).
-- Fremdschlüssel: migrate.ts schaltet foreign_keys vor der Transaktion aus (PRAGMA in SQL greift dort nicht).

CREATE TABLE users__new (
  id TEXT PRIMARY KEY NOT NULL,
  phone_number TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'organizer', 'manager', 'admin')),
  notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK (notifications_enabled IN (0, 1)),
  locale TEXT,
  created_by_user_id TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO users__new (
  id,
  phone_number,
  username,
  display_name,
  email,
  role,
  notifications_enabled,
  locale,
  created_by_user_id,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  id,
  phone_number,
  username,
  display_name,
  email,
  role,
  notifications_enabled,
  locale,
  created_by_user_id,
  deleted_at,
  created_at,
  updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users__new RENAME TO users;

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_number_unique ON users(phone_number);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(username);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email);
