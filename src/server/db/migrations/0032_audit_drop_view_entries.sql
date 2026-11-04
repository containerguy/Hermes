-- Reines Anzeigen der Rate-Limits und der Allowlist wird nicht mehr protokolliert.
-- Die bisherigen Einträge dieser Art sind nur Rauschen im Audit-Log und werden entfernt.
DELETE FROM audit_logs WHERE action IN ('rate_limits.list', 'rate_limits.allowlist_list');
