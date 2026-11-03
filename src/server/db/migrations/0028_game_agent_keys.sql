-- „Spielt gerade“: ein Schlüssel pro Benutzer für den Windows-Agenten. Er darf nur
-- POST/DELETE /api/presence/game, nichts sonst (anders als ein API-Token mit Vollzugriff).
CREATE TABLE IF NOT EXISTS game_agent_keys (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS game_agent_keys_key_hash_unique ON game_agent_keys(key_hash);
