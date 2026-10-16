-- v0.14.0: Verbinden-Knopf für UT2004 (ut2004://) und Factorio (steam://run/427520).
-- SQLite kann einen CHECK nicht ändern: game_server_bindings neu aufbauen (Muster wie 0013).
-- Fremdschlüssel: migrate.ts schaltet foreign_keys vor der Transaktion aus. Die Referenz aus
-- game_events.server_binding_id zeigt per Namen auf game_server_bindings und bleibt gültig, weil
-- nur die neue Tabelle umbenannt wird.

CREATE TABLE game_server_bindings__new (
  id TEXT PRIMARY KEY NOT NULL,
  game_title_norm TEXT NOT NULL,
  display_title TEXT NOT NULL,
  amp_instance_id TEXT NOT NULL,
  amp_instance_name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  connect_scheme TEXT NOT NULL DEFAULT 'copy' CHECK (
    connect_scheme IN ('steam', 'ut2004', 'factorio', 'minecraft', 'copy')
  ),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  auto_stop_enabled INTEGER NOT NULL DEFAULT 0
);

INSERT INTO game_server_bindings__new (
  id,
  game_title_norm,
  display_title,
  amp_instance_id,
  amp_instance_name,
  host,
  port,
  connect_scheme,
  enabled,
  created_at,
  updated_at,
  auto_stop_enabled
)
SELECT
  id,
  game_title_norm,
  display_title,
  amp_instance_id,
  amp_instance_name,
  host,
  port,
  connect_scheme,
  enabled,
  created_at,
  updated_at,
  auto_stop_enabled
FROM game_server_bindings;

DROP TABLE game_server_bindings;
ALTER TABLE game_server_bindings__new RENAME TO game_server_bindings;

CREATE UNIQUE INDEX IF NOT EXISTS game_server_bindings_title_unique ON game_server_bindings(game_title_norm);
