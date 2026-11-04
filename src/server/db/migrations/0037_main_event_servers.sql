-- Gameserver pro Event: welche Server-Bindungen ein Event anbietet. Keine Zeile = alle Server.
CREATE TABLE IF NOT EXISTS main_event_servers (
  main_event_id TEXT NOT NULL REFERENCES main_events(id) ON DELETE CASCADE,
  binding_id TEXT NOT NULL REFERENCES game_server_bindings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (main_event_id, binding_id)
);
