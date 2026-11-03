-- Einladungscode pro Event: Wer sich damit registriert, wird gleich als interessiert eingetragen
-- (bei privaten Events auch eingeladen). Am Benutzer wird vermerkt, über welches Event und
-- welchen Code er gekommen ist. Der Eventname wird mitgespeichert, damit der Vermerk lesbar
-- bleibt, falls das (geplante) Event gelöscht wird.
ALTER TABLE invite_codes ADD COLUMN main_event_id TEXT REFERENCES main_events(id) ON DELETE SET NULL;

ALTER TABLE users ADD COLUMN registered_via_main_event_id TEXT REFERENCES main_events(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN registered_via_main_event_name TEXT;
ALTER TABLE users ADD COLUMN registered_via_invite_code_id TEXT REFERENCES invite_codes(id) ON DELETE SET NULL;

-- Bestehende Registrierungen per Code nachtragen (ohne Event, das gab es dafür noch nicht).
UPDATE users
  SET registered_via_invite_code_id = (
    SELECT invite_code_id FROM invite_code_uses WHERE invite_code_uses.user_id = users.id
  )
  WHERE registered_via_invite_code_id IS NULL;

CREATE INDEX IF NOT EXISTS users_registered_via_main_event_idx ON users(registered_via_main_event_id);
CREATE INDEX IF NOT EXISTS invite_codes_main_event_idx ON invite_codes(main_event_id);
