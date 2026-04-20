CREATE TABLE user_api_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  label TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('full', 'read_only')),
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE UNIQUE INDEX user_api_tokens_token_hash_unique ON user_api_tokens(token_hash);
CREATE INDEX user_api_tokens_user_id_idx ON user_api_tokens(user_id);
