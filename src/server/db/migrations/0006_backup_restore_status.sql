CREATE TABLE IF NOT EXISTS storage_backup_status (
  backend TEXT PRIMARY KEY,
  last_success_at TEXT,
  last_failure_at TEXT,
  failure_code TEXT,
  failure_summary TEXT,
  bucket TEXT,
  key TEXT,
  region TEXT,
  endpoint TEXT,
  updated_at TEXT NOT NULL
);

