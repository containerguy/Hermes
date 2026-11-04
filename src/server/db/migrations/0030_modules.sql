-- Modulverwaltung: Quellen (Git-Repos mit Index-Datei), installierte Module und ihre Einstellungen.
-- Rechte der Module kommen in das gemeinsame Rechtesystem des Kerns (RBAC), nicht hierher.

CREATE TABLE IF NOT EXISTS module_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT 'main',
  trust TEXT NOT NULL CHECK (trust IN ('official', 'third_party')),
  -- Nur der Name einer Umgebungsvariablen (MATCHDESK_SOURCE_TOKEN_…), nie das Token selbst.
  token_env TEXT,
  last_fetched_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS module_sources_url_ref ON module_sources (url, ref);

CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  -- NULL = verwaist (Quelle gelöscht) oder eingebaut; das Modul kann dann nur noch deinstalliert werden.
  source_id TEXT REFERENCES module_sources (id) ON DELETE SET NULL,
  version TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  package_url TEXT,
  previous_version TEXT,
  state TEXT NOT NULL CHECK (state IN ('installed', 'enabled', 'disabled')),
  manifest_json TEXT NOT NULL,
  last_error TEXT,
  installed_at TEXT NOT NULL,
  enabled_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS module_settings (
  module_id TEXT PRIMARY KEY REFERENCES modules (id) ON DELETE CASCADE,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO module_sources (id, name, url, ref, trust, token_env, created_at, updated_at)
VALUES (
  'official',
  'Matchdesk (offiziell)',
  'https://github.com/containerguy/matchdesk-modules',
  'main',
  'official',
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
