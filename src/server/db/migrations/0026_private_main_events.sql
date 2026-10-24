-- Private Events: nur Eingeladene (sowie Manager und Admins) sehen das Event, seine Runden und Benachrichtigungen.
ALTER TABLE main_events ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private'));

CREATE TABLE IF NOT EXISTS main_event_invites (
  id TEXT PRIMARY KEY NOT NULL,
  main_event_id TEXT NOT NULL REFERENCES main_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS main_event_invites_event_user_unique
  ON main_event_invites(main_event_id, user_id);
