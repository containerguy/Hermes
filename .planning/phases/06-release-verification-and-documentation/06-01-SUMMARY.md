# Phase 06 Plan 06-01: Release-critical tests (REL-01/REL-02/REL-03) — Summary

Added a small set of **release-critical, network-free regression tests** covering destructive admin authorization and service worker push payload robustness.

## What changed

- **Admin destructive authz (REL-02)**
  - Added a test to `src/server/http/app-flow.test.ts` asserting:
    - unauthenticated requests to `POST /api/admin/backup` and `POST /api/admin/restore` return `401 nicht_angemeldet`
    - authenticated **non-admin** users (created via admin API in-test) receive `403 admin_erforderlich` even with CSRF.

- **Service worker malformed push payload (REL-03)**
  - Added `src/server/push/service-worker-push.test.ts` which loads `public/sw.js` in a VM harness and asserts the push handler does **not throw** on malformed payload JSON and shows a fallback notification.

## Verification

- `npm test`

