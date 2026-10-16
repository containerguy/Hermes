-- Pizza-Verwaltung ab manager: Bestellrunden archivieren, Menü-Varianten deaktivieren statt
-- löschen (bestehende Bestellzeilen referenzieren sie per ON DELETE RESTRICT) und Bezahlart
-- (Bargeld oder PayPal) je Bestellung.

ALTER TABLE pizza_sessions ADD COLUMN archived_at TEXT;
ALTER TABLE pizza_sessions ADD COLUMN archived_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS pizza_sessions_archived_created_idx ON pizza_sessions(archived_at, created_at);

ALTER TABLE pizza_menu_variants ADD COLUMN active INTEGER NOT NULL DEFAULT 1;

ALTER TABLE pizza_orders ADD COLUMN payment_method TEXT
  CHECK (payment_method IS NULL OR payment_method IN ('cash', 'paypal'));

-- Bereits bezahlte Bestellungen übernehmen die Bezahlart aus dem Zahlungsstatus.
UPDATE pizza_orders SET payment_method = 'paypal' WHERE payment_status = 'paid_paypal';
UPDATE pizza_orders SET payment_method = 'cash' WHERE payment_status = 'paid_cash';

-- Altlasten aufräumen: Bereits gelieferte Runden sowie alle Runden außer der jüngsten wandern
-- ins Archiv. So verschwinden Reste vergangener Bestellungen aus der aktuellen Ansicht, bleiben
-- aber für manager/admin im Archiv einsehbar.
UPDATE pizza_sessions
SET archived_at = updated_at
WHERE archived_at IS NULL
  AND (
    state = 'delivered'
    OR id <> (SELECT id FROM pizza_sessions ORDER BY created_at DESC LIMIT 1)
  );
