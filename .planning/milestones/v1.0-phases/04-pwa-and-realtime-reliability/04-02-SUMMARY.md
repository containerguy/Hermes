---
phase: 04-pwa-and-realtime-reliability
plan: 04-02
subsystem: api
tags: [pwa, push, service-worker, sqlite, migrations, vitest]

requires:
  - phase: 01-auth-profile-and-invite-hardening
    provides: stable error-code conventions + DB migration discipline
provides:
  - Crash-safe service worker push parsing
  - Push subscription failure tracking + automatic revocation
affects: [push, pwa, release-tests]

tech-stack:
  added: []
  patterns:
    - "Revocation policy: revoke immediately on 404/410; revoke after N consecutive failures"
    - "Mock external push transport (web-push) in tests to keep CI offline"

key-files:
  created:
    - src/server/db/migrations/0008_push_subscription_failures.sql
    - src/server/push/push-service-cleanup.test.ts
  modified:
    - public/sw.js
    - src/server/db/schema.ts
    - src/server/push/push-service.ts

key-decisions:
  - "Track per-subscription delivery failures and revoke after 3 consecutive failures."
  - "Keep service worker push handler non-throwing with safe payload fallback."

patterns-established:
  - "Push failure tracking lives on push_subscriptions row (failure_count + last_failure_at/last_success_at)."

requirements-completed: [PWA-02, PWA-03]

duration: n/a
completed: 2026-04-16
---

# Phase 4 Plan 04-02: SW hardening + subscription cleanup Summary

**Service worker no longer crashes on malformed push payloads, and server revokes failing push subscriptions (immediately on 404/410, or after 3 failures) with mocked test coverage.**

## Performance

- **Duration:** n/a
- **Tasks:** 2
- **Files modified:** 3
- **Files created:** 2

## Accomplishments
- Hardened `public/sw.js` push payload parsing to avoid runtime crashes on malformed payloads.
- Added migration-backed failure tracking for push subscriptions and automatic revocation policy.
- Added mocked tests for repeated failures and 404/410 revocation (no network required).

## Task Commits

Each task was committed atomically (TDD task includes RED+GREEN commits):

1. **Task 1: Make service worker push payload parsing crash-safe** - `c0c231d` (feat)
2. **Task 2: Add subscription failure tracking and revoke repeatedly failing subscriptions**
   - `5f300d6` (test - RED)
   - `8fba556` (feat - GREEN)

**Plan metadata:** `39f5b6b` (docs)

## Files Created/Modified
- `public/sw.js` - Safe JSON parsing with fallback payload.
- `src/server/db/migrations/0008_push_subscription_failures.sql` - Adds failure tracking columns to `push_subscriptions`.
- `src/server/db/schema.ts` - Exposes failure tracking fields.
- `src/server/push/push-service.ts` - Tracks failures/success and revokes on policy.
- `src/server/push/push-service-cleanup.test.ts` - Mocked delivery tests.

## Decisions Made
None - followed plan as specified.

## Deviations from Plan
Minor: tests were added as a dedicated `push-service` test file (instead of extending `event-side-effects.test.ts`) to keep scope isolated and avoid interfering with existing mocks.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Ready for SSE heartbeat/reconnect resilience (04-03).

---
*Phase: 04-pwa-and-realtime-reliability*
*Completed: 2026-04-16*

