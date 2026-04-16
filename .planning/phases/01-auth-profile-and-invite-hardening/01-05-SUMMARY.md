---
phase: 01
plan: 01-05
subsystem: frontend
tags: [auth, csrf, profile, sessions, invites, admin-ui]
requires: [01-02, 01-03, 01-04, 01-07]
provides: [phase-1-ui-wiring]
affects: [src/main.tsx, src/styles.css]
tech_stack:
  added: []
  patterns: [single-file-react-ui, fetch-with-credentials, csrf-header]
key_files:
  modified:
    - src/main.tsx
    - src/styles.css
decisions: []
metrics:
  started_at: "2026-04-16T09:55:40Z"
  completed_at: "2026-04-16T10:00:51Z"
  duration_seconds: 311
---

# Phase 01 Plan 01-05: UI wiring for CSRF, profile, and invites Summary

Wired Phase 1 auth/profile/invite hardening APIs into the existing React UI without starting the Phase 5 frontend extraction.

## Completed Tasks

### 01-05-01 Add CSRF-aware client requests and German error mapping

- Lazy-load CSRF token from `GET /api/auth/csrf` after login/session restore.
- Attach `X-Hermes-CSRF` on authenticated `POST/PATCH/PUT/DELETE` calls while keeping public login/register routes CSRF-exempt.
- Added German error messages for new backend error codes.

**Commit:** `357c9ab`

### 01-05-02 Wire profile, email-change, and device management UI

- Added display-name edit (`PATCH /api/auth/profile`) and clarified “Login” (username) vs mutable display name.
- Added email-change request + verification (`POST /api/auth/email-change`, `POST /api/auth/email-change/verify`) with a safe client-side logout on confirm.
- Added per-session rename controls (`PATCH /api/auth/sessions/:id`) in the existing device list.

**Commit:** `021ab04`

### 01-05-03 Wire invite lifecycle UI

- Removed custom invite-code input (Phase 1 uses generated-only high entropy codes).
- Added invite lifecycle controls: edit label/maxUses/expiry (`PATCH /api/admin/invite-codes/:id`), deactivate/reactivate, and delete unused invites.
- Added German copy for defaults: **300** uses and **30 Tage** when omitted.

**Commit:** `b8d990b`

## Verification

- `npm run build`
- `npm test -- --run src/server/http/app-flow.test.ts`

## Deviations from Plan

None — plan executed as written.

## Known Stubs

None found.

## Self-Check: PASSED

- Summary file present
- Commits present: `357c9ab`, `021ab04`, `b8d990b`

