-- Phase 15: AMP-Gameserver-Modul (AMP-01, AMP-02)
-- Bindung Spieltitel -> AMP-Instanz plus Verknüpfung am Event. Zugangsdaten leben seit dieser
-- Phase nur noch in der Umgebung; die alten Settings-Keys werden hier entfernt.

CREATE TABLE IF NOT EXISTS game_server_bindings (
  id TEXT PRIMARY KEY NOT NULL,
  game_title_norm TEXT NOT NULL,
  display_title TEXT NOT NULL,
  amp_instance_id TEXT NOT NULL,
  amp_instance_name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  connect_scheme TEXT NOT NULL DEFAULT 'copy' CHECK (connect_scheme IN ('steam', 'minecraft', 'copy')),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS game_server_bindings_title_unique ON game_server_bindings(game_title_norm);

ALTER TABLE game_events ADD COLUMN server_binding_id TEXT REFERENCES game_server_bindings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS game_events_server_binding_idx ON game_events(server_binding_id);

DELETE FROM app_settings WHERE key IN ('ampUsername', 'ampPassword', 'ampTlsSkipVerify');
