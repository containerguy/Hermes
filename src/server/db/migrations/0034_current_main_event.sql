-- Aktuelles Event pro Benutzer (globaler Event-Umschalter); NULL = alle Events.
ALTER TABLE users ADD COLUMN current_main_event_id TEXT REFERENCES main_events(id) ON DELETE SET NULL;
