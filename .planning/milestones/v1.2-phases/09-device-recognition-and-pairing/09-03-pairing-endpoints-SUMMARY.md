---
phase: 09-device-recognition-and-pairing
plan: 03
subsystem: auth
tags: [auth, pairing-tokens, csrf, rate-limit, audit-log, cache-control, vitest]

# Dependency graph
requires:
  - phase: 09-device-recognition-and-pairing
    provides: 09-01 (pairingTokens table, createPairingToken/hashPairingToken/PAIR_TOKEN_TTL_MS helpers, pair_token_create rate-limit scope, sessions.deviceKeyHash + deviceSignals)
  - phase: 09-device-recognition-and-pairing
    provides: 09-02 (deviceKey intake + recognition pattern mirrored into pair-redeem for the new session row)
provides:
  - POST /api/auth/pair-token (auth-required + CSRF-protected mint)
  - POST /api/auth/pair-redeem (public, single-use atomic redemption)
  - Four stable error codes (pair_token_invalid / pair_token_expired / pair_token_consumed / pair_origin_revoked) mapped in src/client/errors/errors.ts
  - Vitest lock-in for the entire AUTH-02 server contract (9 scenarios)
affects: [09-04-client-pairing-ux]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-step atomic claim inside a single sqlite.transaction: (1) UPDATE pairing_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL for race-safe single-use, (2) INSERT sessions, (3) backfill pairing_tokens.consumed_session_id. Needed because pairing_tokens.consumed_session_id has an immediate FK to sessions(id) and cannot be set before the new session row exists."
    - "recordRateLimitFailure re-used as a generic 'count an attempt' hook after a successful mint — matches the existing login_request/login_verify shape and lets the existing engine emit 429 on the 6th call without touching checkRateLimit/recordRateLimitFailure semantics."

key-files:
  created:
    - src/server/http/auth-pair.test.ts
  modified:
    - src/server/http/auth-routes.ts
    - src/client/errors/errors.ts

key-decisions:
  - "pair-token endpoint is CSRF-gated by omission from csrfExemptPaths; pair-redeem is added to csrfExemptPaths (bearer-token authority per T-09-22)."
  - "Rate-limit budget is inherited from 09-01 (pair_token_create: 10 min window, 5 attempts, 15 min block) and applied to BOTH the session key and the user key per request — so either a single compromised session or a user-wide flood is throttled."
  - "Redeem transaction was reordered from the plan's single-UPDATE/INSERT pattern to claim-first → insert-session → backfill-consumed_session_id, because the plan's UPDATE set consumed_session_id to the not-yet-inserted session id and failed the FK. Race semantics preserved via the claim step's isNull(consumedAt) predicate (Rule 1 auto-fix; committed separately as fix(09-03))."

requirements-completed: [AUTH-02]

# Metrics
duration: ~8min
completed: 2026-04-16
---

# Phase 09 Plan 03: Pairing Endpoints Summary

**Mint and redeem endpoints for session-bound device pairing: `POST /api/auth/pair-token` issues a ≤10-min, single-use, HMAC-stored token to the authenticated caller (CSRF-checked, rate-limited per session AND per user); `POST /api/auth/pair-redeem` (public) atomically claims the token, spawns a fresh session for the same user, and leaves the originating session active per D-10 — with all four stable error codes wired end-to-end into the German client error surface and nine vitest scenarios locking in the contract (full suite 53/53 green).**

## Performance

- **Duration:** ~8 min (468 s)
- **Started:** 2026-04-16T20:23:44Z
- **Completed:** 2026-04-16T20:31:32Z
- **Tasks:** 3/3
- **Files modified:** 3 (1 created, 2 modified)

## Endpoint Contracts

### POST /api/auth/pair-token

| Aspect | Behavior |
|--------|----------|
| Auth | `getCurrentSession` required → `401 nicht_angemeldet` otherwise |
| CSRF | enforced by router-level `requireCsrf` (NOT in `csrfExemptPaths`) → `403 csrf_token_ungueltig` otherwise |
| Rate limit | `scope: "pair_token_create"` checked on both `session:<id>` and `user:<id>` keys; exceeding either → `429 rate_limit_aktiv { retryAfterSeconds }` |
| Side effects | inserts one row into `pairing_tokens` with HMAC `token_hash`, `expires_at = now + 10 min`, `consumed_at = null`, `consumed_session_id = null` |
| Audit | `device_pair_created` on `entityType: session`, metadata `{ originSessionId, expiresAt }` — no token, no hash |
| Headers | `Cache-Control: no-store` (D-05) |
| Response | `201 { token, expiresAt }` — raw token leaves the server exactly once |

### POST /api/auth/pair-redeem

| Aspect | Behavior |
|--------|----------|
| Auth | none (CSRF-exempt; bearer-token authority per T-09-22) |
| Request body | `{ token: base64url{32,128}, deviceName?: string(1..120), deviceKey?: base64url{22,44}, pwa?: boolean }` |
| Errors | `400 pair_token_invalid` (malformed schema or unknown `token_hash`; also writes `device_pair_failed` audit with reason + sourceIp — never the token), `400 pair_token_consumed`, `400 pair_token_expired`, `401 pair_origin_revoked` (origin session revoked OR user soft-deleted) |
| Transaction | `claim UPDATE pairing_tokens SET consumed_at = now WHERE id = ? AND consumed_at IS NULL` → if `changes === 0` return `pair_token_consumed` → INSERT new `sessions` row (same `user_id`, new `id`/`token_hash`, caller-supplied `device_key_hash` + normalized `device_signals`) → UPDATE `pairing_tokens SET consumed_session_id = <new>`. All three statements share one sqlite transaction. |
| Origin session | **untouched** — no `update(sessions).set({ revokedAt: ... })` targeting `tokenRow.originSessionId` (D-10). |
| Audit | `device_pair_redeemed` on `entityType: session`, metadata `{ originSessionId, newSessionId, deviceName, deviceClass, platform, browser, pwa }` — no token, no token hash, no device key |
| Headers | `Cache-Control: no-store`; `setSessionCookie` sets standard `hermes_session` cookie for the new session |
| Response | `201 { user: publicUser(user) }` |

## Rate-Limit Configuration (In Effect)

- Scope: `pair_token_create` (added in 09-01).
- `windowSeconds: 10*60`, `maxAttempts: 5`, `blockSeconds: 15*60`.
- Keys: per-session (`session:<session.id>`) AND per-user (`user:<user.id>`) — each mint counts against both. Either threshold trips 429.
- Engine: re-used `checkRateLimit` + `recordRateLimitFailure` from 09-01. No engine changes.

## Stable Error Codes (Client-Surfaced)

All four are now mapped with German user messages in `src/client/errors/errors.ts`:

| Code | HTTP | German message |
|------|------|----------------|
| `pair_token_invalid` | 400 | "Der Pairing-Link ist ungültig. Bitte fordere einen neuen an." |
| `pair_token_expired` | 400 | "Dieser Pairing-Link ist abgelaufen. Bitte fordere einen neuen an." |
| `pair_token_consumed` | 400 | "Dieser Pairing-Link wurde bereits benutzt. Bitte fordere einen neuen an." |
| `pair_origin_revoked` | 401 | "Die Quelle dieses Pairing-Links ist nicht mehr aktiv. Bitte lass einen neuen Link erstellen." |

## Task Commits

1. **Task 1: Add POST /pair-token mint endpoint** — `3eb4f65` (feat)
2. **Task 2: Add POST /pair-redeem redemption endpoint (+ client error mapping)** — `7782612` (feat)
3. **Task 2 bugfix: Reorder redeem txn to satisfy consumed_session_id FK** — `2b21d01` (fix)
4. **Task 3: Add the auth-pair vitest suite (9 scenarios)** — `cec4dd8` (test)

## Test Coverage (9/9 passing)

`src/server/http/auth-pair.test.ts` — `describe("auth device pairing")`:

| # | Scenario | Asserts |
|---|----------|---------|
| 1 | mint without login | `401 nicht_angemeldet` |
| 2 | mint without CSRF | `403 csrf_token_ungueltig` |
| 3 | mint → redeem happy path | `201` on both; admin has 2 active sessions (origin untouched); newest session has `device_key_hash NOT NULL`; `pairing_tokens.consumed_at NOT NULL` + `consumed_session_id` = new session id; exactly one `device_pair_created` and one `device_pair_redeemed` audit row; `Cache-Control: no-store` on mint and redeem; `Set-Cookie: hermes_session=...` on redeem; token string does NOT appear in audit row JSON |
| 4 | double-redemption | `400 pair_token_consumed`; session count stays at 2 |
| 5 | expired token | `400 pair_token_expired` (direct SQL forces `expires_at` into the past) |
| 6 | origin-revoked | `401 pair_origin_revoked` after `DELETE /api/auth/sessions/:id` on the origin session (admin active session count goes to 0) |
| 7 | malformed token | `400 pair_token_invalid` |
| 8 | 6th mint in window | `429 rate_limit_aktiv` with numeric `retryAfterSeconds` |
| 9 | audit-log redaction | `JSON.stringify(row).not.toContain(token)` for every `device_pair_created` + `device_pair_redeemed` row |

Full suite: `npx vitest run --dir src` → 53/53 passing (44 previous + 9 new).

## Acceptance Grep Matrix (verified)

| Check | Result |
|-------|--------|
| `grep -n 'router.post("/pair-token"' src/server/http/auth-routes.ts` | 1 match |
| `grep -n 'router.post("/pair-redeem"' src/server/http/auth-routes.ts` | 1 match |
| `grep -n 'csrfExemptPaths = new Set' src/server/http/auth-routes.ts` | set literal includes `/pair-redeem` but NOT `/pair-token` |
| `grep -E 'pair_token_invalid\|pair_token_expired\|pair_token_consumed\|pair_origin_revoked' src/server/http/auth-routes.ts \| wc -l` | 8 (≥ 4) |
| `grep -n 'device_pair_redeemed' src/server/http/auth-routes.ts` | 1 match |
| `grep -n 'device_pair_created' src/server/http/auth-routes.ts` | 1 match |
| `grep -nE 'metadata:\s*\{[^}]*\btoken\s*:' src/server/http/auth-routes.ts` | 0 matches (tightened regex from the plan) |
| `grep -n 'update(sessions)' inside /pair-redeem handler body (lines 1027–1148)` | 0 matches — origin session is never revoked by the redeem handler (D-10) |
| `npx tsc --noEmit -p tsconfig.json` | exits 0 |
| `npx vitest run --dir src` | 53/53 passing |
| `git diff HEAD~4 HEAD -- package.json package-lock.json` | empty — no new runtime deps |

## Deviations from Plan

**1. [Rule 1 — Bug] Reorder pair-redeem transaction to satisfy `pairing_tokens.consumed_session_id` FK**

- **Found during:** Task 3 (happy-path vitest scenario surfaced a 500 response).
- **Issue:** The plan's pseudocode set `consumed_session_id: newSessionId` inside the same UPDATE that claimed `consumed_at`, but at that instant the session with id `newSessionId` had not yet been INSERTed. SQLite's immediate FK enforcement (migration `0010_device_pairing.sql` line 19: `consumed_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL`, no `DEFERRABLE`) aborted the UPDATE with `SqliteError: FOREIGN KEY constraint failed`, which surfaced as `500 Internal Server Error` on every happy-path redemption.
- **Fix:** Split the transaction into (1) claim-only UPDATE (`SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`), (2) INSERT the new session, (3) backfill `consumed_session_id` with a second UPDATE. All three statements still share the same `context.sqlite.transaction(() => {...})()` so atomicity is preserved. The atomic single-use property is still enforced by step (1)'s `isNull(consumedAt)` predicate — losing racers see `changes === 0` and return `pair_token_consumed`, identical to the plan's intent.
- **Files modified:** `src/server/http/auth-routes.ts`.
- **Commit:** `2b21d01`.

No architectural changes, no new dependencies, no new migrations. The FK itself is unchanged and still offers `ON DELETE SET NULL` semantics.

## Residual Risk

- **T-09-15 (DoS / brute-force enumeration via /pair-redeem):** still `mitigate (partial)` — no per-IP rate limit was added to `/pair-redeem` in this plan because the existing Phase 1 rate-limit machinery is keyed on `login_*`/`invite_*`/`pair_token_create` scopes. Entropy (256 bits), TTL (≤10 min), and single-use combine to make guessing infeasible within a token lifetime, and every unknown-token redemption attempt emits a `device_pair_failed` audit row that admins can spot. If incident response later shows abuse, follow-up work can introduce a `pair_token_redeem` scope using the existing engine.

## Stubs / Threat-Surface Notes

- **No stubs introduced.** Both endpoints read/write real rows, the rate-limit engine is wired, audit entries are emitted synchronously, and the `Cache-Control: no-store` header is set unconditionally on success.
- **Threat-surface scan:** Everything here is already enumerated by the plan's `<threat_model>` (T-09-13 through T-09-22). No new surface beyond the two endpoints themselves. The four stable error codes form a finite, stable failure surface — any future work that introduces a fifth failure mode must add both a handler branch AND a mapping in `src/client/errors/errors.ts`.

## Next Plan Readiness

- **09-04 (client pairing UX)** is fully unblocked on the server contract: request/response shapes are locked in by the vitest suite, error codes are already mapped with German copy, and the `Cache-Control: no-store` guarantee on both endpoints lets the client render tokens into QR codes without proxy caching concerns.

## Self-Check: PASSED

- [x] `src/server/http/auth-routes.ts` modified — `grep` confirms `router.post("/pair-token"`, `router.post("/pair-redeem"`, `device_pair_created`, `device_pair_redeemed`, `device_pair_failed`, `pair_token_create` (×2), and all 4 stable error codes.
- [x] `src/server/http/auth-pair.test.ts` exists — `describe("auth device pairing"` present, 9 `it()` blocks, all 4 error codes + `rate_limit_aktiv` + both audit codes + `JSON.stringify(row).not.toContain(token)` literal present.
- [x] `src/client/errors/errors.ts` modified — all 4 codes mapped with German messages.
- [x] Commit `3eb4f65` present in `git log` (Task 1).
- [x] Commit `7782612` present in `git log` (Task 2).
- [x] Commit `2b21d01` present in `git log` (Task 2 bugfix).
- [x] Commit `cec4dd8` present in `git log` (Task 3).
- [x] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [x] `npx vitest run --dir src` exits 0 (**53/53** passed — previous 44 + 9 new).
- [x] `grep -nE 'metadata:\s*\{[^}]*\btoken\s*:' src/server/http/auth-routes.ts` returns 0 matches.
- [x] No `update(sessions).set({ revokedAt: ...)` call inside the `/pair-redeem` handler block (lines 1027–1148 in auth-routes.ts) targets `tokenRow.originSessionId`.
- [x] `git diff HEAD~4 HEAD -- package.json package-lock.json` empty (no runtime dep added).
- [x] `git diff --diff-filter=D --name-only HEAD~4 HEAD` empty (no unintended deletions).

---
*Phase: 09-device-recognition-and-pairing*
*Completed: 2026-04-16*
