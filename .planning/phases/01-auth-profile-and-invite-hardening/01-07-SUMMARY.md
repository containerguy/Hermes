---
phase: 01-auth-profile-and-invite-hardening
plan: 01-07
subsystem: auth
tags: [sessions, csrf, express, sqlite, drizzle]

requires:
  - phase: 01-auth-profile-and-invite-hardening
    provides: "Phase 1 schema additions for sessions.tokenHash and auth route foundations"
provides:
  - "Session persistence stores only token hashes (no replayable cookie bearer tokens)"
  - "Session lookup by token hash with legacy tokenHash=null treated as invalid"
  - "Session revocation after admin role/email changes and deletion"
  - "CSRF token endpoint + x-hermes-csrf contract enforced on authenticated mutations"
affects: ["auth-routes", "admin-routes", "frontend requestJson CSRF header (future)"]

tech-stack:
  added: []
  patterns:
    - "Cookie sessions resolved via token hash, not raw bearer token"
    - "Router-level CSRF middleware for authenticated mutations with explicit public exemptions"

key-files:
  created:
    - src/server/auth/csrf.ts
  modified:
    - src/server/auth/sessions.ts
    - src/server/auth/current-user.ts
    - src/server/http/auth-routes.ts
    - src/server/http/admin-routes.ts
    - src/server/http/app-flow.test.ts

key-decisions:
  - "CSRF token is an HMAC-SHA256 of the non-secret session id, sent via x-hermes-csrf header and fetched from GET /api/auth/csrf."
  - "Legacy session rows missing tokenHash are treated as invalid and require re-login (D-24)."

patterns-established:
  - "Audit entity IDs use non-secret sessions.id, never raw cookie token"

requirements-completed: [AUTH-02, AUTH-04, AUTH-05, AUTH-06]

duration: 5m
completed: 2026-04-16
---

# Phase 01 Plan 01-07: Hashed Sessions + CSRF Baseline Summary

**Persisted sessions no longer store replayable cookie tokens, and authenticated cookie mutations now require an explicit `x-hermes-csrf` header fetched via `/api/auth/csrf`.**

## Performance

- **Duration:** 5m
- **Started:** 2026-04-16T09:31:05Z
- **Completed:** 2026-04-16T09:34:40Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Session persistence now stores a **token hash** (SHA-256) and keeps `sessions.id` as a non-secret identifier.
- Current-session lookup uses `sessions.tokenHash` and **rejects legacy** `tokenHash = null` rows (forces re-login).
- Admin role/email changes revoke user sessions; authenticated mutations in auth/admin routes are CSRF-protected with explicit public exemptions.

## Task Commits

Each task was committed atomically:

1. **Task 1: Store hashed session tokens and revoke sensitive changes** - `60b2c66` (feat)
2. **Task 2: Add CSRF baseline for authenticated mutations** - `c0b3f50` (feat)

Additional fix commit (verification-required):

- **Build fix:** `773e614` (fix)

**Plan metadata:** included in the final `docs(01-07)` commit (SUMMARY + state/roadmap/requirements updates)

## Files Created/Modified

- `src/server/auth/sessions.ts` - add `createSessionId()` and `hashSessionToken()`
- `src/server/auth/current-user.ts` - resolve session by `sessions.tokenHash` (no `eq(sessions.id, token)`)
- `src/server/http/auth-routes.ts` - persist `sessions.id` separately from cookie token; add `/api/auth/csrf`; enforce CSRF on authenticated mutations
- `src/server/http/admin-routes.ts` - revoke sessions on admin role/email changes; enforce CSRF on admin mutations
- `src/server/auth/csrf.ts` - CSRF token creation/verification + middleware helper
- `src/server/http/app-flow.test.ts` - integration tests for hashed sessions, legacy rejection, revocation, and CSRF enforcement/exemptions

## Decisions Made

- Used a **stable per-session CSRF token** derived from the non-secret `sessions.id` via HMAC-SHA256, delivered via `GET /api/auth/csrf`, and enforced via `x-hermes-csrf` on mutating auth/admin routes.
- Legacy sessions without `tokenHash` are treated as invalid to avoid supporting a credential-like persisted token shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed TypeScript typing for `set-cookie` header parsing**
- **Found during:** Plan verification (`npm run build`)
- **Issue:** TypeScript flagged an unsafe cast of `verify.headers["set-cookie"]` in `app-flow.test.ts`
- **Fix:** Handle `string | string[] | undefined` safely via `Array.isArray(...)`
- **Files modified:** `src/server/http/app-flow.test.ts`
- **Verification:** `npm run build`
- **Committed in:** `773e614`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required for CI/build correctness; no scope creep.

## Issues Encountered

- TypeScript build failed due to header typing; resolved with a narrow, type-safe parsing tweak.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for frontend integration of the `x-hermes-csrf` header in `requestJson()` (Phase 1 follow-on).
- Auth hardening invariants are now enforced and covered by integration tests.

## Self-Check: PASSED

- FOUND: `.planning/phases/01-auth-profile-and-invite-hardening/01-07-SUMMARY.md`
- FOUND commits: `60b2c66`, `c0b3f50`, `773e614`

---
*Phase: 01-auth-profile-and-invite-hardening*
*Completed: 2026-04-16*

