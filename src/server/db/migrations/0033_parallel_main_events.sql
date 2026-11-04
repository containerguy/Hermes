-- Mehrere Events dürfen gleichzeitig laufen; die Obergrenze prüft die App (Einstellung maxRunningMainEvents).
DROP INDEX IF EXISTS main_events_single_running;
