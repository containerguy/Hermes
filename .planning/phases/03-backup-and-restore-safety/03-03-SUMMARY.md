# Phase 03 Plan 03-03: Audit + UI + operator docs (BKP-05/BKP-06) — Summary

Completed Phase 3 end-to-end operator safety wiring: **best-effort audit coverage**, Admin UI rendering for **backup status + restore recovery/diagnostics**, and a short **operator runbook** in docs.

## What changed

- Added best-effort audit events around backup/restore and storage config checks:
  - `storage.config_check`
  - `storage.backup_start` / `storage.backup_success` / `storage.backup_failed`
  - `storage.restore_start` / `storage.restore_validated` / `storage.restore_recovery_created` / `storage.restore_completed` / `storage.restore_failed`
- Ensured audit metadata is safe by construction (explicit allowlist, truncated strings; never raw errors/headers/stacks).
- Updated Admin UI (`/#admin`) to:
  - show backup status + non-secret S3 location details via existing admin settings fetch
  - show restore recovery info (`recovery.id`, `recovery.key`) on success
  - render compact restore diagnostics panel (safe bounded fields only) on failure
- Updated `readme.md` and `building.md` with an operator runbook:
  - single-writer warning (SQLite + S3 snapshots)
  - how to verify backups in Admin UI
  - validation-first restore model + retention (keep 10 recoveries)
  - rollback steps using recovery key (`aws s3 cp ...`) and `HERMES_S3_DB_KEY`

## Verification

- `npm test -- --run src/server/http/app-flow.test.ts`
- `npm test`
- `npm run build`

