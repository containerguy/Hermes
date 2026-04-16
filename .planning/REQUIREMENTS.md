# Requirements: Hermes (v1.2)

**Defined:** 2026-04-16  
**Milestone:** v1.2 — Post-LAN Quality of Life  
**Core Value:** During the LAN party, everyone can quickly see which game round is viable, when it starts, who is in, and how to join it.

## v1.2 Requirements

These requirements promote captured backlog todos into formal phases. Scope covers device-friction reduction in auth, an admin-driven theming/copy refresh, bulk user onboarding, perceptible notification UX, and CI Node 24 readiness.

### Auth — Device Friction

- [ ] **AUTH-01**: When a user re-logs in from the same device, Hermes recognizes the device and updates the existing session entry instead of creating a duplicate session. Recognition uses low-entropy signals (platform, browser family, mobile/desktop, PWA flag) and/or a Hermes-specific local device key. No invasive fingerprinting (no Canvas/WebGL).
- [ ] **AUTH-02**: An authenticated user can pair an additional device (smartphone/PC) without requesting another email one-time code. Pairing is via a session-bound, short-TTL (≤10 min), one-time, rate-limited token delivered as a link/QR. The original session must remain active for the token to be redeemable; redemption creates a new session bound to the same user. `device_paired` audit log entries omit secrets.

### Admin — Theming, Copy, and Onboarding

- [ ] **THEME-01**: Admins can select from multiple built-in “gaming” theme presets and create/edit custom themes via CSS token variables. The selected theme persists in settings and is applied client-side without a page reload requirement.
- [ ] **THEME-02**: Admins can change the application background image, choosing from a curated set of preset images (sourced from the existing S3 snapshot bucket under a Hermes-specific prefix) or a custom image. The client renders backgrounds while preserving readability (overlay/blur/contrast as needed).
- [ ] **COPY-01**: All user-facing UI strings (titles, descriptions, buttons, hints, error messages) are revised to a "modern, concise, clear" style without losing technical specificity. Copy ships in the existing language(s) — no new i18n framework is introduced in this milestone.
- [ ] **ADM-02**: Admins can bulk import users via CSV or JSON paste/upload in the AdminPanel. The import has a preview/dry-run with validation (Zod) and duplicate detection on username/email, runs as a single transactional write, and emits an aggregated `user_bulk_import` audit entry.

### Notifications — Perceptibility

- [ ] **NOTIF-01**: Web Push payloads and the in-app notification path expose audio/haptic affordances where the platform supports them. A profile/settings toggle controls "audible cues" and "haptic feedback"; calls to `navigator.vibrate` and notification audio fields are feature-detected and degrade silently when unsupported (no errors). OS/browser overrides are documented in the toggle description.

### CI/Tooling

- [ ] **CI-01**: GitHub Actions workflows are pinned to action versions that support Node.js 24 (the GA runtime from June 2026) for `actions/checkout`, `docker/setup-buildx-action`, `docker/login-action`, `docker/metadata-action`, and `docker/build-push-action`. CI continues to pass `npm ci`, `npm test`, `npm run build`, `npm audit --omit=dev`, and Docker build/push. `INTEGRATIONS.md` reflects the new pinned versions.

## Future Requirements (deferred)

- [ ] **UX-01**: Deeper event visualization (progress-to-min, status timeline) beyond simple badges/meters. *(carried from v1.1)*
- [ ] **ADM-01**: Advanced admin audit filtering (by user/action/time range) and export. *(carried from v1.1)*
- [ ] **THEME-03**: AI-generated background image pipeline (server-side job that produces curated S3 presets). Deferred from THEME-02 — v1.2 consumes presets but does not generate them.

## Out of Scope (this milestone)

| Item | Reason |
|------|--------|
| Native mobile app shells | Hermes stays a web/PWA app. |
| New i18n framework / multi-language toggle | Out of scope for copy refresh; revisit when adding non-German/English support. |
| Cross-site canvas/WebGL fingerprinting | Privacy guardrail for AUTH-01. |
| Replacing Web Push with another transport | Push limitations are documented; we keep the existing transport. |
| Multi-instance / multi-writer SQLite | Architecture decision unchanged. |
| AI image generation pipeline (THEME-03) | Deferred — v1.2 only consumes presets present in S3. |

## Traceability

Every v1.2 requirement maps to exactly one roadmap phase and remains pending until that phase is completed.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 9 | Pending |
| AUTH-02 | Phase 9 | Pending |
| THEME-01 | Phase 10 | Pending |
| THEME-02 | Phase 10 | Pending |
| COPY-01 | Phase 10 | Pending |
| ADM-02 | Phase 11 | Pending |
| NOTIF-01 | Phase 12 | Pending |
| CI-01 | Phase 13 | Pending |
