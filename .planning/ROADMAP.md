# Roadmap: Hermes

## Milestones

- ✅ **v1.0 Hermes v1 Release Hardening** — Phases 1–6 (shipped 2026-04-16). Archive: `.planning/milestones/v1.0-ROADMAP.md`
- ✅ **v1.1 UX Polish** — Phases 7–8 (shipped 2026-04-16). Archive: `.planning/milestones/v1.1-ROADMAP.md`

## Current Milestone: v1.2 Post-LAN Quality of Life

### Scope (v1.2)

- AUTH-01, AUTH-02 (device recognition + session-bound device pairing)
- THEME-01, THEME-02, COPY-01 (admin theming, background images, copy refresh)
- ADM-02 (bulk user import)
- NOTIF-01 (audio + haptic notification UX)
- CI-01 (GitHub Actions Node 24 readiness)

## Phases

- [ ] **Phase 9: Device Recognition and Session-Bound Pairing** - Recognize the same device on re-login and let an authenticated user pair an additional device via a short-lived QR/link token without a second email OTP.
- [ ] **Phase 10: Admin Theme System, Backgrounds, and Copy Refresh** - Admin-selectable gaming theme presets plus custom CSS-token themes, background-image selection from S3 presets, and a project-wide copy refresh to a modern/concise/clear voice.
- [ ] **Phase 11: Admin Bulk User Import** - CSV/JSON bulk import in AdminPanel with preview, dry-run, Zod validation, duplicate detection, transactional write, and aggregated audit logging.
- [ ] **Phase 12: Audio and Haptic Notification UX** - Surface audio + haptic affordances in Web Push payloads and the in-app realtime path, with feature-detected, settings-toggleable behavior.
- [ ] **Phase 13: CI Node 24 Readiness** - Pin GitHub Actions to versions that support Node.js 24 and verify `npm ci/test/build/audit` plus Docker build/push remain green.

## Phase Details

### Phase 9: Device Recognition and Session-Bound Pairing
**Goal**: An authenticated user can re-log in on the same device without producing a duplicate session, and can pair an additional device via a session-bound, short-lived QR/link token without a second email OTP.
**Depends on**: Phase 8
**Requirements**: AUTH-01, AUTH-02
**Success Criteria** (what must be TRUE):
  1. Re-login from the same device updates the existing session/device entry instead of creating a new one (verifiable in HTTP auth-route tests).
  2. An authenticated session can mint a short-TTL, one-time, rate-limited pairing token; redemption from a second device creates a new session for the same user; the original session remains active.
  3. Pairing tokens are opaque (no PII), rejected after expiry/use/source-session-revocation with stable error codes; `device_paired` audit entries are emitted without leaking secrets.
**Plans:** 4 plans
Plans:
- [ ] 09-01-schema-and-device-model-PLAN.md — Migration `0010_device_pairing.sql`, Drizzle schema for `pairing_tokens` + `sessions.device_key_hash`, helper modules (`device-key.ts`, `pairing-tokens.ts`), `pair_token_create` rate-limit scope (AUTH-01, AUTH-02 foundation).
- [ ] 09-02-same-device-recognition-PLAN.md — Extend `verify-code` to recognize `(userId, deviceKeyHash)` or normalized signals and update existing session in place; new `auth.login_recognized` audit code; vitest covering happy + negative paths (AUTH-01 server).
- [ ] 09-03-pairing-endpoints-PLAN.md — `POST /api/auth/pair-token` (auth + CSRF + rate-limited mint) and `POST /api/auth/pair-redeem` (public, single-use, atomic) with stable error codes and `device_pair_*` audit entries; vitest covering 9 cases (AUTH-02 server).
- [ ] 09-04-client-pairing-ux-PLAN.md — `device-key.ts` + `QrCanvas.tsx` (uses `qrcode-generator@1.4.4` per D-15), LoginPanel "Add a device" / "Forget this device" panel, `?pair=<token>` redemption-on-mount with URL strip, German error copy (AUTH-01, AUTH-02 client).
**UI hint**: yes

### Phase 10: Admin Theme System, Backgrounds, and Copy Refresh
**Goal**: Admins can choose or author themes, change the application background from curated S3 presets, and the entire UI reads as modern, concise, and clear.
**Depends on**: Phase 9
**Requirements**: THEME-01, THEME-02, COPY-01
**Success Criteria** (what must be TRUE):
  1. Multiple built-in gaming theme presets are available, selectable in AdminPanel, and applied client-side via CSS variables; admin can also create/edit a custom theme that persists across reloads.
  2. Admin can pick the background image from a list of presets sourced from the existing S3 bucket under a Hermes-specific prefix (image generation itself is out of scope — THEME-03); readability is preserved (overlay/blur/contrast as needed).
  3. UI text across Events, Login/Profile, Manager, and Admin views has been revised to the agreed "modern, concise, clear" voice with no loss of technical specificity, and existing tests still pass.
**Plans**: TBD
**UI hint**: yes

### Phase 11: Admin Bulk User Import
**Goal**: Admins can import many users at once with preview, validation, and a single transactional write, and every import produces an audit-log entry.
**Depends on**: Phase 8
**Requirements**: ADM-02
**Success Criteria** (what must be TRUE):
  1. AdminPanel exposes a CSV/JSON import flow with paste-or-upload, preview, validation errors per row, and a dry-run option.
  2. Admin-only server endpoint validates with Zod, rejects duplicates on username/email, applies defaults (e.g. `notificationsEnabled`), and writes all rows in one DB transaction (or none on failure).
  3. Each import emits an aggregated `user_bulk_import` audit entry (counts of created/skipped/failed) without leaking PII into logs.
**Plans**: TBD
**UI hint**: yes

### Phase 12: Audio and Haptic Notification UX
**Goal**: Notifications are perceptible by sound and/or vibration where the platform allows, with clear settings and silent fallback when APIs are missing.
**Depends on**: Phase 8
**Requirements**: NOTIF-01
**Success Criteria** (what must be TRUE):
  1. Web Push notification payloads include the fields needed for OS/browser sound + vibration when those affordances exist.
  2. Profile/Settings has toggles for "audible cues" and "haptic feedback"; in-app calls to `navigator.vibrate` are feature-detected and never throw if the API is unavailable.
  3. Server tests assert push payload shape; client tests assert that vibration/audio paths only run when their APIs are present and respect the user toggles.
**Plans**: TBD
**UI hint**: yes

### Phase 13: CI Node 24 Readiness
**Goal**: GitHub Actions CI is ready for the Node.js 24 cutover (June 2026) without breaking any existing job.
**Depends on**: Phase 8
**Requirements**: CI-01
**Success Criteria** (what must be TRUE):
  1. All GitHub Actions used in `.github/workflows/docker-image.yml` are pinned to versions documented as Node 24-compatible by their maintainers.
  2. CI runs `npm ci`, `npm test`, `npm run build`, `npm audit --omit=dev`, and the Docker build/push job successfully on the updated workflow (verified by a green run on a PR branch).
  3. `.planning/codebase/INTEGRATIONS.md` is updated to reflect the pinned action versions used.
**Plans**: 1 plan
- [ ] 13-01-PLAN.md — Pin 6 CI actions to Node-24-compatible majors, add FORCE_JAVASCRIPT_ACTIONS_TO_NODE24 env, update INTEGRATIONS.md, verify via green PR run.
**UI hint**: no

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 9. Device Recognition and Session-Bound Pairing | 0/4 | Not started | — |
| 10. Admin Theme System, Backgrounds, and Copy Refresh | 0/0 | Not started | — |
| 11. Admin Bulk User Import | 0/0 | Not started | — |
| 12. Audio and Haptic Notification UX | 0/0 | Not started | — |
| 13. CI Node 24 Readiness | 0/0 | Not started | — |

## Next

Next up:

- Plan Phase 9 (`/gsd-plan-phase 9`) — auth/device-pairing
