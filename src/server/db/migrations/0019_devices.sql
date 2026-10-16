-- Persistent devices: the device name belongs to the browser/device, not to a
-- single session. Logging out (or an admin-triggered session revoke) keeps the
-- device record so the next login on the same browser keeps its name.
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_key_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  device_signals TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  forgotten_at TEXT
);

-- One active (not forgotten) device per user and device key.
CREATE UNIQUE INDEX IF NOT EXISTS devices_user_key_active_unique
  ON devices(user_id, device_key_hash)
  WHERE forgotten_at IS NULL;
CREATE INDEX IF NOT EXISTS devices_user_idx ON devices(user_id);

ALTER TABLE sessions ADD COLUMN device_id TEXT REFERENCES devices(id) ON DELETE SET NULL;
-- Last time the session cookie was re-issued (sliding expiration).
ALTER TABLE sessions ADD COLUMN renewed_at TEXT;

CREATE INDEX IF NOT EXISTS sessions_device_idx ON sessions(device_id);

-- Backfill: one device per (user, device key) from existing key-bound sessions,
-- named after the most recently used session of that key.
INSERT INTO devices (id, user_id, device_key_hash, name, device_signals, created_at, last_seen_at, forgotten_at)
SELECT
  lower(hex(randomblob(16))),
  ranked.user_id,
  ranked.device_key_hash,
  COALESCE(NULLIF(trim(ranked.device_name), ''), 'Unbekanntes Geraet'),
  ranked.device_signals,
  ranked.first_created_at,
  ranked.last_seen_at,
  NULL
FROM (
  SELECT
    s.user_id,
    s.device_key_hash,
    s.device_name,
    s.device_signals,
    s.last_seen_at,
    MIN(s.created_at) OVER (PARTITION BY s.user_id, s.device_key_hash) AS first_created_at,
    ROW_NUMBER() OVER (
      PARTITION BY s.user_id, s.device_key_hash
      ORDER BY s.last_seen_at DESC, s.created_at DESC
    ) AS rn
  FROM sessions s
  WHERE s.device_key_hash IS NOT NULL
) ranked
WHERE ranked.rn = 1;

UPDATE sessions
SET device_id = (
  SELECT d.id
  FROM devices d
  WHERE d.user_id = sessions.user_id
    AND d.device_key_hash = sessions.device_key_hash
    AND d.forgotten_at IS NULL
)
WHERE device_key_hash IS NOT NULL;
