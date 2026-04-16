ALTER TABLE game_events ADD COLUMN deleted_at TEXT;
ALTER TABLE game_events ADD COLUMN deleted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS game_events_deleted_at_idx ON game_events(deleted_at);

