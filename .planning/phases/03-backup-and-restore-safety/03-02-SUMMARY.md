# Phase 03 Plan 03-02: Validation-first restore + recoveries (BKP-02/BKP-03/BKP-04) — Summary

Implemented a **validation-first, hard-blocked** admin restore flow with **safe diagnostics**, **pre-restore recovery snapshots**, and **explicit-column-only** copying in a single transaction (all-or-nothing).

## What changed

- Added restore recovery metadata table (`storage_restore_recoveries`) for tracking created recovery keys.
- Replaced the unsafe restore implementation with:
  - Snapshot validation before live mutation (required tables, schema migration match, compatible columns, snapshot FK + integrity check).
  - Pre-restore recovery snapshot upload to `recoveries/<timestamp>-<id>.sqlite` and retention cleanup (keep last **10**, best-effort).
  - Explicit-column `INSERT ... SELECT` per table (no `SELECT *`) inside a single SQLite transaction; rollback on any failure.
- Updated `POST /api/admin/restore` to return:
  - `400 { error: "restore_fehlgeschlagen", diagnostics }` for validation errors.
  - `500 { error: "restore_fehlgeschlagen", diagnostics }` for unexpected errors.

## Safe diagnostics contract

- Diagnostics are **allowlisted**, lists are capped, and strings are truncated.
- No secrets, request/response headers, or stack traces are returned.

## Verification

- `npm test -- --run src/server/http/app-flow.test.ts`
- `npm test`
- `npm run build`

