-- Phase 01: Auth, Profile, And Invite Hardening (schema foundation)

-- Users: add mutable display name (backfilled from username).
ALTER TABLE users ADD COLUMN display_name TEXT;
UPDATE users SET display_name = username WHERE display_name IS NULL;

-- Sessions: store a non-secret token hash to avoid relying on raw cookie tokens at rest.
ALTER TABLE sessions ADD COLUMN token_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_unique ON sessions(token_hash);

-- Login challenges: add indexes for lookup and cleanup paths.
CREATE INDEX IF NOT EXISTS login_challenges_username_created_at_idx
  ON login_challenges(username, created_at);
CREATE INDEX IF NOT EXISTS login_challenges_username_consumed_expires_idx
  ON login_challenges(username, consumed_at, expires_at);
CREATE INDEX IF NOT EXISTS login_challenges_expires_at_idx
  ON login_challenges(expires_at);

-- Email change challenges: separate from login challenges.
CREATE TABLE IF NOT EXISTS email_change_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS email_change_challenges_user_id_created_at_idx
  ON email_change_challenges(user_id, created_at);
CREATE INDEX IF NOT EXISTS email_change_challenges_user_id_consumed_expires_idx
  ON email_change_challenges(user_id, consumed_at, expires_at);
CREATE INDEX IF NOT EXISTS email_change_challenges_expires_at_idx
  ON email_change_challenges(expires_at);
CREATE INDEX IF NOT EXISTS email_change_challenges_new_email_idx
  ON email_change_challenges(new_email);

-- Persisted rate limiting: supports inspection + clearing via admin endpoints later.
CREATE TABLE IF NOT EXISTS rate_limit_entries (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  last_attempt_at TEXT NOT NULL,
  blocked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS rate_limit_entries_scope_key_unique
  ON rate_limit_entries(scope, key);
CREATE INDEX IF NOT EXISTS rate_limit_entries_blocked_until_idx
  ON rate_limit_entries(blocked_until);
CREATE INDEX IF NOT EXISTS rate_limit_entries_updated_at_idx
  ON rate_limit_entries(updated_at);

-- Allowlist for LAN-trusted IPs/prefixes.
CREATE TABLE IF NOT EXISTS rate_limit_allowlist (
  id TEXT PRIMARY KEY,
  ip_or_cidr TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS rate_limit_allowlist_ip_or_cidr_unique
  ON rate_limit_allowlist(ip_or_cidr);
