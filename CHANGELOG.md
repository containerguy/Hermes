# Hermes Changelog

Versions are annotated tags `vX.Y.Z` on `main`. Each entry mirrors the
`chore(release): vX.Y.Z` commit that bumps `package.json`,
`package-lock.json`, and `src/server/openapi/hermes-api.yaml`.

## v0.13.1 — Clearer server controls (2026-10-16)

### Game servers

- "Start" is disabled while the game runs or is starting, and "Stop" while it
  is stopped. The server also refuses these actions without calling AMP
  (`409 amp_laeuft_bereits`, `409 amp_bereits_gestoppt`). Sleeping servers
  can still be started.
- If AMP answers but rejects an action (`Status: false`), Hermes now shows
  "AMP hat die Aktion abgelehnt …" (`409 amp_aktion_abgelehnt`) instead of
  claiming the AMP API did not respond. AMP's reason goes to the server log.

## v0.13.0 — Bots for CS 1.6 and CS2 (2026-10-16)

### Bots

- CS 1.6 gets bots via the YaPB mod 4.4.957 (`ops/amp/cs16-yapb/`):
  - `install.sh` installs it with a pinned checksum (`--check`,
    `--dry-run`, `--relink`, `--uninstall`).
  - LAN defaults: no bots until requested, bots make room for humans,
    German menu, chat and family-friendly bot names, no waypoint
    upload/download.
  - An AMP update stage re-hooks YaPB after each game update. It was
    tested in the LAN; the README has the exact `GenericModule.kvp` entry.
- New bot controls in the event card (manager and up) for CS 1.6 (YaPB)
  and CS2: count, level (easy to expert) and team, with **Add**,
  **Fill up to N**, **Change level for all** and **Remove all**.
  - Endpoint: `POST /api/integrations/amp/instances/:bindingId/bots`.
  - Hermes builds the game-specific commands itself and sends them one
    by one, with CSRF, the `amp_control` rate limit and audit entries
    `amp.bots_<action>`.
  - All actions use the `fill` quota mode, the only one in which bots make
    room for joining humans (tested in the LAN). Hermes reads bots and
    humans from the console (`yb list`, `status`; AMP does not count bots
    as players): **Add** first sets the quota to humans + bots, then each
    `yb add`/`bot_add` raises it by one. CS2 re-adds the bots on
    "Change level", because `bot_difficulty` only applies to new bots.
    **Count bots** shows the number (`GET …/bots`).
  - With a fixed team, Hermes turns off `mp_limitteams` and
    `mp_autoteambalance`; otherwise the game refuses with "Team is stacked".
- Console templates "Bots (YaPB)" for CS 1.6.
- `install.sh --uninstall` also works without a backup of `liblist.gam`
  and no longer stops early when the waypoint folder is missing.

### Game servers

- Console input for CS 1.6, CS2 and CoD4 is split at `;` (outside quotes)
  and sent as separate commands, because AMP passes GoldSrc RCON lines
  through unsplit. Minecraft and Factorio keep the line as is.
- Game update only while the game is stopped (`409
  amp_update_erst_stoppen`, button disabled otherwise). An AMP update on a
  running game left `hlds_linux` orphaned on its port, so the next start
  failed.
- Binding audit entries include `autoStopEnabled`.

### Pizza

- Cash list PDF prints the PayPal/cash recipient whenever an order chose
  that method, even if it is no longer offered.

## v0.12.0 — Game servers (AMP), persistent sessions, pizza management (2026-10-16)

Covers everything merged to `main` since v0.11.0: persistent sessions and
devices (#10), dependency fixes (#11), the game server module for CubeCoders
AMP (#1, #12) and pizza management (#14).

### Upgrade notes

- Migrations `0019_devices`, `0020_game_server_bindings`,
  `0021_binding_auto_stop` and `0022_pizza_management` run on start.
- `0022` archives old pizza rounds once: every round that is delivered or
  not the newest one disappears from the current view and stays in the
  archive. The newest undelivered round stays active.
- The AMP module is off by default (`ampIntegrationEnabled`). It needs
  `HERMES_AMP_USERNAME`/`HERMES_AMP_PASSWORD` and the base URL in
  `Admin → Betrieb`.
- S3 restore now also restores the pizza tables. Snapshots must still have
  the same migration level as the live database.

### Game servers (CubeCoders AMP)

- Admins bind AMP instances to game titles (`game_server_bindings`), with
  suggestions from AMP matched against the game catalog. Events with a
  matching title link to the binding automatically; managers can pick or
  clear the binding per event.
- Event cards show the server status (running, players, joinable incl.
  sleep mode) and a connect action (Steam link with resolved IP,
  Minecraft address, or copy).
- From the manager role: start, stop, restart, update, kill, and a server
  console with masked secrets, per-game command templates (CS 2, CS 1.6,
  CoD4, Minecraft, Factorio, Soldat; UT2004 points to WebAdmin), rate
  limit and audit log.
- Automation (opt-in settings): auto-start the bound server when an event
  becomes ready (at most once per event, with one follow-up start after
  `ADSModule/StartInstance`), idle stop after N minutes with 0 players for
  bindings that allow it (`autoStopEnabled`, default off), push
  "Server läuft" to joined participants with notifications enabled.
- Kiosk shows the server status of events.
- Configuration: `HERMES_AMP_USERNAME`, `HERMES_AMP_PASSWORD`, optional
  `HERMES_AMP_REMEMBER_TOKEN_FILE` and `HERMES_AMP_CA_FILE` (CA pinning);
  settings `ampIntegrationEnabled`, `ampBaseUrl`, `ampAutoStartOnReady`,
  `ampAutoStopIdleMinutes`.
- Fix: `game_server_bindings` is part of S3 restore; Vitest no longer
  picks up Playwright specs.

### Pizza management

- From the manager role (not only admin): edit menu items, variants and
  prices in the pizza panel; variants referenced by orders are deactivated
  instead of deleted, price snapshots of existing orders stay unchanged.
- Rounds can be archived in any state (with a warning for undelivered
  rounds), archived rounds are listed with totals and unpaid count, their
  cash list PDF stays available, and they can be deleted for good.
- Cash payment: setting `pizzaPaymentMethods` (`cash_and_paypal`,
  `cash_only`, `paypal_only`); guests choose cash or PayPal, managers mark
  orders as paid in cash or via PayPal. Managers change the payment methods
  directly in the pizza panel (`PUT /api/pizza/payment-mode`). PayPal is
  only offered when a PayPal handle is set.
- Fix: a failed round transition (e.g. a second "delivered" click) no
  longer archives the round or creates an empty draft.
- Archived rounds are frozen: order lines, the guest's payment method and
  the payment status can no longer be changed (`409 pizza_runde_archiviert`),
  also not by managers. The archive dialog shows how many orders are still
  unpaid. Empty orders are removed when a round is archived and not counted
  in the archive.
- Cash list PDF: payment status as plain text (`[x] bezahlt (Bar)`,
  `[ ] offen – PayPal gewählt`) instead of check box glyphs the built-in
  font cannot render; "Gedruckt" uses Europe/Berlin time.
- All pizza write routes require the CSRF header; new error codes are
  translated (de/en).
- Changing the payment methods resets open orders whose chosen method is
  no longer offered (to the single remaining method, otherwise unset).
- Fix (also on v0.11.0): admin restore from S3 failed for every snapshot
  with `no such column: "users"` because the column lookup quoted the
  table name as an identifier, which SQLite builds without DQS reject.
  A test now runs backup and restore through the real routes.
- S3 uploads no longer use "flexible checksums" (`aws-chunked`), which
  some S3-compatible services store as part of the object.
- Pizza tables (`pizza_menu_items`, `pizza_menu_variants`,
  `pizza_sessions`, `pizza_orders`, `pizza_order_lines`) are part of S3
  restore. A test requires an explicit restore decision for every table.

### Dependencies

- `npm audit` fixes: proxy-addr, nodemailer 10.1.1, qs, body-parser.

### Persistent sessions and devices

#### Behavior change

- Sessions no longer hard-expire 30 days after login. They now expire after
  `HERMES_SESSION_TTL_DAYS` (default 180, max 400) days **without use**; every
  use extends them. The session cookie is re-issued at most once per day.
  Idle-expired sessions are also rejected server-side.
- Device names belong to the device, not to a single session. Logging out,
  an admin role/email change or a remote "Abmelden" keeps the device and its
  name; the next login on the same browser reuses it.

#### Server

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

#### Client

- The login form hides the device-name field when this browser is already
  known for the entered user ("Dieses Gerät ist als „…" bekannt.").
- New "Mit Pairing-Link anmelden" field on the login page (paste link or
  code); expanded by default in an iOS home-screen app.
- Pairing section: "Link kopieren" button and an iOS hint explaining that
  the home-screen app needs pairing.
- "Dieses Gerät vergessen" uses the new endpoint.

#### Configuration

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
