-- Benachrichtigungs-Verteiler: Kanalwahl pro Benutzer, Abmeldelink und Rundnachrichten an Events.
-- Kanäle sind Mail und Push (eingebaut) sowie Kanäle aus Modulen (z. B. telegram, sms).
-- Fehlt eine Zeile, gilt die Vorgabe des Kanals (Mail und Push an, Modulkanäle aus).
CREATE TABLE IF NOT EXISTS notification_channel_preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);

-- Persönlicher Abmeldelink für Event-Infos (ohne Anmeldung nutzbar).
CREATE TABLE IF NOT EXISTS notification_unsubscribe_tokens (
  token TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_unsubscribe_tokens_user ON notification_unsubscribe_tokens(user_id);

-- Abgemeldet von allen Event-Infos (Login-Mails kommen weiter).
ALTER TABLE users ADD COLUMN event_info_unsubscribed_at TEXT;

CREATE TABLE IF NOT EXISTS main_event_broadcasts (
  id TEXT PRIMARY KEY NOT NULL,
  main_event_id TEXT NOT NULL REFERENCES main_events(id) ON DELETE CASCADE,
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  -- JSON-Liste der Zielgruppen: joined, interested, waitlisted, declined, no_response
  audience TEXT NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS main_event_broadcasts_event_idx ON main_event_broadcasts(main_event_id, created_at);

CREATE TABLE IF NOT EXISTS main_event_broadcast_deliveries (
  broadcast_id TEXT NOT NULL REFERENCES main_event_broadcasts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (broadcast_id, user_id, channel_id)
);

-- Geplante Erinnerungen (7 Tage und 1 Tag vor Start, Anmeldeschluss morgen), je Event abschaltbar.
ALTER TABLE main_events ADD COLUMN reminders_enabled INTEGER NOT NULL DEFAULT 1 CHECK (reminders_enabled IN (0, 1));

CREATE TABLE IF NOT EXISTS main_event_reminders_sent (
  main_event_id TEXT NOT NULL REFERENCES main_events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('start_7d', 'start_1d', 'deadline_1d')),
  sent_at TEXT NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (main_event_id, kind)
);

-- Persönlicher, abonnierbarer Kalender-Link (ohne Anmeldung lesbar, nur eigene Events).
CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
  token TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_feed_tokens_user ON calendar_feed_tokens(user_id);
