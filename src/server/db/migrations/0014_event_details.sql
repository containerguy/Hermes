ALTER TABLE game_events ADD COLUMN details TEXT;

UPDATE game_events
SET details = CASE
  WHEN TRIM(COALESCE(server_host, '')) = '' AND TRIM(COALESCE(connection_info, '')) = '' THEN NULL
  WHEN TRIM(COALESCE(server_host, '')) = '' THEN TRIM(connection_info)
  WHEN TRIM(COALESCE(connection_info, '')) = '' THEN TRIM(server_host)
  ELSE TRIM(server_host) || char(10) || TRIM(connection_info)
END;

ALTER TABLE game_events DROP COLUMN server_host;
ALTER TABLE game_events DROP COLUMN connection_info;
