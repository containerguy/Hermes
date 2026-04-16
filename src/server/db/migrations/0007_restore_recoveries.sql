CREATE TABLE IF NOT EXISTS storage_restore_recoveries (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  bucket TEXT,
  region TEXT,
  endpoint TEXT,
  created_at TEXT NOT NULL
);

