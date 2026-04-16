---
phase: 01-auth-profile-and-invite-hardening
plan: 01-04
subsystem: api
tags: [express, sqlite, drizzle, rate-limit, invite, audit, vitest]

requires:
  - phase: 01-auth-profile-and-invite-hardening
    provides: persisted rate-limit helpers and admin rate-limit operations (01-02)
provides:
  - Throttled public invite registration attempts (invite_register)
  - Crypto-generated invite codes (16 Crockford chars, >=80 bits entropy)
  - Generated-only admin invite creation (custom codes rejected)
  - Masked invite audit metadata while keeping full codes in admin list API
  - Admin invite lifecycle endpoints (edit/deactivate/reactivate/safe delete)
affects: [admin-ui, invite-ui, auth]

tech-stack:
  added: []
  patterns:
    - Persisted rate-limits keyed by IP + submitted invite code (DB stores redacted key)
    - Invite codes treated as credential-like: full visibility for admins, masked in audit metadata

key-files:
  created: []
  modified:
    - src/server/http/auth-routes.ts
    - src/server/http/admin-routes.ts
    - src/server/audit-log.ts
    - src/server/http/app-flow.test.ts

key-decisions:
  - "Rate-limit invite registration using IP + submitted invite code and record failures only on error paths."
  - "Disable admin-supplied invite codes; backend always generates 16-char Crockford codes from 10 crypto-random bytes (>=80 bits)."
  - "Keep full invite codes in admin list/create responses (D-15) while masking codes in audit metadata (D-16)."
  - "Preserve used invite history by preventing hard deletes when usedCount > 0 (INV-07)."

patterns-established:
  - "Invite lifecycle endpoints use 409 conflict errors for capacity/history constraints (usedCount, expiry)."

requirements-completed: [INV-01, INV-02, INV-04, INV-05, INV-06, INV-07]

duration: 6m
completed: 2026-04-16
---

# Phase 01 Plan 01-04: Invite Hardening Summary

**Invite registration probing is throttled; invite codes are generated-only (>=80-bit entropy) with masked audit metadata and full admin lifecycle endpoints.**

## Performance

- **Duration:** 6m
- **Started:** 2026-04-16T09:36:54Z
- **Completed:** 2026-04-16T09:42:10Z
- **Tasks:** 4/4
- **Files modified:** 4

## Accomplishments

- Public invite registration is rate-limited (`invite_register`) before invite lookup, with failures recorded for invalid/exhausted/disabled/malformed/duplicate cases.
- Admin invite creation now generates 16-character Crockford-style codes from crypto randomness and rejects any `code/customCode` input.
- Invite audit metadata stores masked codes only, while admin APIs still return full invite codes for LAN operations.
- Admin invite lifecycle endpoints support edit/deactivate/reactivate and safe delete (unused only), preserving used-code history.

## Task Commits

Each task was committed atomically:

1. **Task 01-04-01: Throttle invite registration attempts** - `d51853a`
2. **Task 01-04-02: Enforce invite entropy + audit redaction** - `d6ebcc5`
3. **Task 01-04-03: Add invite lifecycle endpoints** - `86f26c8`
4. **Task 01-04-04: Consolidate invite backend tests** - `ae8b383`

## Files Modified

- `src/server/http/auth-routes.ts` - Rate-limit `POST /api/auth/register` by IP + invite code, and record failures on error paths.
- `src/server/http/admin-routes.ts` - Generated-only invite creation defaults + lifecycle endpoints (edit/deactivate/reactivate/delete-unused).
- `src/server/audit-log.ts` - `maskInviteCode()` helper for invite audit redaction.
- `src/server/http/app-flow.test.ts` - Integration coverage for invite throttling, entropy, custom-code disabled, full admin visibility, audit masking, and lifecycle.

## Decisions Made

None beyond the plan’s specified contract.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Backend invite API contract is ready for the Phase 01-05 admin UI changes (generated-only creation + lifecycle controls).

## Self-Check: PASSED

- Summary file exists: `.planning/phases/01-auth-profile-and-invite-hardening/01-04-SUMMARY.md`
- Task commits verified: `d51853a`, `d6ebcc5`, `86f26c8`, `ae8b383`

