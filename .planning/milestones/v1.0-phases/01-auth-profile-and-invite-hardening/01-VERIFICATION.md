---
phase: 01-auth-profile-and-invite-hardening
verified: 2026-04-16T12:19:30Z
status: human_needed
score: 7/7 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Auth smoke: request-code + verify-code + profile update"
    expected: "Login-code request shows generic success; verify logs in; profile display-name save succeeds without CSRF errors."
    why_human: "End-to-end browser flow (cookies + CSRF header + UI state) is best validated manually."
  - test: "Email-change confirmation flow"
    expected: "Request sends code to new email; wrong code rejected; correct code confirms email and logs out (re-login required)."
    why_human: "Mailer mode + user comprehension and UI messaging cannot be fully verified via static analysis."
  - test: "Admin lockout recovery"
    expected: "Admin can see active rate-limit blocks, clear one, add/delete allowlist entries; UI remains responsive."
    why_human: "UI rendering + operator usability is visual/interactive."
---

# Phase 1: Auth, Profile, And Invite Hardening Verification Report

**Phase Goal:** Auth, profile, and invite flows are safe enough to expose before the LAN party without leaking account existence, storing raw reusable credentials, or leaving account/session edge cases undefined.
**Verified:** 2026-04-16T12:19:30Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Must-Haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Login-code and invite-registration attempts are throttled while login-code requests return a generic success-shaped response. | ✓ VERIFIED | `POST /api/auth/request-code` always returns `202 { ok: true }` for valid input and is rate-limited; `POST /api/auth/register` is rate-limited with scope `invite_register`. Verified in code (`src/server/http/auth-routes.ts`) and tests (`src/server/http/app-flow.test.ts`). |
| 2 | Session storage, sensitive session invalidation, and CSRF posture have implemented safety behavior. | ✓ VERIFIED | Sessions store `tokenHash` (SHA-256) and current-session lookup uses `sessions.tokenHash`; legacy `token_hash = null` is rejected. CSRF token is HMAC over non-secret session id; authenticated mutations require `x-hermes-csrf`, with explicit public auth exemptions. Verified in `src/server/auth/sessions.ts`, `src/server/auth/current-user.ts`, `src/server/auth/csrf.ts`, and tests. |
| 3 | Active email uniqueness is enforced across admin-created users, invite registration, and profile changes. | ✓ VERIFIED | Shared `ensureActiveEmailAvailable()` guard is used for admin create/update, invite registration, and email-change request/verify. Verified in `src/server/domain/users.ts`, `src/server/http/admin-routes.ts`, `src/server/http/auth-routes.ts`, and tests. |
| 4 | Users can manage display name, confirmed email changes, and device/session names with validation and audit coverage. | ✓ VERIFIED | `PATCH /api/auth/profile`, `POST /api/auth/email-change`, `POST /api/auth/email-change/verify`, device-name derivation on login, and owner-only `PATCH /api/auth/sessions/:id` exist; UI calls these endpoints and attaches CSRF for authenticated mutations. Tests cover display name + email change + audit redaction of OTP. |
| 5 | Invite administration supports credential-safe display, deactivate/reactivate, edit, and unused-code removal without losing historical audit context. | ✓ VERIFIED | Admin invite creation is generated-only (custom codes rejected), codes are 16 Crockford chars from 10 random bytes (≥80 bits), audit metadata stores only masked codes, and lifecycle endpoints exist (edit/deactivate/reactivate/delete-unused with used-delete conflict). Verified in `src/server/http/admin-routes.ts`, `src/server/audit-log.ts`, and tests. |
| 6 | Audit logging failures do not block primary actions (D-27). | ✓ VERIFIED | `tryWriteAuditLog()` wraps `writeAuditLog()` and catches errors; tests simulate audit insert failure and assert auth/admin actions still succeed. |
| 7 | Admins can inspect/clear active rate-limit blocks and manage allowlisted LAN IPs from the AdminPanel UI (D-05). | ✓ VERIFIED | Admin APIs exist under `/api/admin/rate-limits*` and UI calls them and provides clear/add/delete actions. Verified in `src/server/http/admin-routes.ts` and `src/main.tsx`. |

**Score:** 7/7 truths verified (0 overrides)

### Required Artifacts (Exist/Substantive/Wired)

| Artifact | Expected | Status | Details |
|---------|----------|--------|---------|
| `src/server/http/auth-routes.ts` | Generic login + throttled auth/register + profile/email/session routes | ✓ VERIFIED | Routes implemented and covered by integration tests. |
| `src/server/http/admin-routes.ts` | Admin rate-limit ops + invite lifecycle + session revocation on sensitive changes | ✓ VERIFIED | APIs implemented + covered; CSRF enforced. |
| `src/server/auth/rate-limits.ts` | Persisted throttling + allowlist | ✓ VERIFIED | Enforced in auth routes; admin APIs + UI wired. |
| `src/server/auth/sessions.ts` | Non-secret session id + hashed token-at-rest | ✓ VERIFIED | Token hash is SHA-256; cookie uses random token; DB stores only hash. |
| `src/server/auth/current-user.ts` | Current session lookup by token hash | ✓ VERIFIED | Looks up by `sessions.tokenHash`; rejects deleted users. |
| `src/server/auth/csrf.ts` | Stable CSRF contract | ✓ VERIFIED | HMAC-SHA256 token; header enforced by middleware. |
| `src/server/domain/users.ts` | Active-email uniqueness guard | ✓ VERIFIED | Used across admin + invite + email-change flows. |
| `src/server/audit-log.ts` | Non-blocking audit + invite masking helper | ✓ VERIFIED | `tryWriteAuditLog()` + `maskInviteCode()`. |
| `src/server/db/migrations/0005_auth_profile_invite_hardening.sql` | Phase 1 schema foundation | ✓ VERIFIED | Adds `display_name`, `token_hash`, `email_change_challenges`, rate-limit tables + indexes. |
| `src/server/db/schema.ts` | Drizzle mirror of migration | ✓ VERIFIED | Mirrors the same names/indexes. |
| `src/main.tsx` | UI wiring for CSRF + profile + invite lifecycle + rate-limit ops | ✓ VERIFIED | `requestJson()` attaches `X-Hermes-CSRF` for authenticated mutations; AdminPanel exposes invite + rate-limit ops. |
| `src/server/http/app-flow.test.ts` | Regression coverage for Phase 1 risks | ✓ VERIFIED | 25 tests passed locally. |

### Key Link Verification (Wiring)

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/main.tsx` | `/api/auth/csrf` | `fetch()` in `getCsrfToken()` | ✓ WIRED | Token is lazily fetched and applied as `X-Hermes-CSRF` on non-exempt `/api/**` mutations. |
| `src/server/http/auth-routes.ts` | rate limiting | `checkRateLimit()` + `recordRateLimitFailure()` | ✓ WIRED | `login_request`, `login_verify`, `invite_register` scopes enforced. |
| `src/server/auth/current-user.ts` | sessions | `hashSessionToken(cookie)` + `eq(sessions.tokenHash, ...)` | ✓ WIRED | No lookup by raw cookie token. |
| `src/server/http/admin-routes.ts` | invite audit redaction | `maskInviteCode()` | ✓ WIRED | Audit metadata uses masked code, not full secret. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---------|---------------|--------|--------------------|--------|
| `src/server/http/auth-routes.ts` | login email destination | `users.email` at challenge issuance | Yes | ✓ FLOWING |
| `src/server/http/auth-routes.ts` | email-change destination | `newEmail` stored in `email_change_challenges` + `sendEmailChangeCode(to: newEmail)` | Yes | ✓ FLOWING |
| `src/main.tsx` | CSRF header | `/api/auth/csrf` response token | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---------|---------|--------|--------|
| Phase 1 regression suite | `npm test -- --run src/server/http/app-flow.test.ts` | 25/25 tests passed | ✓ PASS |
| Build pipeline | `npm run build` | Build succeeded (tsc + vite + server bundle) | ✓ PASS |

### Requirements Coverage (All Phase 1 IDs)

All requirement IDs listed in Phase 1 plans are present in `.planning/REQUIREMENTS.md` and mapped to Phase 1.

| Requirement | Source Plan(s) | Description | Status | Evidence |
|------------|-----------------|-------------|--------|----------|
| AUTH-01 | 01-02, 01-06 | Generic success-shaped login-code request response (no enumeration) | ✓ SATISFIED | `POST /api/auth/request-code` returns `202 { ok: true }` for known/unknown; test: "returns a generic success response..." |
| AUTH-02 | 01-01..01-08 | Practical rate limits + admin operability | ✓ SATISFIED | `src/server/auth/rate-limits.ts` + admin APIs + UI; tests cover throttling and admin clear. |
| AUTH-03 | 01-01, 01-02, 01-06 | Challenge cleanup + bounded growth | ✓ SATISFIED | Expired challenges deleted; older open challenges consumed; indexes exist; tests cover superseding/cleanup + migration assertions. |
| AUTH-04 | 01-01, 01-07, 01-06 | No persisted reusable raw session tokens | ✓ SATISFIED | DB stores `token_hash`; current lookup by hash; test asserts cookie token != any persisted session id. |
| AUTH-05 | 01-03, 01-07, 01-06 | Defined session invalidation on sensitive changes | ✓ SATISFIED | Admin role/email changes and deletion revoke sessions; tests assert `401` after each change. |
| AUTH-06 | 01-05, 01-07, 01-08, 01-06 | Explicit CSRF posture for mutating cookie-auth admin routes | ✓ SATISFIED | `requireCsrf()` enforced on admin mutations; `requestJson()` attaches header; tests cover missing/valid CSRF + public exemptions. |
| AUTH-07 | 01-01, 01-03, 01-05, 01-06 | One active account per email across entry points | ✓ SATISFIED | `ensureActiveEmailAvailable()` used across admin + invite + email-change; tests cover `email_existiert_bereits`. |
| PROF-01 | 01-01, 01-03, 01-05, 01-06 | Default device name before user edits | ✓ SATISFIED | UA-derived device names via `resolveDeviceName()`; tests cover Windows + iPhone defaults. |
| PROF-02 | 01-03, 01-05, 01-06 | User can change display name (validation + audit) | ✓ SATISFIED | `PATCH /api/auth/profile` validation + audit; UI wiring; tests cover update + audit entry. |
| PROF-03 | 01-01, 01-03, 01-05, 01-06 | Safe email change with confirmation before used for login codes | ✓ SATISFIED | Email-change challenge table + verify flow; login codes still go to old email pre-confirm; tests assert mailer destinations + session revocation. |
| INV-01 | 01-01, 01-02, 01-04, 01-05, 01-06 | Public invite registration throttled | ✓ SATISFIED | `invite_register` rate limit scope in `POST /api/auth/register`; tests cover repeated invalid invite throttling. |
| INV-02 | 01-04, 01-05, 01-06 | Invite entropy policy + credential-like handling | ✓ SATISFIED | Generated-only 16-char codes (10 random bytes) + docs in `README.md`; tests validate charset/length. |
| INV-04 | 01-04, 01-05, 01-06 | Admin invite list/audit avoid unnecessary reusable code disclosure | ✓ SATISFIED | Admin list returns full codes by decision; audit metadata masks via `maskInviteCode()`; tests assert audit does not contain full code. |
| INV-05 | 01-04, 01-05, 01-06 | Admin can deactivate/reactivate invites | ✓ SATISFIED | `/deactivate` + `/reactivate` endpoints + UI wiring + tests. |
| INV-06 | 01-04, 01-05, 01-06 | Admin can edit maxUses/expiry with validation preserving used accounting | ✓ SATISFIED | `PATCH /invite-codes/:id` validates `maxUses >= usedCount`; tests cover conflict error. |
| INV-07 | 01-04, 01-05, 01-06 | Admin can delete unused invites; used invites preserve history | ✓ SATISFIED | `DELETE` hard-deletes only when `usedCount == 0`; otherwise `invite_hat_nutzungen`; tests cover both. |

### Anti-Patterns Found

No Phase 1 blocker patterns found (no TODO/FIXME placeholders in the critical auth/profile/invite hardening paths; no stubbed handlers detected).

### Human Verification Required

See frontmatter `human_verification` section (3 smoke tests).

### Gaps Summary

No implementation gaps found against roadmap success criteria or Phase 1 plan `must_haves`. Remaining verification is **human smoke testing** of the UI flows and operator usability.

---

_Verified: 2026-04-16T12:19:30Z_
_Verifier: Claude (gsd-verifier)_

