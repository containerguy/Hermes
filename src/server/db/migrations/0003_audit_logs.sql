CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_username TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS audit_logs_actor_user_id_idx ON audit_logs(actor_user_id);
