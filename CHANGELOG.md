# Hermes Changelog

Versions are annotated tags `vX.Y.Z` on `main`. Each entry mirrors the
`chore(release): vX.Y.Z` commit that bumps `package.json`,
`package-lock.json`, and `src/server/openapi/hermes-api.yaml`.

## Unreleased — Persistent sessions and devices

### Behavior change

- Sessions no longer hard-expire 30 days after login. They now expire after
  `HERMES_SESSION_TTL_DAYS` (default 180, max 400) days **without use**; every
  use extends them. The session cookie is re-issued at most once per day.
  Idle-expired sessions are also rejected server-side.
- Device names belong to the device, not to a single session. Logging out,
  an admin role/email change or a remote "Abmelden" keeps the device and its
  name; the next login on the same browser reuses it.

### Server

- Migration `0019_devices.sql`: new `devices` table (per user, HMAC-hashed
  device key, name, `forgotten_at`), `sessions.device_id` and
  `sessions.renewed_at`. Existing key-bound sessions are backfilled into
  devices.
- New long-lived `httpOnly` cookie `hermes_device` (400 days). Login looks
  up the device by cookie first, then by the client's `localStorage` key;
  the server generates a key when the client sends none. The cookie never
  authenticates on its own.
- Fix: a recognized login without a typed name no longer overwrites a
  custom device name with the auto-derived one.
- New `POST /api/auth/device/forget` (CSRF-protected): marks the device as
  forgotten, revokes its sessions and clears both cookies.
- `verify-code` and `pair-redeem` responses include
  `device: { name, recognized }`.
- Renaming a session renames its device. Soft-deleting a user removes their
  devices. `devices` is part of S3 snapshot restore.

### Client

- The login form hides the device-name field when this browser is already
  known for the entered user ("Dieses Gerät ist als „…" bekannt.").
- New "Mit Pairing-Link anmelden" field on the login page (paste link or
  code); expanded by default in an iOS home-screen app.
- Pairing section: "Link kopieren" button and an iOS hint explaining that
  the home-screen app needs pairing.
- "Dieses Gerät vergessen" uses the new endpoint.

### Configuration

- `HERMES_DEVICE_KEY_SECRET` (documented now; set once and keep stable).
- `HERMES_SESSION_TTL_DAYS` (optional).

## v0.11.0 — Pizza ordering as opt-in feature (2026-05-20)

### Behavior change (admin action required on upgrade)

**Pizza ordering is now off by default.** Existing installs lose access
to `/api/pizza/*` and the start-page pizza panel on upgrade until an
admin enables the feature in `Admin → Betrieb → Pizzabestellung
(optionales Modul) → "Pizzabestellung aktivieren"`.

This matches the user request: pizza is now an opt-in module rather
than a standard part of the app.

### Server

- New setting `featuresPizzaEnabled: boolean` (default `false`) on
  `HermesSettings` and `PublicHermesSettings`.
- `createPizzaRouter` adds a feature-gate middleware at the top:
  when the setting is `false`, every route returns
  `404 { error: "feature_deaktiviert" }`. Disabled feature is
  indistinguishable from a missing endpoint.
- No changes to the pizza domain modules — only the HTTP layer is
  gated. Re-enabling the feature restores the full surface immediately.

### Client

- `src/main.tsx` only mounts `<PizzaPanel>` when both `currentUser` and
  `settings.featuresPizzaEnabled` are truthy.
- `AdminPanelBetrieb` only renders `<PizzaMenuJsonAdmin>` when the
  feature is on.
- The Pizza fieldset in `AdminPanelBetrieb` is restructured:
  - Always-visible checkbox "Pizzabestellung aktivieren" (the feature
    toggle).
  - PayPal/Cash recipient inputs only render when the feature is on
    (no point configuring payment settings for a disabled feature).
- All admin-side pizza labels are now localized via new
  `admin.features.pizza.*` keys (legend, enable label, help text,
  payment help text, paypal handle/name, cash recipient).

### i18n status

- **Audit complete**: the admin-side pizza fieldset is fully
  localized.
- **Known gap (deferred to a future release)**:
  `src/client/pizza/PizzaPanel.tsx` (559 lines) and
  `src/client/pizza/PizzaMenuJsonAdmin.tsx` (131 lines) are
  hardcoded German with zero `useI18n` calls. Approximately 60–80
  translation keys would be needed for a full sweep. Tracked as a
  follow-up — the feature toggle ships independently because both
  surfaces are admin-gated and the gap pre-existed.

### Test fixtures

- The three client test files (`admin-panel.test.tsx`,
  `login-panel.test.tsx`, `ui-correctness.test.tsx`) and the
  server `app-flow.test.ts` settings fixture extended with
  `featuresPizzaEnabled: false`. Suite still 30/30 files, 186/186
  tests, type-check clean.

## v0.10.0 — Internal restructure (2026-05-19)

A large internal cleanup pass. **No user-visible behavior changes.** Every
HTTP response shape, error code, audit code, and i18n key is preserved.
The full vitest suite (30 files / 186 tests) passes under node 22.

### Planning & docs hygiene

- Archive stale planning artifacts under `.planning/archive/`: prior research
  notes, completed v1.0/v1.1 milestone roadmaps, the v1.0 audit, and the six
  todos that were promoted to v1.2 phases on 2026-04-16. Live `.planning/`
  tree now only contains currently-relevant docs.
- Reconcile `STATE.md`, `ROADMAP.md`, and `MILESTONES.md` against the real
  on-disk state: phase 9 marked complete (4/4 SUMMARY files), phases 10–13
  correctly reported as not-started (PLAN-only), malformed Performance
  Metrics rows cleaned up.
- Backfill `.planning/phases/14-pizza-ordering/` retroactively (CONTEXT +
  five SUMMARY files mapping commits `170f750`/`ff1f74c`/`1248546`/
  `d3df6de`/`3d1dadd`) so the pizza ordering system shipped in May 2026 has
  a planning-tree home. Document the 14-03 revoke-cancel hook as later
  reverted in 14-05.
- Refresh `.planning/codebase/STRUCTURE.md`, `TESTING.md`, and
  `ARCHITECTURE.md` to reflect all 18 migrations, the current client +
  domain module tree, all test files, the pizza ordering system, the
  device recognition & pairing flows from phase 9, and the COD4 per-game
  integration pattern.

### Server architecture

- **Unified error handling**: new `src/server/http/errors.ts` exports an
  `AppError` base class (`code` + `status`) and a shared
  `handleDomainError` helper. `PizzaOrderError`, `PizzaLifecycleError`,
  and `PizzaOrderLimitError` now extend `AppError`. `InviteInvalidError`
  and `InviteExhaustedError` in auth-routes also extend `AppError` for
  type consistency; their catch handlers keep their side effects (rate
  limit + audit) inline. Eliminates the
  `(error as unknown as { code?: unknown }).code` cast that was in
  `pizza-routes.ts:156`.
- **`admin-routes.ts`** shrinks from **1638 → 683 lines** via five
  service-layer extractions:
  - `src/server/domain/users/bulk-import.ts` (440 LOC) — CSV/JSON parsing
    + Zod validation + dedupe + DB conflict check + transactional commit.
  - `src/server/domain/users/invites.ts` (314 LOC) — invite-code helpers
    plus full CRUD service: list / create / update / deactivate /
    reactivate / delete-unused. All `invite.*` audit codes preserved.
  - `src/server/domain/users/management.ts` (251 LOC) — user CRUD with
    cascade cleanup on soft-delete, tagged-union results, audit on every
    transition.
  - `src/server/domain/backup.ts` (179 LOC) — `runBackup` / `runRestore`
    with all `storage.*` audit codes preserved; `RestoreValidationError`
    still produces 400 + diagnostics.
- **`auth-routes.ts`** shrinks from **1335 → 1034 lines** via three
  service-layer extractions:
  - `src/server/domain/auth/api-tokens.ts` (134 LOC) — `hm_at_<base64url>`
    mint, scope enforcement, revocation.
  - `src/server/domain/auth/sessions.ts` (133 LOC) — list / rename / revoke
    with `clearSessionCookie` side effect kept in the route handler.
  - `src/server/domain/auth/profile.ts` (203 LOC) — display-name + locale
    update, email-change request (with mail send + sentAt stamping +
    502 mailversand_fehlgeschlagen on failure), and email-change verify
    (transactional update + revoke all sessions). Only the email domain
    is logged in audit metadata, never the full address.

### Client architecture

- **`AdminPanel.tsx`** shrinks from **1796 → 804 lines** by extracting all
  seven section bodies into per-section components (`AdminPanelAudit`,
  `AdminPanelBetrieb`, `AdminPanelDesign`, `AdminPanelInfos`,
  `AdminPanelInvites`, `AdminPanelSicherheit`, `AdminPanelUsers`). Each
  takes a typed slice of state + callbacks; no Context needed.
- **`EventBoard.tsx`** shrinks from **892 → 576 lines**:
  - Pure helpers (`toDatetimeLocal`, `fromDatetimeLocal`,
    `getEventStatusClass`, `isSameLocalCalendarDay`, `capacityPercent`)
    moved into `src/client/lib/event-format.ts`.
  - `useCompactTouchShell` hook moved into
    `src/client/lib/useCompactTouchShell.ts`.
  - `EventCard.tsx` (new) owns `renderEventExpandableRow` +
    `renderEventExpandedContent` plus the five i18n-bound helpers
    (`getEventStatusLabel`, `formatStartForCompactOverview`,
    `formatStartRelative`, `minPlayersGapHint`, `myParticipationLabel`).
    Each card calls `useI18n()` once.
- **`LoginPanel.tsx`** shrinks from **1077 → 677 lines** via seven
  child-component extractions: `ApiTokensSection`,
  `DevicePairingSection`, `PushNotificationsSection`, `SessionsSection`,
  `ProfileSection`, `RegisterStep`, and a combined `LoginStep` that
  branches on `step === "request" | "verify"`. `getPushSupport` and
  `urlBase64ToUint8Array` moved into `src/client/lib/push-support.ts`.

### Test coverage

- **5 new server test files** for previously-untested security-critical
  modules: `auth/csrf`, `auth/device-names`, `auth/hermes-auth`,
  `settings`, `audit-log`. Tests cover the timing guard, the UA
  detection matrix, Bearer precedence over cookie, revoked-token
  rejection, soft-deleted user rejection, schema rejection cases
  including the kiosk-secret superRefine, and `maskInviteCode` boundary
  behavior.
- Suite grows from 27 files / 175 tests to **30 files / 186 tests**.

### Tooling

- `DEVICE_KEY_STORAGE_KEY` in `src/client/api/device-key.ts` demoted to a
  local `const` (it was never imported from elsewhere).

### Out of scope (deferred to a future release)

- Event-routes participation handler (200-line block with retry + capacity
  side effects). Needs a deeper redesign of the retry+capacity path
  before extraction.
- Remaining `auth-routes.ts` handlers tied to the login state machine:
  `request-code`, `verify-code`, `register`, `pair-token`, `pair-redeem`.

---

Prior versions documented via annotated git tags only (`git tag -l --format='%(contents)' vX.Y.Z`). See:

- **v0.9.0** — README API-Doku, Swagger UI Fix (2026-04-20)
- **v0.8.0** — release security for settings API, CSP headers, safe Infos links
- **v0.7.0** and earlier — see `git log` and tag annotations.
