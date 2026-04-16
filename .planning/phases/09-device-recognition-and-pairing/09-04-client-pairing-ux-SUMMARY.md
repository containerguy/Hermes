---
phase: 09-device-recognition-and-pairing
plan: 04
subsystem: auth
tags: [client, react, device-key, pairing, qr, localStorage, vitest, jsdom]

# Dependency graph
requires:
  - phase: 09-device-recognition-and-pairing
    provides: 09-01 (sessions.deviceKeyHash contract + hashDeviceKey HMAC)
  - phase: 09-device-recognition-and-pairing
    provides: 09-02 (verify-code accepts deviceKey + pwa)
  - phase: 09-device-recognition-and-pairing
    provides: 09-03 (pair-token + pair-redeem endpoints + 4 stable error codes)
provides:
  - src/client/api/device-key.ts — per-origin 128-bit device-key persistence (localStorage) + getDeviceContext()
  - src/client/components/QrCanvas.tsx — dependency-light canvas renderer for any payload string
  - LoginPanel "Add a device" panel (mint → render QR + link → close)
  - LoginPanel redemption-on-mount effect + history.replaceState scrub
  - LoginPanel "Dieses Gerät vergessen" on the current session row
  - German errorMessages coverage for pair_* + device_key_required
  - Three new vitest scenarios pinning the redeem-on-mount + URL-scrub contract
affects: []

# Tech tracking
tech-stack:
  added:
    - "qrcode-generator@1.4.4 (MIT, pure JS, zero native deps; ~56 KB raw, ~11.5 KB gzipped of the published source; Vite bundle only pulls the minified/tree-shaken body into the client). Chosen per D-15 over hand-rolling Reed-Solomon and over the (heavier, multi-module) `qrcode` npm package — size + zero-dep + TS types shipped in-package all favor qrcode-generator."
  patterns:
    - "Per-origin localStorage key (hermes_device_key_v1) with graceful fall-back to an ephemeral per-load key when storage is blocked (private mode). getDeviceContext() composes it with an isPwa() display-mode probe for both /api/auth/verify-code and /api/auth/pair-redeem bodies."
    - "Redemption-on-mount effect parses window.location.hash for a `pair=` query segment and ALWAYS scrubs the param via history.replaceState in .finally() — defense-in-depth against back-button replay on top of the server's single-use claim (T-09-24)."
    - "Minimal surgical main.tsx edit: getPageFromHash() now matches the hash path portion (everything before `?`) against route paths so `#login?pair=<token>` mounts LoginPanel (where the redemption effect lives) instead of falling through to the events page."

key-files:
  created:
    - src/client/api/device-key.ts
    - src/client/components/QrCanvas.tsx
    - src/client/components/login-panel.test.tsx
    - .planning/phases/09-device-recognition-and-pairing/09-04-client-pairing-ux-SUMMARY.md
  modified:
    - src/client/components/LoginPanel.tsx
    - src/client/errors/errors.ts
    - src/main.tsx
    - package.json
    - package-lock.json

key-decisions:
  - "Adopt qrcode-generator@1.4.4 instead of hand-inlining a QR encoder. D-15's inline budget (≤5 KB gzipped) does not leave room for a correct Reed-Solomon encoder with version/error-correction selection. qrcode-generator is MIT, zero-dep, ships .d.ts in-package, and Vite will tree-shake it to well under the practical client-bundle budget."
  - "Realign the four pair_* German strings in src/client/errors/errors.ts to the plan-specified copy (the 09-03 summary shipped slightly different wording). Task 4's test asserts the literal 'Pairing-Code ist abgelaufen', so the copy must match for the UX contract to be enforceable."
  - "Extend getPageFromHash() in main.tsx with a minimal hash-path matcher (everything before `?`). Without this, `#login?pair=<token>` would not mount LoginPanel and the redemption effect would never run — Rule 3 blocking fix, committed inside the Task 3 feat as a single surgical hunk that does not touch the pre-existing uncommitted diff to main.tsx (manager routing)."
  - "Follow the existing ui-correctness.test.tsx harness (react-dom/client + act) rather than adding a @testing-library/react devDep. The plan's suggestion of @testing-library is orthogonal to the acceptance criteria; the existing stack is sufficient."

requirements-completed: [AUTH-01, AUTH-02]

# Metrics
duration: ~15min
completed: 2026-04-16
---

# Phase 09 Plan 04: Client Pairing UX Summary

**Ships the AUTH-01/AUTH-02 client UX: a per-origin localStorage device key sent with every verify-code + pair-redeem, an "Add a device" panel that mints a pair-token and renders it as a canvas QR + clickable link, a redemption-on-mount effect that scrubs `?pair=<token>` from the URL hash on both success and failure, and a "Dieses Gerät vergessen" control — locked in by three new vitest scenarios and all five German error strings (four `pair_*` codes plus `device_key_required`) resolving via `errorMessages`.**

## Performance

- **Tasks:** 4/4
- **Files created:** 3 (`device-key.ts`, `QrCanvas.tsx`, `login-panel.test.tsx`)
- **Files modified:** 5 (`LoginPanel.tsx`, `errors.ts`, `main.tsx`, `package.json`, `package-lock.json`)
- **Full test suite:** 56/56 passing (baseline 53 + 3 new from Task 4)
- **npm audit --omit=dev:** 0 vulnerabilities
- **New runtime dep:** `qrcode-generator@1.4.4` only

## Task Commits

1. **Task 1: device-key client module** — `4fc3660` (feat)
2. **Task 2: QrCanvas + qrcode-generator dependency** — `db9ea02` (feat)
3. **Task 3: Wire device key, pair UX, error copy, getPageFromHash hash-path match** — `b91a2a3` (feat)
4. **Task 4: login-panel vitest for redeem-on-mount + URL scrub** — `8b1681c` (test)

## New Dependency (D-15 Justification)

- **Package:** `qrcode-generator@1.4.4`
- **License:** MIT
- **Native bindings:** none
- **Transitive deps:** none (leaf)
- **Size (published source):** 56,694 bytes raw, 11,785 bytes gzipped
- **Ships .d.ts:** yes (`qrcode.d.ts` in-package, `export = qrcode` CJS form consumed via `esModuleInterop`)
- **Why not inline:** A correct QR encoder (mode selection, Reed-Solomon error correction, version/size selection) comfortably exceeds the D-15 inline budget of ≤5 KB gzipped once you also carry a rendering path.
- **Why not `qrcode`:** `qrcode` is multi-module (pulls in multiple files and a CLI surface). `qrcode-generator` is a single file, leaf dep, published since 2017, last update 2024, stable.
- **npm audit --omit=dev:** 0 vulnerabilities after install.

## Endpoint Touchpoints

| Endpoint | LoginPanel site | Body additions |
|----------|-----------------|----------------|
| `POST /api/auth/verify-code` | `verifyCode()` | `deviceKey`, `pwa` |
| `POST /api/auth/pair-token`  | `mintPairingToken()` | _(none; auth+CSRF handled by request helper)_ |
| `POST /api/auth/pair-redeem` | on-mount useEffect | `token`, `deviceName`, `deviceKey`, `pwa` |
| `DELETE /api/auth/sessions/:id` | `forgetDevice()` | targets the current session |

## German Error Strings (src/client/errors/errors.ts)

All five resolve via `getErrorMessage(code)`:

| Code | Message |
|------|---------|
| `device_key_required` | "Dieses Gerät hat noch keinen Geräteschlüssel. Bitte Seite neu laden." |
| `pair_token_invalid` | "Pairing-Code ist ungültig. Bitte einen neuen QR-Code erzeugen." |
| `pair_token_expired` | "Pairing-Code ist abgelaufen. Bitte einen neuen QR-Code erzeugen." |
| `pair_token_consumed` | "Pairing-Code wurde bereits eingelöst. Bitte einen neuen QR-Code erzeugen." |
| `pair_origin_revoked` | "Die ursprüngliche Sitzung ist abgelaufen. Auf dem anderen Gerät erneut anmelden und einen neuen QR-Code erzeugen." |

`grep -nE 'pair_token_invalid|pair_token_expired|pair_token_consumed|pair_origin_revoked|device_key_required' src/client/errors/errors.ts | wc -l` → **5** (≥5 ✓).

## Acceptance Grep Matrix

| Check | Result |
|-------|--------|
| `grep -c 'localStorage' src/client/api/device-key.ts` | 4 (≥3 ✓) |
| `grep -c 'crypto.getRandomValues' src/client/api/device-key.ts` | 1 (≥1 ✓) |
| `grep -c 'hermes_device_key_v1' src/client/api/device-key.ts` | 1 |
| `grep -c 'qr.isDark(' src/client/components/QrCanvas.tsx` | 1 |
| `grep -c 'getDeviceContext()' src/client/components/LoginPanel.tsx` | 2 (≥2 ✓) |
| `grep -c 'QrCanvas' src/client/components/LoginPanel.tsx` | 2 (≥2 ✓) |
| `grep -c '/api/auth/pair-token' src/client/components/LoginPanel.tsx` | 1 |
| `grep -c '/api/auth/pair-redeem' src/client/components/LoginPanel.tsx` | 1 |
| `grep -c 'history.replaceState' src/client/components/LoginPanel.tsx` | 1 |
| `grep -c 'forgetDeviceKey()' src/client/components/LoginPanel.tsx` | 1 |
| Literal `Add a device` in LoginPanel.tsx | present |
| Literal `Pairing-Code erzeugen` in LoginPanel.tsx | present |
| Literal `Dieses Gerät vergessen` in LoginPanel.tsx | present |
| `grep -E '"qrcode-generator"' package.json` | present |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx vitest run --dir src` | **56/56** passing |
| `npx vitest run src/client/components/login-panel.test.tsx` | 3/3 passing |
| `npm audit --omit=dev` | 0 vulnerabilities |

## Deviations from Plan

**1. [Rule 3 — Blocking] Extend `getPageFromHash` in `src/main.tsx` for `#login?...` matching**

- **Found during:** Task 3 review of the plan's redemption-effect design.
- **Issue:** The plan's `<interfaces>` section acknowledges that `getPageFromHash()` does exact string match and `#login?pair=<token>` would fall through to the default `events` page — which would mean `LoginPanel` is not mounted and the on-mount redemption effect never runs. The plan's note "the redemption effect runs on mount in LoginPanel regardless of activePage, and forces a navigation to `#login` after parsing" is internally inconsistent: an unmounted component cannot run effects. Without a fix, the AUTH-02 redemption flow does not work in production even though the vitest Task 4 (which mounts `<LoginPanel>` directly) passes.
- **Fix:** Minimal, surgical edit to `getPageFromHash()`: compute `hashPath = hash.slice(0, hash.indexOf("?"))` when a `?` is present, match routes against `hashPath`. Two-line change, no behavioral impact on any non-pairing URL. Preserved the pre-existing uncommitted manager-routing diff in `src/main.tsx` untouched (staged only my hunk via `git add -p`).
- **Files modified:** `src/main.tsx` (single hunk, inside the Task 3 feat commit).
- **Commit:** `b91a2a3`.

**2. [Rule 1 — Bug] Realign `pair_*` German strings to plan-specified copy**

- **Found during:** Task 3 (pre-work scan of `errors.ts`).
- **Issue:** 09-03 shipped German strings for the four `pair_*` codes that did not contain the substring `Pairing-Code ist abgelaufen`. Task 4's acceptance criterion requires that exact literal to appear in the rendered DOM for the `pair_token_expired` failure path. The plan's Task 3A explicitly lists the replacement strings.
- **Fix:** Updated the four existing `pair_*` entries in `src/client/errors/errors.ts` to match the plan's specified text; added the new `device_key_required` entry. No existing entries removed (per "do NOT remove anything" plan instruction).
- **Files modified:** `src/client/errors/errors.ts`.
- **Commit:** `b91a2a3`.

No architectural changes, no new migrations, no additional runtime dependencies beyond `qrcode-generator@1.4.4`.

## Test Coverage (new in Task 4)

`src/client/components/login-panel.test.tsx` — `describe("LoginPanel pairing redemption")`:

1. **redeems token from URL hash on mount and strips ?pair from the hash** — sets `window.location.hash = "#login?pair=PAIR_TOKEN_TEST_VALUE_AAAAAAAAAAAA"`, mocks `/api/auth/pair-redeem` → `{ user }`, asserts `onLoggedIn` called exactly once with the mocked user, exactly one `/api/auth/pair-redeem` call whose body.token equals `PAIR_TOKEN_TEST_VALUE_AAAAAAAAAAAA` and whose body.deviceKey is a non-empty base64url string, and `window.location.hash` no longer contains `pair=`.
2. **does NOT call pair-redeem when no ?pair is in the hash** — hash set to `#login`, renders, asserts zero `/api/auth/pair-redeem` calls.
3. **handles pair_token_expired by surfacing a German error** — mocks the endpoint to throw `ApiError({ code: "pair_token_expired", ... })`, asserts the rendered DOM contains the literal `Pairing-Code ist abgelaufen`, `onLoggedIn` was NOT called, and the hash was still scrubbed (defense-in-depth: `.finally()` in LoginPanel's redemption effect).

Harness mirrors `ui-correctness.test.tsx` (`createRoot` + `react-dom/test-utils.act`, no new devDep).

## Stubs / Threat-Surface Notes

- **No stubs introduced.** Every handler hits a real endpoint; the device-key module either returns a freshly-generated key or one persisted in localStorage; the QR canvas renders a real QR code from the plan-derived `pairUrl` (`${origin}${pathname}#login?pair=${token}`).
- **Threat-surface scan:** Everything new is modeled in the plan's `<threat_model>` (T-09-23 device-key per-origin scope via namespaced localStorage key, T-09-24 pair-token history scrub via `history.replaceState` in `.finally()`, T-09-28 `qrcode-generator` dependency audit verified by `npm audit --omit=dev` showing 0 vulnerabilities, T-09-30 redemption status surface via `setRedeemStatus` + `message`/`error`). No new trust boundary crossings.

## User Setup Required

None. Production operators still need to set `HERMES_DEVICE_KEY_SECRET` and `HERMES_PAIR_TOKEN_SECRET` before rolling out Phase 9 end-to-end (tracked for Phase 13 release notes — already surfaced in 09-01's SUMMARY).

## Preserved Pre-existing Working-tree Modifications

Per user_query: the following files were dirty in the working tree before this plan started and were **explicitly preserved** (not touched beyond what this plan required):

- `src/client/components/AdminPanel.tsx` — unchanged (still uncommitted)
- `src/client/components/EventBoard.tsx` — unchanged (still uncommitted)
- `src/client/components/ui-correctness.test.tsx` — unchanged (still uncommitted)
- `src/main.tsx` — ONLY the `getPageFromHash` hunk was staged + committed; the pre-existing manager-routing dirty edits remain uncommitted in the working tree.
- `src/styles.css` — unchanged (still uncommitted)

## Self-Check: PASSED

- [x] `src/client/api/device-key.ts` exists (FOUND).
- [x] `src/client/components/QrCanvas.tsx` exists (FOUND).
- [x] `src/client/components/login-panel.test.tsx` exists (FOUND).
- [x] Commit `4fc3660` present in `git log` (Task 1).
- [x] Commit `db9ea02` present in `git log` (Task 2).
- [x] Commit `b91a2a3` present in `git log` (Task 3).
- [x] Commit `8b1681c` present in `git log` (Task 4).
- [x] `grep -E '"qrcode-generator"' package.json` → present.
- [x] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [x] `npx vitest run --dir src` exits 0 (**56/56** passed).
- [x] `npx vitest run src/client/components/login-panel.test.tsx` exits 0 (3/3).
- [x] `npm audit --omit=dev` → 0 vulnerabilities.
- [x] `git diff --diff-filter=D --name-only HEAD~4 HEAD` empty (no unintended deletions).

---
*Phase: 09-device-recognition-and-pairing*
*Completed: 2026-04-16*
