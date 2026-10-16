-- Phase 15-04 (LAN-Abnahme): Leerlauf-Stopp pro Bindung freischalten, Standard aus.
-- AMP zählt Spieler über Console.UserJoinRegex; bei manchen Spielen (Soldat, UT2004, CoD4) ist das
-- Muster leer und "Active Users" bleibt immer 0. Ohne Freischaltung stoppt Hermes eine Bindung nie.
ALTER TABLE game_server_bindings ADD COLUMN auto_stop_enabled INTEGER NOT NULL DEFAULT 0;
