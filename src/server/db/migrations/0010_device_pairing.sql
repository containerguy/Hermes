-- Phase 09: Device Recognition and Session-Bound Pairing (AUTH-01, AUTH-02)

-- Sessions: track low-entropy device-match signals (D-01, D-02).
-- Legacy rows stay NULL and fall through to the normalized-signals fallback.
ALTER TABLE sessions ADD COLUMN device_key_hash TEXT;
ALTER TABLE sessions ADD COLUMN device_signals TEXT;

CREATE INDEX IF NOT EXISTS sessions_user_device_key_idx ON sessions(user_id, device_key_hash);
CREATE INDEX IF NOT EXISTS sessions_user_device_signals_idx ON sessions(user_id, device_signals);

-- Pairing tokens: HMAC-hashed, session-bound, single-use, ≤10min TTL (D-08, D-11, D-13).
CREATE TABLE IF NOT EXISTS pairing_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS pairing_tokens_token_hash_unique ON pairing_tokens(token_hash);
CREATE INDEX IF NOT EXISTS pairing_tokens_origin_session_idx ON pairing_tokens(origin_session_id);
CREATE INDEX IF NOT EXISTS pairing_tokens_user_expires_idx ON pairing_tokens(user_id, expires_at);
CREATE INDEX IF NOT EXISTS pairing_tokens_expires_at_idx ON pairing_tokens(expires_at);
