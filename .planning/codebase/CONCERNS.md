# Codebase Concerns

**Analysis Date:** 2026-05-01

> Hermes v0.9.0. Phases 1–6 (auth/profile/invite hardening, event/invite consistency, backup/restore safety, PWA/realtime reliability, frontend modularization, release verification) have all landed. The concerns below describe the **current** state after that hardening — not historical issues that have since been fixed. Where a concern was reduced (but not eliminated) by an earlier phase, that is called out explicitly.

## Tech Debt

**`src/main.tsx` shell growth risk:**
- Issue: `src/main.tsx` is 571 lines and acts as the SPA shell — it owns route map, hash routing, settings/release loading, branding/i18n providers, navigation, and per-page chrome. Phase 5 modularized the panel components (`AdminPanel`, `EventBoard`, `LoginPanel`) out of the shell, but the shell itself was kept intact and is once again the natural sink for any future cross-cutting concern (locale switching, auth bootstrap, theme apply, kiosk routing, etc.).
- Files: `src/main.tsx`
- Impact: Each new shell-level feature adds top-level state and effects to a single function component. There is no existing test for the shell itself (only for the panels it composes), so regressions show up only in `src/server/http/app-flow.test.ts` (1746 lines, integration-level).
- Fix approach: Extract router (`buildAppRoutes` + hash listener) and the settings/release loader into dedicated hooks under `src/client/lib/` before the file crosses ~700 lines. Add a focused shell test (`main.test.tsx`) that asserts route-to-page mapping and locale resolution.

**Large component/route files in same modularization layer:**
- Issue: `src/client/components/AdminPanel.tsx` (1751 lines), `src/server/http/admin-routes.ts` (1638 lines), `src/server/http/auth-routes.ts` (1334 lines), and `src/client/components/LoginPanel.tsx` (1077 lines) are the four files that absorb every new admin/auth concern. Each new phase (08 soft-delete, 09 device pairing, 10 theme, 11 bulk import, 12 audio prefs) added a tab/section/route to one of them.
- Files: `src/client/components/AdminPanel.tsx`, `src/server/http/admin-routes.ts`, `src/server/http/auth-routes.ts`, `src/client/components/LoginPanel.tsx`
- Impact: PR diffs touch the same file repeatedly; merge friction grows; tests for one tab pull in the whole panel. The risk is the same as `main.tsx` but accelerated — these files already grew faster than the shell did.
- Fix approach: Split `AdminPanel` along its tab boundaries (Users, Invites, Audit, Settings, Design, Backup, Devices, Bulk Import) into sibling files under `src/client/components/admin/`. Split `admin-routes.ts` along the same domain boundaries (`admin-user-routes.ts`, `admin-invite-routes.ts`, `admin-backup-routes.ts`, `admin-device-routes.ts`). Do this opportunistically when a phase next touches one of these files.

**Default-value secrets for HMAC keys:**
- Issue: Three HMAC-keyed primitives fall back to hardcoded `"hermes-dev-*"` secrets when their env var is unset: `HERMES_DEVICE_KEY_SECRET` (`src/server/auth/device-key.ts:7`), `HERMES_PAIR_TOKEN_SECRET` (`src/server/auth/pairing-tokens.ts:7`), `HERMES_CSRF_SECRET` (`src/server/auth/csrf.ts:10`).
- Files: `src/server/auth/device-key.ts`, `src/server/auth/pairing-tokens.ts`, `src/server/auth/csrf.ts`
- Impact: A misconfigured production deployment silently uses well-known secrets. Device-key hashes, pairing tokens, and CSRF tokens are all forgeable by anyone reading the source.
- Fix approach: Refuse to start when `NODE_ENV === "production"` and any of these env vars are unset. Log a single startup error listing which secret is missing. Document the three vars in README's deployment section together with `HERMES_COOKIE_SECURE`.

## Known Bugs

None tracked at codebase level after Phases 1–6. The phase plans (`.planning/phases/01-…` through `06-…`) closed all known auth, invite, restore, and PWA bugs that motivated the v1.0 hardening line.

## Security Considerations

**Auth abuse controls — current state and gaps:**
- Risk: OTP enumeration / brute force across the login flow.
- Files: `src/server/auth/rate-limits.ts`, `src/server/http/auth-routes.ts`
- Current mitigation:
  - Per-scope sliding-window rate limits at `src/server/auth/rate-limits.ts:36-46` (login_request: 5/5min → 10min block; login_verify: 8/10min → 15min block; invite_register: 10/30min → 30min block; pair_token_create: 5/10min → 15min block).
  - Rate-limit key is composed of `username + IP` (`src/server/http/auth-routes.ts:338`), so a single attacker IP is tracked across usernames.
  - `recordRateLimitFailure` is called **before** the user-existence check (`src/server/http/auth-routes.ts:353`), and unknown users still get `202 ok` (`:369`). This protects against username enumeration via response shape.
  - Stored OTPs use `scrypt` with random per-code salt (`src/server/auth/otp.ts:11-15`), verified via `timingSafeEqual` (`:27`). Codes are six digits from `randomInt` (`:5`).
  - IPv4 CIDR allowlist for trusted networks (`src/server/auth/rate-limits.ts:67-86`).
- Recommendations:
  - Six-digit OTP + 8-attempt verify limit gives ~8 / 1,000,000 = 8e-6 success per code lifetime — acceptable, but if the verify-rate-limit key is **only** username (without IP), a single attacker can lock out a real user with 8 wrong guesses. Confirm `login_verify` key includes IP (currently the file does not show it; `src/server/http/auth-routes.ts:618+` should be audited for parity with `request-code`).
  - The scrypt parameters use Node defaults; if password-grade hardness is desired, set explicit `N`/`r`/`p` cost params in `hashOtp`.
  - Allowlist matching is IPv4-only (`isIpv4InCidr`); IPv6 callers in CIDR form are silently not allowlisted.

**Device pairing security surface (Phase 09):**
- Risk: Pairing tokens grant one-shot session inheritance to a new device. Compromise of an unredeemed pairing token = account takeover on a new device, scoped to the originating session's user.
- Files: `src/server/auth/pairing-tokens.ts`, `src/server/http/auth-routes.ts:1110-1240`, `src/server/http/auth-pair.test.ts`
- Current mitigation:
  - Tokens are 32 bytes from `randomBytes` (`pairing-tokens.ts:3,11`), HMAC-SHA256-hashed before storage (`:15`), 10-minute TTL (`:4`), one-shot consumption (`auth-routes.ts:1207`).
  - Origin session must still exist and be unrevoked at redemption time — revoking the source session invalidates outstanding tokens (`auth-routes.ts:1221-1231`).
  - Rate-limited (`pair_token_create` scope) per session and per user (`:1164-1165`).
  - Failed redemptions emit `device_pair_failed` audit entries (`:1196-1202`).
- Recommendations:
  - The default secret fallback (`pairing-tokens.ts:7`) MUST be enforced as required in production (see "Default-value secrets" above) — without this the HMAC adds no protection.
  - Consider binding pairing tokens to the originating user agent / IP class so a stolen token cannot be redeemed from a different device class. Currently any client with the token can redeem.
  - Audit log entries for successful redemptions should include the redeeming device fingerprint (platform/browser/deviceClass) so operators can spot anomalous pairings.

**HTTPS / TLS / reverse proxy out of scope:**
- Risk: Hermes serves HTTP only. Cookies, OTP codes, pairing tokens, API tokens, and CSRF tokens all transit unencrypted unless an external proxy provides TLS.
- Files: `src/server/index.ts` (HTTP only), `Dockerfile` (no TLS), `docker-compose.yml`
- Current mitigation: Documented as operator-owned in `README.md:174,302-303`. `HERMES_COOKIE_SECURE=true` flag exists for HTTPS deployments.
- Recommendations:
  - README should state explicitly that public deployments without a TLS-terminating reverse proxy (Caddy/nginx/Traefik) are unsafe — not just "Push needs Secure Context."
  - Provide a reference `docker-compose.tls.yml` snippet using Caddy with automatic Let's Encrypt as the recommended path. Avoiding this leaves every operator to invent their own.
  - Audit whether `Set-Cookie` always sets `SameSite=Lax` and `HttpOnly` regardless of `HERMES_COOKIE_SECURE`.

## Performance Bottlenecks

**Single-writer SQLite + per-write S3 snapshot model:**
- Problem: Every successful write triggers a full SQLite snapshot upload to S3 (deferred via `snapshotTimer` in `src/server/storage/s3-storage.ts:63`). Throughput is therefore bounded by S3 PUT latency for the entire DB file, not per-row write latency.
- Files: `src/server/storage/s3-storage.ts`, `src/server/db/client.ts`
- Cause: Hermes intentionally uses file-level snapshots rather than logical replication or streaming WAL shipping. Documented in `README.md:50` and `AGENTS.md:241`.
- Improvement path: Keep the current model — it is a deliberate simplicity trade-off for single-instance deployments — but document the practical write ceiling (e.g. one snapshot per debounce window). If the DB grows past ~50 MB the snapshot becomes the dominant cost; consider a per-table delta upload only if that limit is approached.

**Concurrency on capacity-bounded events:**
- Problem: Event-capacity admission must serialize across concurrent participations; otherwise two voters can both be admitted to the last seat.
- Files: `src/server/http/event-routes.ts:443,484`, `src/server/http/event-capacity.test.ts`
- Cause: `transaction.immediate()` is used in the participate path, which acquires SQLite's reserved lock immediately and prevents the lost-update race. The capacity test exercises this directly. This is correct on a single-process deployment.
- Improvement path: Document the assumption (single Node process, single SQLite writer) at the top of `event-routes.ts`. If Hermes is ever clustered, capacity admission must move to an external lock or be redesigned around an authoritative-instance leader.

## Fragile Areas

**Restore safety (validation-first + recovery snapshot):**
- Files: `src/server/storage/s3-storage.ts:569-740`
- Why fragile: Restore opens the snapshot in a temp directory, validates schema/columns/FKs/migrations, writes a pre-restore recovery snapshot under `storage_restore_recoveries`, and only then mutates the live DB. The validation set is now strict (`RestoreValidationError` with structured `RestoreDiagnostics`), and the per-table copy is by explicit columns (no `SELECT *`). This is good — but the contract is also load-bearing: every new table added to `src/server/db/schema.ts` MUST be added to the `restorableTables` list (`s3-storage.ts:65-77`) or restore will silently drop it.
- Safe modification: When adding a new table, add it to `restorableTables` in the same commit and update `s3-storage.test.ts`. The validator will catch it (missing-table) on existing snapshots, but new snapshots taken before the table is added would not include it.
- Test coverage: `src/server/storage/s3-storage.test.ts` exercises validation failure modes; review on each schema change.

**Realtime + push fanout:**
- Files: `src/server/realtime/`, `src/server/push/push-service.ts`, `src/server/http/event-side-effects.test.ts`
- Why fragile: Event mutations fan out to (a) realtime SSE subscribers and (b) Web Push subscriptions in the same request. Failure modes from web-push (invalid subscription, 410 Gone) are handled in `push-service-cleanup.test.ts`, but the realtime side path shares the request lifecycle. A slow push provider can extend response time.
- Safe modification: Keep push fanout strictly post-response or background. Test changes must keep `event-side-effects.test.ts` green — it asserts the exact `vibrate`/payload shape sent to the SW.

## Scaling Limits

**Process model:**
- Current capacity: One Node process, one SQLite file. Event capacity, invite redemption, and rate-limit counters all assume single-writer.
- Limit: Cannot horizontally scale. A second instance against the same SQLite file would corrupt rate-limit counters and break capacity admission (locks are per-process).
- Scaling path: Vertical scaling only. If horizontal is ever required, replace SQLite with Postgres and move to logical replication; this is a re-architecture, not a tweak.

**SMTP delivery on the hot path of login:**
- Current capacity: `request-code` awaits SMTP send (`src/server/http/auth-routes.ts:389-395`) and returns 502 on failure.
- Limit: A slow or failing SMTP provider blocks login throughput and surfaces as `mailversand_fehlgeschlagen` to the user.
- Scaling path: Acceptable for the intended LAN-party / small-club scale. For larger deployments, queue the OTP send and ack the request immediately.

## Dependencies at Risk

**Playwright cannot execute browsers in current sandbox:**
- Risk: `npm run test:e2e` requires `libnspr4.so`, which is not installed in the dev/CI sandbox.
- Impact: `e2e/hermes-flow.spec.ts` cannot be run locally or in the current GitHub Actions image without an extra `apt-get install libnspr4`. Phase 10-05 explicitly carved out the case "failing e2e due to libnspr4 is not a blocker" (`.planning/phases/10-theme-system-and-copy-refresh/10-05-copy-refresh-sweep-PLAN.md:183`).
- Migration plan: Add `apt-get install -y libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2` to the CI image (or use `npx playwright install --with-deps`). Until then, e2e is effectively manual and the spec file is at risk of bit-rot.

**CI Node 24 readiness (Phase 13 in flight):**
- Risk: GitHub Actions deprecates JS actions on Node 20 and switches default runtime to Node 24 in June 2026.
- Impact: Workflows using older `actions/checkout`, `docker/*` actions will start emitting deprecation warnings, then break.
- Migration plan: Tracked in `.planning/phases/13-ci-node-24-readiness/13-01-PLAN.md`. Pin to Node-24-compatible majors and set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` to surface failures pre-cutover. Verify on a PR branch — do not experiment on `main`.

## Missing Critical Features

**No bundled TLS / reverse-proxy / cert management:**
- Problem: Hermes ships HTTP only. Operators must configure TLS termination themselves.
- Blocks: Push notifications on non-localhost LAN URLs (browsers gate Push behind Secure Context — see `README.md:174`); use of `HERMES_COOKIE_SECURE=true` requires HTTPS upstream; safe public deployment.
- Mitigation: Documented as operator-owned in `README.md:302`. A reference Caddy compose file would close the gap without changing scope (Caddy auto-provisions Let's Encrypt certs).

**PWA / push limitations on mobile:**
- Problem: Web Push works, but platform constraints affect UX:
  - **iOS Safari:** Web Push requires the site to be installed as a PWA (added to home screen). Custom notification sounds are not supported — the system "default" tone is always used; only `vibrate` patterns reach the SW (handled in `src/server/push/service-worker-push.test.ts`).
  - **Android Chrome:** Custom sounds in `Notification` options are ignored on Chrome ≥ 53; only channel-level sound from a TWA/installed app would help.
  - All mobile platforms: Push requires the deployment to be served over HTTPS (`README.md:174`); plain LAN HTTP delivery silently fails subscription.
- Files: `public/sw.js`, `src/server/push/push-service.ts`, `src/server/http/push-routes.ts`
- Blocks: True audio cues for new events on mobile cannot be guaranteed cross-platform. Phase 12 (`.planning/phases/12-audio-and-haptic-notifications/`) accepts this and ships **vibrate-only haptic** as the cross-platform default with sound as a desktop best-effort.
- Mitigation: Document the per-platform matrix in README's notification section so operators do not promise users an audible alert.

## Test Coverage Gaps

**Frontend shell (`src/main.tsx`) untested in isolation:**
- What's not tested: Hash routing, route-to-page mapping, settings/release boot, locale resolution at the shell level. The shell is exercised only via the integration tests in `src/server/http/app-flow.test.ts`.
- Files: `src/main.tsx`
- Risk: A regression in route mapping (e.g. broken kiosk URL detection or admin section dispatch) surfaces only at integration-test scale — slow feedback loop.
- Priority: Medium — add when `main.tsx` next sees a structural change.

**E2E coverage effectively dark:**
- What's not tested in CI: `e2e/hermes-flow.spec.ts` cannot run without `libnspr4.so` (see "Dependencies at Risk").
- Files: `e2e/hermes-flow.spec.ts`, `playwright.config.ts`
- Risk: Browser-level regressions (focus order, keyboard nav, real CSP behavior) only surface in manual testing.
- Priority: High — fix the CI image so e2e is part of `npm run verify:ci`.

**Device-pairing tests cover happy + main failure paths, but not session-revocation race:**
- What's not tested: A pairing token created at T, source session revoked at T+1, redeemed at T+2 — the redeem path checks `pair_origin_revoked` (`src/server/http/auth-routes.ts:1221`), but there is no concurrent test that a revocation between validate and consume fails closed.
- Files: `src/server/http/auth-pair.test.ts`
- Risk: Race-condition takeover if revocation lands between the existence check and the `update consumed_at` write.
- Priority: Medium — add an interleaved test that asserts a token revoked mid-flight is rejected.

---

*Concerns audit: 2026-05-01*
