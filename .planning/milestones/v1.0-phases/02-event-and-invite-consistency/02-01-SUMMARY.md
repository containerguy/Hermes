---
phase: 02-event-and-invite-consistency
plan: 01
subsystem: auth
tags: [sqlite, better-sqlite3, drizzle, concurrency, vitest, supertest]
requires:
  - phase: 01-auth-profile-and-invite-hardening
    provides: "Public invite registration + invite_code_uses tracking + best-effort audit logging"
provides:
  - "Atomic invite maxUses enforcement for POST /api/auth/register (INV-03) via BEGIN IMMEDIATE transaction with bounded retry"
  - "Deterministic INV-03 concurrency regression test (exactly one winner, one 403 invite_ausgeschoepft, uses count stays 1)"
affects: [event-and-invite-consistency, auth-routes, invite-codes, sqlite-transactions]
tech-stack:
  added: []
  patterns:
    - "Capacity check + consumption performed inside a single SQLite immediate transaction"
    - "Bounded retry on SQLITE_BUSY*/SQLITE_LOCKED* for contention tolerance"
key-files:
  created: []
  modified:
    - src/server/http/auth-routes.ts
    - src/server/http/app-flow.test.ts
key-decisions:
  - "Kept loser response stable as 403 { error: \"invite_ausgeschoepft\" } (D-01)"
  - "Logged exhausted-invite rejections via best-effort audit with IP/username metadata when available (D-02)"
  - "Implemented exactly one retry on SQLITE_BUSY*/SQLITE_LOCKED* (D-03)"
  - "Added optional remainingUses only on success (D-04)"
patterns-established:
  - "INV-03: use COUNT(*) of invite_code_uses inside BEGIN IMMEDIATE write transaction"
requirements-completed: [INV-03]
duration: 3m
completed: 2026-04-16
---

# Phase 02 Plan 01: Invite maxUses atomicity Summary

**Invite registration now enforces `maxUses` atomically under concurrency using a `BEGIN IMMEDIATE` SQLite transaction with one bounded busy/locked retry, plus deterministic regression coverage.**

## Performance

- **Duration:** 3m
- **Started:** 2026-04-16T12:37:00Z
- **Completed:** 2026-04-16T12:40:11Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Atomic `invite_codes.maxUses` enforcement inside the same transaction that inserts `users` + `invite_code_uses`
- Exactly-one-winner behavior under concurrent registration requests (loser gets stable `403 invite_ausgeschoepft`)
- Best-effort audit logging for exhausted-invite rejections with IP/username metadata when available

## Task Commits

Each task was committed atomically:

1. **Task 1: Make invite consumption atomic in register route** - `43c7583` (feat)
2. **Task 2: Add deterministic concurrency regression test for INV-03** - `fbb436e` (test)

**Plan metadata:** committed with summary/state/roadmap/requirements update

## Files Created/Modified

- `src/server/http/auth-routes.ts` - Move invite-use capacity check + consumption into `context.sqlite.transaction(...).immediate()` with one retry on `SQLITE_BUSY*`/`SQLITE_LOCKED*`; add best-effort audit for exhausted invites.
- `src/server/http/app-flow.test.ts` - Add `INV-03` concurrency integration test that asserts exactly one `201` and one `403 invite_ausgeschoepft`, plus persisted `invite_code_uses` count == 1.

## Decisions Made

None - followed plan and Phase 02 context decisions D-01..D-04 as specified.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 02 Plan 02 can reuse the same transaction + bounded retry approach for event participation capacity enforcement (EVT-01).

## Self-Check: PASSED

- Summary file exists: `.planning/phases/02-event-and-invite-consistency/02-01-SUMMARY.md`
- Commits exist: `43c7583`, `fbb436e`

