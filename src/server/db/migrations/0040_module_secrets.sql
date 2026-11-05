-- Zugangsdaten der Module (z. B. Telegram-Bot-Token), im Admin unter Module › <Modul> eingetragen.
-- Nur verschlüsselt (AES-256-GCM, Schlüssel aus MATCHDESK_DEVICE_KEY_SECRET); eine gesetzte
-- Umgebungsvariable MATCHDESK_<NAME> hat weiter Vorrang.
CREATE TABLE IF NOT EXISTS module_secrets (
  module_id TEXT NOT NULL REFERENCES modules (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (module_id, name)
);
