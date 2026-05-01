---
phase: 09-device-recognition-and-pairing
plan: 01
subsystem: auth
tags: [sqlite, drizzle, migrations, hmac-sha256, rate-limit, device-pairing]

# Dependency graph
requires:
  - phase: 01-auth-profile-and-invite-hardening
    provides: rate-limit scopes + persisted rate_limit_entries table, sessions.token_hash pattern
provides:
  - SQL migration 0010_device_pairing.sql (sessions.device_key_hash + device_signals, pairing_tokens table, 6 new indexes)
  - Drizzle mirror for the new sessions columns and pairingTokens table
  - src/server/auth/device-key.ts (hashDeviceKey, normalizeDeviceSignals, deviceSignalsFingerprint, DEVICE_KEY_BYTES)
  - src/server/auth/pairing-tokens.ts (createPairingToken, hashPairingToken, PAIR_TOKEN_TTL_MS, PAIR_TOKEN_BYTES)
  - New RateLimitScope "pair_token_create" wired into getScopeConfig
  - New env-var contract: HERMES_DEVICE_KEY_SECRET, HERMES_PAIR_TOKEN_SECRET (both have dev-only fallbacks)
affects: [09-02-same-device-recognition, 09-03-pairing-endpoints, 09-04-client-pairing-ux]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - HMAC-SHA256 with per-purpose env-var secret for any secret-adjacent hash at rest (device keys, pair tokens) — separate from the plain SHA-256 used for RL key redaction and session token hashes.
    - Pairing token table carries only token_hash + metadata; raw token never persisted (mirrors sessions.token_hash precedent from Phase 1).

key-files:
  created:
    - src/server/db/migrations/0010_device_pairing.sql
    - src/server/auth/device-key.ts
    - src/server/auth/pairing-tokens.ts
  modified:
    - src/server/db/schema.ts
    - src/server/auth/rate-limits.ts
    - src/server/http/app-flow.test.ts

key-decisions:
  - "Fold device key into sessions (new device_key_hash column) rather than a separate device_keys table — D-02 match is always (user_id, device_key_hash) scoped to an existing session, so a separate table added no value."
  - "pair_token_create rate limit: window=10min, maxAttempts=5, block=15min — consistent with login_verify's window/block ratio; enforced per key which 09-03 will set to session|user scope."
  - "Both secret env vars fall back to documented dev-only strings (consistent with csrf.ts precedent); production env must set HERMES_DEVICE_KEY_SECRET + HERMES_PAIR_TOKEN_SECRET — flagged as residual risk T-09-03 for Phase 13 release-notes."

patterns-established:
  - "New low-entropy device-match columns on sessions: device_key_hash (preferred) + device_signals (fallback, stored as deviceSignalsFingerprint string)."
  - "pairing_tokens.token_hash is HMAC-keyed (not plain SHA-256) and UNIQUE-indexed, so enumeration via snapshot leak does not yield usable tokens."

requirements-completed: [AUTH-01, AUTH-02]

# Metrics
duration: ~4min
completed: 2026-04-16
---

# Phase 09 Plan 01: Schema & Device Model Summary

**HMAC-hashed pairing-token table + sessions.device_key_hash/device_signals columns with typed Drizzle mirrors, two helper modules, and a pair_token_create rate-limit scope — the storage foundation that Phase 9's same-device recognition and QR pairing consume without further schema work.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-16T20:09:14Z
- **Completed:** 2026-04-16T20:13:?? (commit `7adeb50`)
- **Tasks:** 4/4
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- `0010_device_pairing.sql` migration is the new lexicographic tail (sorts cleanly after `0009_event_soft_delete.sql`), adding `sessions.device_key_hash`, `sessions.device_signals`, and a fully-indexed `pairing_tokens` table with CASCADE/SET NULL FK semantics per D-13.
- Drizzle schema mirrors the migration exactly (new columns + two composite indexes on `sessions`, new `pairingTokens` table with four indexes). `npx tsc --noEmit -p tsconfig.json` passes.
- Two dependency-free helper modules exposing the contracts downstream plans rely on: `hashDeviceKey`/`normalizeDeviceSignals`/`deviceSignalsFingerprint` and `createPairingToken`/`hashPairingToken` with the `PAIR_TOKEN_*` constants.
- `pair_token_create` is a recognized `RateLimitScope` with explicit `{windowSeconds: 10*60, maxAttempts: 5, blockSeconds: 15*60}` — no changes to `checkRateLimit`/`recordRateLimitFailure` behaviour.
- Extended the existing `applies schema migrations including Phase 1 auth hardening foundations` test in `src/server/http/app-flow.test.ts` so regressions to the new migration pin to a single failing test. Full suite: **39/39 passing** (`npx vitest run --dir src`).
- **No runtime dependency added** — `git diff HEAD~4 HEAD -- package.json package-lock.json` is empty.

## Task Commits

1. **Task 1: Author the 0010_device_pairing.sql migration** — `cc14502` (feat)
2. **Task 2: Mirror the migration in src/server/db/schema.ts** — `a234c96` (feat)
3. **Task 3: Add device-key + pairing-token helpers and pair_token_create rate-limit scope** — `c0108d3` (feat)
4. **Task 4: Extend the migration assertion test for the new schema** — `7adeb50` (test)

## Files Created/Modified

- `src/server/db/migrations/0010_device_pairing.sql` — new migration, 26 lines; ALTER TABLE for sessions, CREATE TABLE for pairing_tokens, 6 indexes.
- `src/server/db/schema.ts` — added two columns + two indexes on `sessions`; added `pairingTokens` export with four indexes.
- `src/server/auth/device-key.ts` — new helper module (`DEVICE_KEY_BYTES`, `hashDeviceKey`, `normalizeDeviceSignals`, `deviceSignalsFingerprint`, exported type `NormalizedDeviceSignals`).
- `src/server/auth/pairing-tokens.ts` — new helper module (`PAIR_TOKEN_BYTES`, `PAIR_TOKEN_TTL_MS`, `createPairingToken`, `hashPairingToken`).
- `src/server/auth/rate-limits.ts` — `RateLimitScope` union extended with `"pair_token_create"`, `getScopeConfig` switch case added.
- `src/server/http/app-flow.test.ts` — appended 8 `expect(...).toContain(...)` assertions to the existing `applies schema migrations ...` test (no new `describe`/`it` blocks).

## Environment Variables Introduced

Both are optional in dev (each helper falls back to a documented dev-only string). Must be set in production (release-notes follow-up for Phase 13):

- `HERMES_DEVICE_KEY_SECRET` — HMAC-SHA256 key used by `hashDeviceKey()` so raw client-supplied device keys are never stored.
- `HERMES_PAIR_TOKEN_SECRET` — HMAC-SHA256 key used by `hashPairingToken()` so snapshot exfiltration cannot yield usable pair tokens.

## Test That Now Guards Regressions

`src/server/http/app-flow.test.ts` — `it("applies schema migrations including Phase 1 auth hardening foundations", ...)` asserts the new `device_key_hash`, `device_signals` columns, the `pairing_tokens` table, and the indexes `pairing_tokens_token_hash_unique`, `sessions_user_device_key_idx`, `sessions_user_device_signals_idx`, `pairing_tokens_origin_session_idx`, `pairing_tokens_user_expires_idx`.

## Decisions Made

- **Fold device key into `sessions`** (new `device_key_hash` column) rather than introducing a separate `device_keys` table. D-02 match is always `(user_id, device_key_hash)` already scoped to an existing session row, so a join table adds no lookup power and costs an extra write on every login.
- **Rate-limit budget** for `pair_token_create`: `windowSeconds: 10*60`, `maxAttempts: 5`, `blockSeconds: 15*60`. Mirrors `login_verify`'s window/block ratio and is strict enough to kill token-enumeration attempts while leaving slack for a user who genuinely fumbles a pairing flow.
- **Helper module layout**: split into `device-key.ts` + `pairing-tokens.ts` (not one shared file) because downstream plans 09-02 and 09-03 import these independently; keeping them separate avoids accidental cross-imports of unrelated constants.

## Deviations from Plan

None — plan executed exactly as written. All four tasks committed in order, no auto-fixes needed, no authentication gates hit, no architectural changes required.

## Issues Encountered

None.

## Stub / Threat-Surface Notes

- **No stubs introduced.** Every helper returns real values; the rate-limit scope is wired into the existing engine; the migration and schema are consumed by the extended test.
- **Threat-surface scan:** The two new env-var secrets (`HERMES_DEVICE_KEY_SECRET`, `HERMES_PAIR_TOKEN_SECRET`) are covered by the plan's `<threat_model>` (T-09-01, T-09-02, T-09-03). No new surface beyond what the threat register already enumerates.

## User Setup Required

None for this plan. Production operators will need to add `HERMES_DEVICE_KEY_SECRET` and `HERMES_PAIR_TOKEN_SECRET` to `.env` before rolling out Phase 9 end-to-end (tracked as Phase 13 release-note work per the threat model T-09-03 "accept" disposition).

## Next Phase Readiness

- Plan 09-02 (same-device recognition in verify-OTP) can now `import { hashDeviceKey, normalizeDeviceSignals, deviceSignalsFingerprint } from "../auth/device-key"` and write directly to `sessions.deviceKeyHash` / `sessions.deviceSignals` via Drizzle.
- Plan 09-03 (pair endpoints) can now `import { createPairingToken, hashPairingToken, PAIR_TOKEN_TTL_MS } from "../auth/pairing-tokens"`, insert into `pairingTokens`, and call `checkRateLimit(..., { scope: "pair_token_create", key, sourceIp })` without modifying the rate-limit engine.
- Plan 09-04 (client UX) is unblocked on storage grounds.

## Self-Check: PASSED

- [x] `src/server/db/migrations/0010_device_pairing.sql` exists (FOUND).
- [x] `src/server/auth/device-key.ts` exists (FOUND).
- [x] `src/server/auth/pairing-tokens.ts` exists (FOUND).
- [x] Commit `cc14502` present in `git log` (FOUND).
- [x] Commit `a234c96` present in `git log` (FOUND).
- [x] Commit `c0108d3` present in `git log` (FOUND).
- [x] Commit `7adeb50` present in `git log` (FOUND).
- [x] `0010_device_pairing.sql` is lexicographic tail of `src/server/db/migrations/` (verified via `ls ... | sort | tail -1`).
- [x] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [x] `npx vitest run --dir src` exits 0 (39/39 passed).
- [x] `git diff HEAD~4 HEAD -- package.json package-lock.json` is empty (no runtime dep added).

---
*Phase: 09-device-recognition-and-pairing*
*Completed: 2026-04-16*
