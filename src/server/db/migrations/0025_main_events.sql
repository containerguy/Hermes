-- Events (z. B. eine LAN-Party oder ein Turniertag) klammern Spielrunden und deren Benachrichtigungen.
-- Ablauf: geplant -> laeuft (gestartet) -> beendet. Hoechstens ein Event laeuft gleichzeitig.
CREATE TABLE IF NOT EXISTS main_events (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'running', 'ended')),
  planned_start_at TEXT,
  planned_end_at TEXT,
  started_at TEXT,
  started_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  ended_at TEXT,
  ended_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS main_events_single_running
  ON main_events(status)
  WHERE status = 'running';

-- Bestehende Runden bleiben ohne Event (NULL).
ALTER TABLE game_events ADD COLUMN main_event_id TEXT REFERENCES main_events(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS game_events_main_event_idx ON game_events(main_event_id);

-- Teilnahme am Event: "dabei" bekommt die Benachrichtigungen zu den Runden des Events.
CREATE TABLE IF NOT EXISTS main_event_participants (
  id TEXT PRIMARY KEY NOT NULL,
  main_event_id TEXT NOT NULL REFERENCES main_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('joined', 'declined')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS main_event_participants_event_user_unique
  ON main_event_participants(main_event_id, user_id);
