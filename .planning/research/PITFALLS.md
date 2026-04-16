# Domain Pitfalls — Hermes v1.1 UX Polish

**Domain:** Responsive LAN-party coordination web app (React/Vite + Express) with sessions, SSE realtime updates, and optional PWA/push  
**Researched:** 2026-04-16  
**Scope focus:** UX/a11y pitfalls, regression risks during UI polish, hash routing quirks, mobile Safari/PWA issues, behavior drift avoidance

## Critical Pitfalls

Mistakes that commonly cause rewrites, production regressions, or “same feature, different behavior” drift during polish.

### Pitfall 1: “Polish” changes core behavior via route/state coupling
**What goes wrong:** Navigation rework accidentally changes who can see/do what (Admin/Manager vs regular user), resets in-progress inputs, changes default views, or breaks “back” navigation patterns.  
**Why it happens:** UI state is intertwined with routing, and “module separation” introduces implicit remounts that wipe state or re-run effects.  
**Consequences:** Users lose votes, end up on wrong screens, role-only pages become reachable, or critical actions become hidden behind extra taps.  
**Prevention:**
- Treat routes as **public contract**: define allowed entrypoints for Events / Login(Profile) / Manager / Admin, and explicitly map them.
- Keep “polish” to **presentation** and **information architecture**: avoid changing permission checks, default filters, server calls, and persistence semantics.
- When splitting UI modules, ensure “state that must survive navigation” is either URL-driven (safe query/hash params) or persisted in a stable store (not component-local).
**Detection:**
- Manual “behavior drift” checklist (before/after): login → view events → vote dabei/nicht dabei → update/cancel/archiving visibility → logout/session switching.
- Regression watchpoints: unexpected API calls on navigation, votes flipping, or default filters changing.

### Pitfall 2: Accessibility regressions from “visual cleanup”
**What goes wrong:** Removing outlines, using divs as buttons, icon-only controls without labels, focus traps in dialogs, or broken tab order.  
**Why it happens:** Design-driven changes prioritize appearance over semantic HTML and keyboard flow.  
**Consequences:** Keyboard users can’t operate critical actions (vote, change settings), screen reader UX becomes ambiguous, and mobile users lose obvious tap targets.  
**Prevention:**
- Prefer semantic elements (`button`, `a`, `label`, `fieldset/legend`, `dialog` patterns) over ARIA “patching”.
- Preserve or enhance focus styles; if custom, ensure contrast and visibility on all themes.
- Ensure every icon button has an accessible name (visible text or `aria-label`) and state is announced (`aria-pressed`, `aria-expanded`, `aria-current`).
**Detection:**
- Keyboard-only pass: reach every primary action in Events/Profile/Manager/Admin; ensure visible focus and sensible tab order.
- Screen-reader spot check: page landmarks/headings, “vote” affordance and current state announced.

### Pitfall 3: Real-time UI drift (SSE) causing flicker, double updates, or stale UI
**What goes wrong:** Status/capacity visualization becomes inconsistent, flickers on updates, or shows stale derived state after SSE messages.  
**Why it happens:** New visualization layers compute derived state inconsistently across components, or update logic mixes server truth with optimistic UI without reconciliation.  
**Consequences:** Users lose trust (“is it full or not?”), vote buttons disable incorrectly, capacity looks wrong.  
**Prevention:**
- Single source of truth: keep canonical event/participation state normalized; derive UI consistently from that shape.
- Avoid duplicating business rules in multiple components (e.g., readiness/running/cancelled/archived rules).
**Detection:**
- Stress sanity check: open two browsers, vote quickly, watch capacity/status visuals remain consistent.

### Pitfall 4: Hash routing edge cases (deep links, back/forward, scrolling)
**What goes wrong:** Deep links land on blank/incorrect views, `#` fragments collide with in-page anchors, back button behaves oddly, or scroll restoration breaks.  
**Why it happens:** Hash routers share the fragment namespace with anchor links; libraries can interpret hash changes differently across browsers.  
**Consequences:** Users can’t reliably bookmark Events vs Admin pages, “back” doesn’t return to previous view, or auto-scroll jumps unexpectedly.  
**Prevention:**
- Decide whether Hermes uses hash solely for routing or also for anchors; avoid mixing without a plan.
- Keep route generation centralized (single helper) to avoid inconsistent `#/path` shapes.
- Treat scroll behavior as a feature: either restore previous scroll on back, or always scroll-to-top on route change—pick one consistently.
**Detection:**
- Deep link matrix: open a fresh tab to each major area (Events, Profile/Login, Manager, Admin) and verify correct initial render + permissions.
- Back/forward matrix: navigate between areas and ensure state doesn’t reset unexpectedly.

### Pitfall 5: Mobile Safari + PWA “almost works” failures (especially around focus/viewport)
**What goes wrong:** Inputs are obscured by the keyboard, the app “zooms” unexpectedly, fixed headers overlap content, or tapping controls triggers unintended scroll.  
**Why it happens:** iOS Safari has special viewport behavior (`100vh` issues), keyboard resize quirks, and different default focus/scrolling semantics; PWA standalone mode differs again.  
**Consequences:** Users can’t enter login code comfortably, can’t reach primary actions, perceive the app as broken on phones.  
**Prevention:**
- Avoid naive `100vh`; prefer dynamic viewport units (`dvh/svh/lvh`) or layout that tolerates viewport changes.
- Ensure tap targets are large enough and spaced; avoid tiny icon-only actions without padding.
- Avoid “position: fixed” traps on critical flows unless tested on iOS Safari and PWA standalone.
**Detection:**
- iPhone Safari manual checks: login flow (OTP entry), event list scrolling, vote actions, manager/admin forms.
- PWA standalone check: same flows with “Add to Home Screen” style viewport (if applicable in your setup).

### Pitfall 6: Navigation polish breaks auth/session expectations
**What goes wrong:** Moving Profile/Login causes accidental logout, session switching becomes hidden, or privileged areas start showing “flash of unauthorized content” before redirect.  
**Why it happens:** UI route guards are implemented in components (post-render) instead of at route level; new layouts load data before role checks.  
**Consequences:** Confusing UX, potential data exposure in UI, or session management becomes hard to find during the LAN event.  
**Prevention:**
- Ensure access control remains enforced by the server, and avoid rendering privileged content until role/session state is resolved.
- Keep session management discoverable from both smartphone and PC (not buried behind hover-only UI).
**Detection:**
- Role matrix: normal user vs manager vs admin; verify each route is gated and has clear affordances to “go back”.

## Moderate Pitfalls

### Pitfall: Theme/contrast regressions when adjusting visual hierarchy
**What goes wrong:** New “status colors” or badges become unreadable in certain themes, or color becomes the only indicator of status.  
**Prevention:**
- Ensure sufficient contrast and pair color with text/iconography (e.g., “Ready”, “Running”, “Full” labels).
- Verify in both light/dark (or configured theme colors) and on mobile in bright light.

### Pitfall: Action affordances become less discoverable (especially on mobile)
**What goes wrong:** Replacing buttons with icons, hiding actions in overflow menus, or relying on hover tooltips.  
**Prevention:**
- Primary actions remain visible without hover; avoid burying “vote” behind menus.
- Keep destructive actions clearly separated and confirmable (cancel/archive).

### Pitfall: Skeleton/loading polish causes perceived slowness or layout shifts
**What goes wrong:** Added placeholders shift layout when content arrives, causing mis-taps (especially on phones).  
**Prevention:**
- Reserve stable space for key controls; minimize layout shift in event cards/rows.

## Minor Pitfalls

### Pitfall: Copy tweaks introduce ambiguity
**What goes wrong:** “Dabei”/“Nicht dabei” labels change meaning subtly, or status labels aren’t consistent across views.  
**Prevention:**
- Keep terminology consistent and map labels 1:1 to existing states.

### Pitfall: Over-animated UI harms clarity
**What goes wrong:** Animations make it harder to track real-time changes or cause nausea for some users.  
**Prevention:**
- Keep motion subtle; respect `prefers-reduced-motion`.

## Phase-Specific Warnings (v1.1 UX Polish)

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Clearer navigation between Events / Profile(Login) / Manager / Admin | Behavior drift via route remounts, broken deep links, confusing back button | Centralize route definitions; verify deep link + back/forward + role matrix |
| Better visualization of event status/capacity | Duplicated business rules, inconsistent derived state under SSE | Normalize data; derive status/capacity in one place; two-device sanity check |
| UX/a11y polish + responsive tweaks | Focus/keyboard traps, invisible focus, insufficient tap targets | Keyboard-only pass; screen reader spot check; iOS Safari manual flow checks |
| Hash routing quirks | Anchors vs routes collision; scroll restoration weirdness | Avoid mixing anchors with hash routes; define consistent scroll behavior |
| Mobile Safari/PWA | 100vh/keyboard issues; fixed headers overlap; standalone differences | Prefer dvh/svh; avoid fixed traps; test Safari + PWA mode for login/event flows |

## Sources

- `.planning/PROJECT.md` (Hermes v1.1 goal: polish without behavior change; smartphone focus; PWA/push constraints; hash routing context implied by SPA routing)
# Pitfalls Research

## Context

Hermes already has the release-critical surface in place, but the next milestone needs to reduce operational and security risk before more UI or deployment scope lands. The pitfalls below are grounded in `.planning/PROJECT.md`, `.planning/codebase/CONCERNS.md`, `.planning/codebase/TESTING.md`, `readme.md`, and `building.md`.

There is no `.planning/ROADMAP.md` in this checkout yet, so "roadmap phase" refers to the active next-milestone phase themes currently listed in `.planning/PROJECT.md`.

## Pitfall Matrix

| Pitfall | Warning Signs | Prevention Strategy | Roadmap Phase |
| --- | --- | --- | --- |
| Auth request abuse and user enumeration | `src/server/http/auth-routes.ts` returns distinct unknown-user behavior for login-code requests; repeated `/api/auth/request-code` or `/api/auth/verify-code` attempts are not rate-limited; `login_challenges` rows accumulate without cleanup; `HERMES_MAIL_MODE=console` is used outside local development. | Return less user-enumerating responses for code requests, add per-IP and per-username throttles, cap active login challenges, add expired challenge cleanup/indexes, and make production mail mode/checklist validation explicit. Add Supertest coverage for throttling and negative auth paths in `src/server/http/app-flow.test.ts` or focused route tests. | Harden authentication and invite registration against abuse. |
| Session token exposure and weak production cookie posture | `src/server/auth/sessions.ts` stores raw session tokens in SQLite; snapshots can contain live bearer tokens; `HERMES_COOKIE_SECURE=false` remains in production; role changes or restores leave old sessions usable longer than intended. | Hash session tokens at rest, define absolute/idle expiry semantics, rotate or revoke sessions after role/security-sensitive changes, require `HERMES_COOKIE_SECURE=true` in the production checklist, and consider CSRF protection for cookie-authenticated mutating routes such as `POST /api/admin/restore`. | Harden authentication and invite registration against abuse; prepare a production deployment checklist. |
| Invite brute force and reusable invite exposure | Public registration accepts invite attempts without throttling; short or human-chosen invite codes are easier to guess; `GET /api/admin/invite-codes` and audit metadata expose full invite code values to admin surfaces; invite create/revoke events can retain reusable secrets in `audit_logs`. | Enforce minimum generated entropy, throttle `/api/auth/register` by IP and code, redact or partially display invite values in audit metadata, expire/revoke codes by default after the LAN window, and document that invite codes are credentials. | Harden authentication and invite registration against abuse. |
| Invite max-use races | `src/server/http/auth-routes.ts` checks `invite_code_uses` count before inserting a use; concurrent registrations can both pass the `maxUses` check; soft-deleted users still consume invite uses through historical rows. | Move invite consumption into a transaction with an atomic count/update guard or enforce remaining-use constraints with database-level locking semantics appropriate for SQLite. Add a concurrent registration test that proves `maxUses` cannot be oversubscribed. Make soft-delete invite accounting an explicit product rule. | Improve data consistency for concurrent participation and invite usage. |
| Event capacity races during concurrent joins | `src/server/http/event-routes.ts` counts joined users before upserting participation; simultaneous `dabei` requests can overfill `maxPlayers`; integration coverage currently exercises capacity serially, not concurrently. | Protect capacity checks and participation writes with a transaction or constraint-backed strategy. Add a concurrent Supertest scenario that sends simultaneous join requests and verifies the event never exceeds capacity. | Improve data consistency for concurrent participation and invite usage. |
| S3 snapshot drift and false confidence in restore | `src/server/storage/s3-storage.ts` uploads whole SQLite snapshots after writes with debounce; upload errors are logged but not surfaced to admins; S3 may lag local SQLite after crashes or network failures; `readme.md` and `building.md` document S3 as snapshot storage, but the UI can still imply safety after a backup/restore action. | Surface last successful backup time and failures in admin UI, add explicit backup status checks before destructive restore, provide an operator recovery runbook, and keep the single-instance assumption visible near S3 settings. | Make backup/restore safer with pre-restore backup, restore validation, and clearer operator recovery flow. |
| Unsafe live restore mechanics | `src/server/storage/s3-storage.ts` disables foreign keys during restore and runs `PRAGMA foreign_key_check` without failing on returned violations; `INSERT INTO table SELECT *` depends on identical column order; `restorableTables` must be updated manually for new tables; `POST /api/admin/restore` is immediate and destructive. | Create a pre-restore local backup, validate snapshot schema/version before mutation, read and fail on `foreign_key_check` rows, restore by explicit column lists, test every restorable table, require typed confirmation for restore, and document how to roll back from the pre-restore backup. | Make backup/restore safer with pre-restore backup, restore validation, and clearer operator recovery flow. |
| Restore/session/audit ambiguity | `src/server/http/admin-routes.ts` writes restore audit entries after replacing live tables and omits `actor`; restoring `sessions` or `users` can invalidate the admin mid-request; old restored sessions may become active again. | Capture actor identity before restore, persist a post-restore audit entry reliably, define whether restored sessions are allowed or must be invalidated, and show the operator a post-restore verification checklist for users, events, settings, and current session state. | Make backup/restore safer with pre-restore backup, restore validation, and clearer operator recovery flow. |
| Migration drift between SQL, Drizzle schema, and snapshots | `src/server/db/migrate.ts` records only filenames and has no checksum or dirty-state marker; `src/server/db/schema.ts` and `src/server/db/migrations/*.sql` are manually aligned; live restore can import older table shapes after the app has migrated forward. | Add migration checksum/drift detection, create compatibility tests that boot from older snapshots and run restore against current code, and require restore validation to compare expected schema/table inventory before applying data. | Increase test coverage around restore and admin destructive actions; make backup/restore safer. |
| Push/PWA expectations exceeding browser reality | `readme.md` states Web Push needs secure context and that LAN HTTP addresses do not qualify; iOS/Android cannot reliably force custom notification sounds; `public/sw.js` assumes `event.data.json()` succeeds; `src/server/push/push-service.ts` keeps repeated non-404/410 failures active. | Put browser/OS limitations directly in-product near notification settings, validate malformed push payload handling in `public/sw.js`, mark repeated failed subscriptions stale, and document HTTPS/PWA setup in the deployment checklist. | Improve mobile/PWA notification reliability and document OS/browser limitations clearly in-product. |
| Realtime and push operational fragility | `src/server/realtime/event-bus.ts` keeps SSE clients in memory without heartbeat comments; proxies may close idle connections; shutdown can hang behind long-lived SSE connections before S3 flush; push sends fan out with `Promise.all` and limited failure isolation. | Add SSE heartbeats and shutdown timeout behavior, make reconnect behavior explicit in the client, batch or isolate push delivery failures, and include reverse-proxy timeout guidance in deployment docs. | Improve mobile/PWA notification reliability; prepare a production deployment checklist. |
| Monolithic frontend changes causing regressions | `src/main.tsx` combines routing, API client, events, login/profile, push settings, admin users, invites, audit logs, backup/restore, and theme behavior; `src/styles.css` is global; failed mutations require manual state refreshes across panels. | Split `src/main.tsx` by route/workspace and shared API/state helpers before adding more admin or notification UI. Keep extraction behavior-preserving and cover critical flows with existing Playwright labels from `e2e/hermes-flow.spec.ts`. | Split the large frontend monolith into smaller components or modules before further UI growth. |
| Admin destructive actions lacking focused tests | Current `src/server/http/app-flow.test.ts` covers the main happy path and backup endpoint, but not restore correctness, destructive confirmation behavior, audit failure isolation, CSRF posture, or admin negative paths; `src/server/storage/s3-storage.test.ts` only covers credential parsing. | Add focused route and storage tests for restore validation, pre-restore backup behavior, schema mismatch, foreign-key violations, session/device revocation, invite limits, push payload errors, and destructive admin authorization failures. Use dummy values only and avoid real S3/mail/push credentials. | Increase test coverage around restore, invite limits, session/device revocation, push payload handling, and admin destructive actions. |
| Deployment security gaps hidden by local defaults | `Dockerfile` runs the Node process as root; `.env.example` keeps local-friendly defaults such as `HERMES_COOKIE_SECURE=false`; `src/server/app.ts` does not set security headers; `docker-compose.yml` assumes S3 credentials are present; Hermes intentionally does not ship TLS while push requires secure context. | Produce a production checklist covering TLS/reverse proxy, secure cookies, SMTP mode, VAPID keys, S3 credential file handling, single-instance operation, non-root container runtime, security headers or proxy equivalents, backup verification, and secret rotation. | Prepare a production deployment checklist for TLS, secure cookies, SMTP, VAPID, S3 credentials, and single-instance operation. |
| Single-instance assumption violated in production | `readme.md` and `building.md` warn that S3 is not a locking backend, but there is no runtime guard against multiple containers using the same `HERMES_S3_DB_KEY`; concurrent writers can overwrite snapshots or restore stale data. | Add deployment documentation that forbids active/active replicas, consider a startup lock or instance identifier warning if S3 is enabled, and require operators to scale to exactly one writer. | Prepare a production deployment checklist; make backup/restore safer. |

## Phase Priorities

1. Address auth/invite throttling and concurrent invite/event consistency before public registration is relied on during the LAN event.
2. Address restore safety before operators are told S3 snapshots are a reliable recovery mechanism.
3. Extract `src/main.tsx` before adding more admin/PWA UX, because the admin surface already mixes backup, restore, invites, audit, settings, and theme controls.
4. Treat deployment documentation as part of security work, not a release afterthought, because TLS, secure cookies, SMTP, VAPID, S3 credentials, and single-instance operation are all operator-owned but app-critical.
