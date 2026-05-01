---
phase: 02-event-and-invite-consistency
plan: 02
subsystem: api
tags: [sqlite, better-sqlite3, drizzle, concurrency, vitest, supertest]

# Dependency graph
requires:
  - phase: 01-auth-profile-and-invite-hardening
    provides: Established SQLite transaction usage patterns and integration test harness.
provides:
  - Atomic event participation capacity enforcement for `POST /api/events/:id/participation` (EVT-01)
  - Deterministic concurrency regression test proving one-winner semantics for `maxPlayers`
affects:
  - Phase 02 Plan 03 (side-effects coherence around rejections/success)
  - Phase 06 (REL-01 concurrency coverage)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "BEGIN IMMEDIATE (better-sqlite3 .transaction(...).immediate()) for capacity-sensitive writes"
    - "One bounded retry on SQLITE_BUSY*/SQLITE_LOCKED* for lock contention"

key-files:
  created:
    - src/server/http/event-capacity.test.ts
  modified:
    - src/server/http/event-routes.ts

key-decisions:
  - "Return `409 { error: \"event_voll\", event }` for capacity losers (D-09), while keeping `error` stable."

patterns-established:
  - "Capacity check and participation upsert occur inside the same immediate SQLite transaction."
  - "Transient lock contention is handled by retrying the whole immediate transaction once."

requirements-completed: [EVT-01]

# Metrics
duration: 4m
completed: 2026-04-16
---

# Phase 02 Plan 02: Event Participation Capacity Atomicity Summary

**Event join capacity (`maxPlayers`) is enforced atomically under concurrency via `BEGIN IMMEDIATE` + one busy/locked retry, with a deterministic regression test proving one winner.**

## Performance

- **Duration:** 4m
- **Started:** 2026-04-16T12:41:00Z
- **Completed:** 2026-04-16T12:45:11Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Moved the `joinedCount` capacity check into the same immediate SQLite transaction as the participation upsert, preventing oversubscription under concurrent joins.
- Added a concurrency integration test that fires two concurrent join requests and asserts exactly one `200` and one `409 event_voll`, while persisting `joinedCount === 1`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Enforce maxPlayers atomically inside an immediate transaction** - `0c352a1` (feat)
2. **Task 2: Add deterministic concurrency regression test for EVT-01** - `6aac531` (test)

## Files Created/Modified

- `src/server/http/event-routes.ts` - Enforces join capacity + upsert within `BEGIN IMMEDIATE` transaction and retries once on `SQLITE_BUSY*`/`SQLITE_LOCKED*`.
- `src/server/http/event-capacity.test.ts` - Concurrency regression test for EVT-01.

## Decisions Made

- Return `409 { error: "event_voll", event }` for capacity losers (D-09), while keeping `error` stable for client fallback behavior.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- EVT-01 is now protected under concurrency and has deterministic regression coverage.
- Ready to proceed to Plan 02-03 to validate side effects (audit/SSE/push) coherence for winner vs. loser outcomes.

## Self-Check: PASSED

- Found `.planning/phases/02-event-and-invite-consistency/02-02-SUMMARY.md`
- Found task commits: `0c352a1`, `6aac531`

