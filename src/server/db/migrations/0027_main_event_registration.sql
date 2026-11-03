-- Anmeldung zum Event: Plätze, Anmeldeschluss, Interessentenliste und Nachrücker.
-- max_participants NULL = unbegrenzt, registration_deadline NULL = kein Anmeldeschluss.
ALTER TABLE main_events ADD COLUMN max_participants INTEGER CHECK (max_participants IS NULL OR max_participants > 0);
ALTER TABLE main_events ADD COLUMN registration_deadline TEXT;

-- Teilnahme kennt jetzt auch "interessiert" und "Nachrücker" (Event voll). SQLite kann den
-- CHECK nicht ändern, darum wird die Tabelle neu aufgebaut.
CREATE TABLE main_event_participants_new (
  id TEXT PRIMARY KEY NOT NULL,
  main_event_id TEXT NOT NULL REFERENCES main_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('joined', 'interested', 'waitlisted', 'declined')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO main_event_participants_new (id, main_event_id, user_id, status, created_at, updated_at)
  SELECT id, main_event_id, user_id, status, created_at, updated_at FROM main_event_participants;

DROP TABLE main_event_participants;
ALTER TABLE main_event_participants_new RENAME TO main_event_participants;

CREATE UNIQUE INDEX IF NOT EXISTS main_event_participants_event_user_unique
  ON main_event_participants(main_event_id, user_id);
CREATE INDEX IF NOT EXISTS main_event_participants_event_status_idx
  ON main_event_participants(main_event_id, status, updated_at);
