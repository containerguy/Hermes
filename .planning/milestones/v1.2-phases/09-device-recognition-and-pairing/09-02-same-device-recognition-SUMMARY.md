---
phase: 09-device-recognition-and-pairing
plan: 02
subsystem: auth
tags: [auth, sessions, device-recognition, audit-log, cache-control, vitest]

# Dependency graph
requires:
  - phase: 09-device-recognition-and-pairing
    provides: 09-01 (sessions.deviceKeyHash + sessions.deviceSignals columns, hashDeviceKey/normalizeDeviceSignals/deviceSignalsFingerprint helpers)
provides:
  - verify-code handler extended with deviceKey + pwa intake and D-01/D-02 recognition branch
  - auth.login_recognized audit code wired alongside auth.login (with recognized:true/false metadata flag)
  - Cache-Control: no-store on the verify-code response (D-05)
  - vitest lock-in for the five AUTH-01 server contracts
affects: [09-03-pairing-endpoints, 09-04-client-pairing-ux]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Recognition decision tree in-handler (deviceKey-first, signals-fallback when exactly one candidate) rather than a separate "session service" module — keeps the change localized to auth-routes.ts as the plan required.
    - Audit metadata uses normalized signal dimensions (deviceClass/platform/browser/pwa) plus a recognized:boolean flag; the raw device key never leaves the request body.

key-files:
  created:
    - src/server/http/auth-device-recognition.test.ts
  modified:
    - src/server/http/auth-routes.ts

key-decisions:
  - "Fallback by signals is only triggered when exactly ONE non-revoked, non-key-bound candidate matches the (userId, deviceSignals) tuple; 0 or ≥2 candidates fall through to the fresh-insert path. This keeps T-09-10 (two distinct devices collapse into one) mitigated without adding state."
  - "When a returning device supplies a deviceKey, the recognized row's deviceKeyHash is upgraded from NULL to the new hash (i.e., signals-first matches can adopt a key on their next login). We never overwrite an existing non-null deviceKeyHash with a different one because that path cannot be reached — the key-first lookup already branched."
  - "Audit action is auth.login_recognized when recognition fires, auth.login otherwise. Plus a recognized:true/false metadata flag for filterability (T-09-12)."

requirements-completed: [AUTH-01]

# Metrics
duration: ~3min
completed: 2026-04-16
---

# Phase 09 Plan 02: Same-Device Recognition Summary

**verify-code now recognizes returning devices via deviceKey-first / signals-fallback matching, updates the existing session row in place (no more duplicate rows on re-login), sets Cache-Control: no-store, and logs `auth.login_recognized` without ever persisting the raw device key — locked in by five new vitest scenarios with the full suite green (44/44).**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-16T20:16:25Z
- **Completed:** 2026-04-16T20:19:46Z
- **Tasks:** 2/2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- `POST /api/auth/verify-code` accepts two new optional body fields: `deviceKey` (22–44-char base64url, Zod-regex gated) and `pwa` (boolean). Neither is echoed back.
- Recognition decision tree runs AFTER OTP validation and BEFORE the transaction:
  1. If `deviceKey` provided → HMAC-hash it and lookup `(userId, deviceKeyHash, revokedAt IS NULL)`.
  2. Otherwise (or when step 1 misses) → collect non-revoked, non-key-bound sessions matching `(userId, deviceSignals)`; reuse only when **exactly one** candidate exists (D-02 conservative fallback).
  3. Otherwise → insert a new session as before (fresh-device parity with pre-plan behavior).
- When a session is recognized, the transaction UPDATEs `tokenHash`, `lastSeenAt`, `userAgent`, `deviceName`, `deviceKeyHash`, and `deviceSignals` on the existing row and reuses its `id`. Per D-03/D-10 the row is never deleted or revoked during recognition.
- Audit logging distinguishes the two paths via action codes `auth.login_recognized` vs `auth.login` and a `recognized: true|false` metadata flag; metadata carries only normalized signal fields — `deviceClass`, `platform`, `browser`, `pwa` — so the raw device key can never surface in `audit_logs` (T-09-08 mitigation).
- `response.setHeader("Cache-Control", "no-store")` is set immediately before the session cookie is written, satisfying D-05 / T-09-09.
- New `src/server/http/auth-device-recognition.test.ts` covers:
  1. same-device key reuse updates existing session, never grows row count, and logs `auth.login_recognized` without leaking `AAAAAAAAAAAAAAAAAAAAAA`.
  2. fallback by signals (no deviceKey, same `User-Agent`) reuses the single candidate and persists `windows|chrome|desktop|web`.
  3. fresh device path: different deviceKey produces a new session row and both remain active.
  4. malformed deviceKey (`"short"`) → 400 `ungueltiger_code`.
  5. Cache-Control: `no-store` present on successful verify-code response.
- `npx tsc --noEmit -p tsconfig.json` exits 0.
- `npx vitest run --dir src` exits 0 with **44/44** passing (previous baseline 39 + five new tests; the pre-existing `app-flow.test.ts` login path still works unchanged).
- **No new runtime dependency.** No changes to `package.json` / `package-lock.json`.

## Task Commits

1. **Task 1: Extend verify-code Zod schema and add recognition branch** — `96fd898` (feat)
2. **Task 2: Add the auth-device-recognition vitest suite** — `7e351c6` (test)

## Files Created/Modified

- `src/server/http/auth-routes.ts` — added `device-key` helper import; extended `verifyCodeSchema` with `deviceKey` + `pwa`; added recognition lookup block; replaced the verify-code transaction to branch on `recognizedSession` (UPDATE in place vs INSERT new); updated `tryWriteAuditLog` call to emit `auth.login_recognized`; added `Cache-Control: no-store` header before `setSessionCookie`.
- `src/server/http/auth-device-recognition.test.ts` — new file, mirrors `app-flow.test.ts` bootstrap (beforeEach env-vars + `bootstrapAdmin()` + `createHermesApp()`, afterEach close + tmp-file cleanup). Five `it()` blocks covering the five AUTH-01 contracts.

## Recognition Decision Tree

```
                       verify-code (after OTP + user lookup)
                                     │
                                     ▼
                     deviceKey in body? ── no ─┐
                                     │ yes     │
                                     ▼         │
                 lookup (userId, deviceKeyHash, not revoked)
                                     │         │
                          found? ─── yes ──────┤
                                     │         │
                                     no        ▼
                                     └──► lookup (userId, deviceSignals,
                                                 not revoked, deviceKeyHash IS NULL)
                                                      │
                                          exactly 1 candidate? ── no ──► INSERT new row
                                                      │ yes
                                                      ▼
                                             UPDATE that row in place
```

All update paths reuse the existing `session.id` so the client's existing cookie stays valid if they already had one (and the new cookie we issue simply supersedes it inside the recognized session). Per D-03, no prior session is revoked on recognition.

## Decisions Made

- **Localized to `auth-routes.ts`.** The plan's `<deviation_policy>` forbids introducing a new "session service" module. The recognition logic is ~30 lines of Drizzle `select()` + conditional INSERT/UPDATE inside the existing handler — well below the threshold that would warrant extraction, and consistent with the rest of the file's inline style.
- **D-02 fallback is strict about ambiguity.** When two or more sessions share the same `(userId, deviceSignals)` tuple (e.g., two Chrome-on-Windows browsers on the same account), we intentionally fall through to the new-session insert path. This is the conservative choice that T-09-10 demands: we would rather over-insert a duplicate than silently merge two distinct devices under one row.
- **Key-hash upgrade path is one-way.** If a session was first created without a deviceKey (signals-only), a later login that supplies a deviceKey upgrades the row's `deviceKeyHash` from NULL to the hash. We never overwrite an existing non-null `deviceKeyHash` with a different hash because the key-first lookup already branched into its own recognized row.
- **Audit metadata redaction is grep-verifiable.** The plan's acceptance criterion `grep -nE "metadata:.*deviceKey[^H]"` returning zero lines is satisfied — metadata only holds `deviceName`, `deviceClass`, `platform`, `browser`, `pwa`, `recognized`.

## Deviations from Plan

None — plan executed exactly as written. The plan's code snippets dropped in cleanly against the real handler structure (Zod → rate-limit → challenge/user lookup → session id/token → transaction → audit → cookie → JSON). No auto-fixes required, no authentication gates hit, no architectural changes.

## Issues Encountered

None.

## Stub / Threat-Surface Notes

- **No stubs introduced.** Every new code path writes to real columns with real values; the audit log entry is produced synchronously; the Cache-Control header is set unconditionally on the success response.
- **Threat-surface scan:** The three new behaviors (deviceKey intake at `POST /api/auth/verify-code`, signals fingerprint persistence, `auth.login_recognized` audit code) are all modeled in the plan's `<threat_model>` — T-09-07 (spoofing mitigated by keeping OTP mandatory), T-09-08 (info disclosure mitigated by grep-proof metadata redaction), T-09-09 (cache disclosure mitigated by `Cache-Control: no-store`), T-09-10 (ambiguous signals match mitigated by 1-candidate rule), T-09-12 (repudiation mitigated by the distinct audit code). No new trust boundary crossings beyond those enumerated.

## User Setup Required

None. `HERMES_DEVICE_KEY_SECRET` was already introduced by 09-01 (with a documented dev-only fallback). Production operators still need to set it before rolling out Phase 9 end-to-end (tracked for Phase 13 release notes).

## Next Plan Readiness

- **09-03 (pair endpoints)** is unblocked: verify-code now sets the `deviceKeyHash`/`deviceSignals` columns 09-03 will read when binding a pairing token to the originating session.
- **09-04 (client pairing UX)** is unblocked on the server contract: the request body shape is documented here (`deviceKey`, `pwa`), and the `Cache-Control: no-store` guarantee lets the client's local device key remain per-origin without proxy caching concerns.
- The `app-flow.test.ts` login helper (which does NOT send a deviceKey) continues to exercise the fresh-device insert path, so 09-01's regression pin plus this plan's suite together cover both code branches.

## Self-Check: PASSED

- [x] `src/server/http/auth-routes.ts` modified — grep confirms `auth.login_recognized`, `deviceKey:` (schema), `Cache-Control`, and 6 references to `deviceKeyHash`.
- [x] `src/server/http/auth-device-recognition.test.ts` exists — grep confirms `describe("auth device recognition"` + all five test names + literal `auth.login_recognized` + literal `AAAAAAAAAAAAAAAAAAAAAA`.
- [x] `grep -nE "metadata:.*deviceKey[^H]" src/server/http/auth-routes.ts` returns no lines (audit redaction pin).
- [x] Commit `96fd898` present in `git log` (Task 1).
- [x] Commit `7e351c6` present in `git log` (Task 2).
- [x] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [x] `npx vitest run --dir src` exits 0 (**44/44** passed — existing 39 + 5 new).
- [x] `git diff HEAD~2 HEAD -- package.json package-lock.json` empty (no runtime dep added).
- [x] `git diff --diff-filter=D --name-only HEAD~2 HEAD` empty (no unintended deletions).

---
*Phase: 09-device-recognition-and-pairing*
*Completed: 2026-04-16*
