# Phase 9: Device Recognition and Session-Bound Pairing - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning
**Source:** Promoted from todos `2026-04-16-recognize-device-on-re-login.md` and `2026-04-16-add-device-via-session-qr-link.md`

<domain>
## Phase Boundary

This phase covers two device-related auth improvements:
1. Recognizing a returning device at login so we don't proliferate duplicate sessions for the same user+device.
2. Letting an authenticated user pair an additional device (e.g. phone) without forcing a second email one-time-code flow, by minting a short-TTL, session-bound, single-use pairing token rendered as a link/QR.

Out of scope: high-entropy fingerprinting (Canvas/WebGL), cross-site identification, replacing the email OTP for first-time login.
</domain>

<decisions>
## Implementation Decisions

### AUTH-01 — Same-Device Recognition (locked)

- D-01: Recognition signals are **low-entropy only**: platform/OS family, browser family, device class (mobile/desktop), PWA flag, plus a **Hermes-specific local device key** stored in `localStorage` (rotatable; cleared by an explicit "Forget this device" UI action). No Canvas/WebGL/font fingerprinting.
- D-02: Server matches the incoming `(userId, deviceKey)` (preferred) or `(userId, normalized signals)` (fallback) against existing session/device records. On match, **update the existing record's `lastSeenAt`/name** instead of inserting a new one.
- D-03: Behaviour on match is **update existing session** (do not auto-revoke the previous active session unless the user explicitly chose "Replace this device's session").
- D-04: Device key generation: 128-bit random, base64url, generated client-side on first login if absent; transmitted in the verify-OTP request body and never logged.
- D-05: Privacy guardrail: device key is per-origin (Hermes only); we do not share or echo it to other apps; `Cache-Control: no-store` on responses that carry it.

### AUTH-02 — Session-Bound Device Pairing (locked)

- D-06: The "Add a device" UI lives in the Profile/Login panel and is gated behind an active, authenticated session.
- D-07: Pairing endpoint is **auth-required** (not admin-only). Rate-limited per session and per user (reuse existing rate-limit infrastructure from Phase 1).
- D-08: Pairing token: opaque random ≥256 bits, base64url, **TTL ≤ 10 minutes**, **single-use**, bound to `(userId, originSessionId)`. Token is invalidated if the originating session is revoked before redemption.
- D-09: Token is delivered as a link of the form `<APP_BASE>/#login?pair=<token>` and a QR code rendered client-side from the same URL (no PII in the URL).
- D-10: Redemption endpoint accepts `{ token, deviceName? }`, validates server-side, marks token consumed, creates a new session for the same user, and returns the standard session cookie. The original session **stays active**.
- D-11: Audit log entries: `device_pair_created` (originating session) and `device_pair_redeemed` (new session). Entries record `userId`, the resulting/originating session IDs, and timestamps — **never the token, never the device key**.
- D-12: Error semantics use stable error codes — `pair_token_invalid`, `pair_token_expired`, `pair_token_consumed`, `pair_origin_revoked` — returned as 400/401 per existing `auth-routes.ts` conventions.
- D-13: Storage: pairing tokens live in a new SQLite table (or reuse the existing one-time-code table with a `kind` column — planner to decide and document) with an index on the hashed token. Tokens are **stored only as HMAC-SHA256(secret, token)** so a DB read does not leak usable tokens.

### Cross-Cutting (locked)

- D-14: All new endpoints follow the existing CSRF + session-cookie conventions from Phase 1.
- D-15: No new third-party dependencies for QR rendering if a small, dependency-light client-side QR generator can be inlined (≤ 5 KB gzipped). Otherwise the planner may justify and add `qrcode`.
- D-16: Migration: schema changes ship as an explicit SQL migration (consistent with the project's "no implicit Drizzle push" convention — see `01-auth-profile-and-invite-hardening` precedent).
- D-17: Tests are required for both happy and negative paths in `src/server/http/auth-routes.ts` test suites (re-login same device, pair create, pair redeem, expiry, consumed, origin-revoked).

### Claude's Discretion

- Whether to introduce a new `device_keys` table or to fold the device key into existing `sessions`.
- Exact rate-limit thresholds (consistent with existing per-IP/per-user limits).
- UI placement of the QR (inline panel vs. modal) and copy strings (subject to COPY-01 voice in Phase 10).
- Whether `localStorage` device key migrates to `IndexedDB` for stricter quota handling.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Auth + Sessions (existing precedent)
- `src/server/http/auth-routes.ts` — current login/verify endpoints, CSRF integration, error code shape
- `src/server/auth/sessions.ts` — session creation, lookup, revoke
- `src/server/auth/current-user.ts` — auth-required middleware shape
- `src/server/db/schema.ts` — sessions table, audit log table, one-time-code table

### Client
- `src/client/components/LoginPanel.tsx` — current login UX (entry point for "Add a device" UI and `?pair=` handling)
- `src/main.tsx` — app shell + URL hash routing where `#login?pair=...` lands

### Project Convention
- `.planning/codebase/CONVENTIONS.md` — project conventions (test layout, naming)
- `.planning/codebase/CONCERNS.md` — auth abuse + rate limiting context (Phase 1 hardening already in place)
- `.planning/phases/01-auth-profile-and-invite-hardening/` — most recent auth-route changes; mirror the rate-limit and audit-log patterns established there

</canonical_refs>

<specifics>
## Specific Ideas

- Pairing URL hash: `#login?pair=<token>` (rendered as both a clickable link and a QR).
- Audit codes: `device_pair_created`, `device_pair_redeemed`, `device_pair_failed`.
- Stable error codes (response body `{ error: "<code>" }`): `pair_token_invalid`, `pair_token_expired`, `pair_token_consumed`, `pair_origin_revoked`, `device_key_required`.
- Settings/profile new control: "Forget this device" → clears local device key + revokes the current session.

</specifics>

<deferred>
## Deferred Ideas

- Push-based pairing notifications to other logged-in devices ("a new device just joined").
- Server-issued WebAuthn credentials (passkey-style) — not in scope for v1.2.
- Cross-device session list management UI beyond what already exists.

</deferred>

---

*Phase: 09-device-recognition-and-pairing*
*Context gathered: 2026-04-16 from todos promotion*
