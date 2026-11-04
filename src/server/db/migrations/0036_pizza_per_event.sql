-- Bestellrunden pro Event: je Event eine eigene aktuelle Runde, dazu eine ohne Event (NULL).
ALTER TABLE pizza_sessions ADD COLUMN main_event_id TEXT REFERENCES main_events(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS pizza_sessions_event_idx ON pizza_sessions(main_event_id, archived_at);
-- „Pizza verwalten“ lässt sich jetzt auch nur für ein Event vergeben (nur dessen Bestellrunde).
UPDATE permissions SET scopable = 1 WHERE key = 'pizza.manage';
