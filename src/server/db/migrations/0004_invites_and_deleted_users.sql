ALTER TABLE users ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS invite_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  max_uses INTEGER,
  expires_at TEXT,
  revoked_at TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS invite_codes_code_unique ON invite_codes(code);

CREATE TABLE IF NOT EXISTS invite_code_uses (
  id TEXT PRIMARY KEY,
  invite_code_id TEXT NOT NULL REFERENCES invite_codes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS invite_code_uses_user_unique ON invite_code_uses(user_id);
