-- „Spielt gerade“ ist ab Matchdesk 0.17 ein Modul (presence). Seine Tabellen tragen jetzt dessen
-- Präfix; Daten bleiben erhalten. Das Modul übernimmt sie beim Installieren (CREATE … IF NOT EXISTS).
ALTER TABLE game_agent_keys RENAME TO presence_agent_keys;
DROP INDEX IF EXISTS game_agent_keys_key_hash_unique;
CREATE UNIQUE INDEX IF NOT EXISTS presence_agent_keys_key_hash_unique ON presence_agent_keys(key_hash);
ALTER TABLE user_game_accounts RENAME TO presence_game_accounts;
ALTER TABLE user_game_account_prefs RENAME TO presence_game_account_prefs;
