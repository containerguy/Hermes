-- Rechte und Rollen (RBAC).
-- Rechte haben feste Schlüssel; Module melden eigene Rechte an (module_id) und entfernen sie beim
-- Deinstallieren samt Vergaben. Rollen sind Bündel von Rechten. Die vier bisherigen Rollen sind
-- mitgelieferte Rollen und bleiben als Grundrolle am Benutzer (users.role) erhalten.
-- Zusätzlich vergibt ein Admin Rollen oder einzelne Rechte global oder nur für ein Event.
-- Event-Vergaben gelten nur, solange das Event nicht beendet ist.
CREATE TABLE IF NOT EXISTS permissions (
  key TEXT PRIMARY KEY NOT NULL,
  module_id TEXT,
  label TEXT NOT NULL,
  description TEXT,
  -- 1 = darf auch nur für ein Event vergeben werden
  scopable INTEGER NOT NULL DEFAULT 0 CHECK (scopable IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS roles_key_unique ON roles(key);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS user_grants (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT REFERENCES permissions(key) ON DELETE CASCADE,
  -- NULL = global, sonst nur für dieses Event
  main_event_id TEXT REFERENCES main_events(id) ON DELETE CASCADE,
  granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK ((role_id IS NULL) <> (permission_key IS NULL))
);
CREATE INDEX IF NOT EXISTS user_grants_user_idx ON user_grants(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS user_grants_event_idx ON user_grants(main_event_id);

-- Rechte des Kerns
INSERT OR IGNORE INTO permissions (key, module_id, label, description, scopable, created_at) VALUES
  ('rounds.create', NULL, 'Runden anlegen', 'Neue Spielrunden anlegen; eigene Runden verwalten', 1, '2026-11-03T00:00:00.000Z'),
  ('rounds.manage', NULL, 'Alle Runden verwalten', 'Fremde Runden bearbeiten, archivieren und stornieren', 1, '2026-11-03T00:00:00.000Z'),
  ('main_events.manage', NULL, 'Events verwalten', 'Events anlegen, starten, beenden, Einladungen und Anmeldungen verwalten', 1, '2026-11-03T00:00:00.000Z'),
  ('notifications.operator', NULL, 'Orga-Benachrichtigungen', 'Benachrichtigungen für die Orga erhalten (z. B. neue Runden)', 1, '2026-11-03T00:00:00.000Z'),
  ('pizza.manage', NULL, 'Pizza verwalten', 'Speisekarte, Bestellrunden und Zahlungen verwalten', 0, '2026-11-03T00:00:00.000Z'),
  ('servers.view', NULL, 'Gameserver sehen', 'Gameserver-Instanzen beim Anlegen von Runden auswählen', 0, '2026-11-03T00:00:00.000Z'),
  ('servers.manage', NULL, 'Gameserver steuern', 'Gameserver starten, stoppen und bedienen', 0, '2026-11-03T00:00:00.000Z'),
  ('servers.bind', NULL, 'Gameserver zuordnen', 'Spiele mit Gameserver-Instanzen verknüpfen', 0, '2026-11-03T00:00:00.000Z'),
  ('admin.access', NULL, 'Administration', 'Benutzer, Rechte, Einstellungen, Betrieb und Audit-Log verwalten', 0, '2026-11-03T00:00:00.000Z');

INSERT OR IGNORE INTO roles (id, key, label, builtin, created_at, updated_at) VALUES
  ('role-user', 'user', 'Benutzer', 1, '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z'),
  ('role-organizer', 'organizer', 'Organisator', 1, '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z'),
  ('role-manager', 'manager', 'Manager', 1, '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z'),
  ('role-admin', 'admin', 'Admin', 1, '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z');

-- Die mitgelieferten Rollen entsprechen genau den bisherigen Prüfungen. Admin hat zusätzlich
-- immer alle Rechte, auch die von Modulen (im Code).
INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES
  ('role-organizer', 'rounds.create'),
  ('role-organizer', 'notifications.operator'),
  ('role-organizer', 'servers.view'),
  ('role-manager', 'rounds.create'),
  ('role-manager', 'rounds.manage'),
  ('role-manager', 'main_events.manage'),
  ('role-manager', 'notifications.operator'),
  ('role-manager', 'pizza.manage'),
  ('role-manager', 'servers.view'),
  ('role-manager', 'servers.manage'),
  ('role-admin', 'rounds.create'),
  ('role-admin', 'rounds.manage'),
  ('role-admin', 'main_events.manage'),
  ('role-admin', 'notifications.operator'),
  ('role-admin', 'pizza.manage'),
  ('role-admin', 'servers.view'),
  ('role-admin', 'servers.manage'),
  ('role-admin', 'servers.bind'),
  ('role-admin', 'admin.access');
