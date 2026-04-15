# Architecture Research

## Scope

This note covers architecture implications for the next Hermes milestone: authentication and invite hardening, profile/session/invite operations, safer backup and restore, and frontend maintainability. It is based on the current composition root in `src/server/app.ts`, the frontend entrypoint in `src/main.tsx`, and the codebase architecture notes under `.planning/codebase/`.

Hermes should remain a single-instance React/Vite, Express, SQLite, and optional S3 snapshot app for this milestone. The most useful architecture work is tightening existing boundaries and extracting small frontend modules, not introducing a broad service layer or a new state-management framework.

## Current Component Boundaries

`src/server/app.ts` is the server composition boundary. It restores the configured SQLite snapshot before opening the database, creates the `DatabaseContext`, runs migrations, mounts all API routers, schedules debounced snapshot uploads after non-read responses, runs the event status refresh interval, serves `dist/`, and exposes the shutdown hook.

The HTTP routers are the active server feature boundaries:

- `src/server/http/auth-routes.ts` owns login code requests, OTP verification, invite registration, current user lookup, logout, session listing, and session revocation.
- `src/server/http/admin-routes.ts` owns admin-only user management, invite code administration, settings, audit logs, backup, and restore.
- `src/server/http/event-routes.ts` owns event lifecycle and participation writes.
- `src/server/http/push-routes.ts` owns push subscription and notification preference APIs.
- `src/server/http/realtime-routes.ts` owns authenticated SSE event streams.

Pure or near-pure domain helpers live in `src/server/domain/events.ts` and `src/server/domain/users.ts`. Cross-cutting helpers live in `src/server/auth/*`, `src/server/settings.ts`, `src/server/audit-log.ts`, `src/server/push/push-service.ts`, `src/server/realtime/event-bus.ts`, and `src/server/storage/s3-storage.ts`.

The frontend boundary is currently weak: `src/main.tsx` contains API contracts, fetch helpers, route definitions, theme application, event UI, login/profile/session UI, invite registration, admin user/settings/invite/audit/backup/restore UI, push subscription logic, and the root app state. `src/styles.css` is similarly global. The next milestone should create focused modules around existing panels before adding more UI behavior.

## Data Flow For Hardening

Authentication currently flows from `src/main.tsx` to `/api/auth/request-code`, then email or console delivery in `src/server/mail/mailer.ts`, then `/api/auth/verify-code`, session creation in `src/server/auth/sessions.ts`, and current-user resolution through `src/server/auth/current-user.ts`.

Hardening should preserve that flow but insert controls close to the HTTP edge:

- Request validation and generic external responses should remain in `src/server/http/auth-routes.ts`.
- Rate-limit state can start as a small in-process helper or SQLite-backed table, depending on whether the first target is abuse reduction for one LAN instance or persistence across restarts. For the current single-instance app, an in-process limiter is simpler, but critical limits such as invite use counts and participation capacity should be enforced in SQLite transactions.
- OTP challenge cleanup and lookup efficiency belong near the login challenge table and auth route implementation, not in the mailer.
- Session revocation and profile/device operations should remain cookie-session based and use `src/server/auth/current-user.ts` for identity resolution. Role changes and soft-deletes should explicitly revoke or invalidate affected sessions if the milestone chooses that behavior.
- Audit events for auth hardening should be written through `src/server/audit-log.ts`, but metadata must not include OTP values, raw session tokens, invite code secrets, or credential values.

External login responses should become less user-enumerating while preserving useful internal audit detail. The server can return the same success-shaped response for unknown users and real users on login-code request, while recording a redacted audit entry for investigation.

## Data Flow For Invite And Profile Operations

Invite registration currently crosses `src/main.tsx`, `/api/auth/register`, invite code rows, user creation, invite use rows, session creation, settings-controlled public registration, and audit logs. Admin invite management flows through `src/server/http/admin-routes.ts`.

For concurrency safety, invite consumption should move from "read uses, compare count, insert use" into a transaction in `src/server/http/auth-routes.ts` or a small invite-domain helper called by that route. The transaction should read the invite row, verify expiry/revocation, enforce `maxUses`, create the user, insert `invite_code_uses`, and create the session as one unit where practical. If SQLite locking or uniqueness constraints raise a conflict, the API should return an existing public error code such as `invite_ausgeschoepft` or `user_existiert_bereits`.

Admin invite listing in `src/server/http/admin-routes.ts` should distinguish operational display from secret disclosure. The UI in `src/main.tsx` currently expects full code values through the `InviteCode` type. A safer next step is to keep code creation response display explicit, but avoid repeatedly exposing reusable code secrets in audit metadata and list responses unless the product requires copy-after-create behavior.

Profile and device operations should stay under `/api/auth` unless they become admin operations. `GET /api/auth/me`, session list, session revoke, notification preference, and profile details are all user-owned account concerns. Admin user changes belong in `/api/admin/users`. The frontend should separate these into a profile/session module instead of growing `LoginPanel()` further inside `src/main.tsx`.

## Data Flow For Safer Backup And Restore

Backup and restore currently flow from admin UI in `src/main.tsx` to `src/server/http/admin-routes.ts`, then into `src/server/storage/s3-storage.ts`. Startup restore is called earlier from `src/server/app.ts` before migrations and normal route mounting.

The restore path should become a staged operator flow:

1. Admin requests restore validation or restore preview from `/api/admin`.
2. Server downloads the configured snapshot through `src/server/storage/s3-storage.ts`.
3. Server validates schema compatibility, expected tables, and `PRAGMA foreign_key_check` result rows before touching live data.
4. Server writes a pre-restore local or S3 backup of the current live database.
5. Server performs the live restore in a bounded transaction or clearly documented critical section.
6. Server invalidates or refreshes state that may have been replaced, including sessions, settings, and event broadcasts.
7. Server returns a recovery summary with backup identifier, validation result, and next operator checks.

`src/server/storage/s3-storage.ts` is still the right low-level module for snapshot IO and table copying, but restore policy should not be hidden entirely there. `src/server/http/admin-routes.ts` owns the admin operation and should coordinate confirmation, audit logging, and response shape. If the code grows, introduce a narrow `src/server/storage/restore-service.ts` rather than a general application service layer.

Restore must not depend on identical column order long-term. The current `INSERT INTO table SELECT * FROM sourceTable` approach is fragile across migrations. A safer helper should derive column names from `PRAGMA table_info` for each restorable table and copy only compatible columns, or reject incompatible snapshots with an explicit validation error before mutation.

Because `src/server/app.ts` schedules snapshots after successful non-read responses, restore endpoints need special care. A failed restore validation should not schedule a new snapshot. A successful restore should either flush the restored database intentionally or defer upload until after validation, audit logging, and any session invalidation decisions are complete.

## Frontend Maintainability Boundary

The frontend should be split along the panels and shared utilities that already exist conceptually in `src/main.tsx`:

- API helper and shared DTO types: extract `requestJson()`, error handling, and API payload types into a small module such as `src/client/api.ts` or `src/client/types.ts`.
- App shell and routing: keep hash-route state, settings loading, theme application, and role-aware navigation in an app-level module.
- Event board: move event list, event creation, participation, and SSE/polling behavior out of the root file.
- Auth/profile: move login, invite registration, current session/device management, logout, and push setup into a focused module.
- Admin: move user management, settings, invite code management, audit log, backup, and restore UI into smaller admin subcomponents.

This should be an extraction-first change. Preserve current behavior and fetch-after-mutation semantics before changing workflows. The app currently treats server responses as the source of truth; adding a cache, client state library, or generated API client is not required for the current size and would raise migration risk.

The frontend should not treat role-gated visibility as authorization. Backend checks in `src/server/http/*` remain the security boundary. Extracted components should continue to handle `401` and `403` responses predictably because session restore, admin restore, and role changes can invalidate the current UI state.

## Build Order Implications

Build order should reduce blast radius before adding behavior.

1. Add focused tests around existing risks before refactors: auth generic responses, rate-limit behavior, invite max-use concurrency, participation capacity concurrency, restore validation, pre-restore backup, and session revocation. Existing HTTP integration tests in `src/server/http/app-flow.test.ts` are the natural first target.
2. Harden server invariants before frontend affordances. Concurrency and destructive restore safety must be enforced in `src/server/http/auth-routes.ts`, `src/server/http/event-routes.ts`, `src/server/http/admin-routes.ts`, `src/server/storage/s3-storage.ts`, and SQLite transactions, not only by UI confirmations.
3. Extract frontend utilities and panels from `src/main.tsx` with no behavior change. This lowers merge risk for profile, invite, and restore UI additions.
4. Add profile/session/invite UI changes after the API contracts are stable. This avoids reshaping UI types repeatedly.
5. Add clearer operator restore flow last, once server validation and backup identifiers exist. The UI can then present real validation and recovery data rather than frontend-only confirmation text.
6. Update deployment and recovery docs after behavior is implemented, especially around secure cookies, SMTP mode, VAPID, S3 credentials, TLS/reverse proxy, and single-instance operation.

Server hardening and frontend extraction can proceed in parallel if write ownership is separated: server workers should avoid `src/main.tsx`, and frontend workers should avoid modifying router behavior except for response handling already agreed in API contracts.

## Fragile Integration Points

`src/server/app.ts` couples mutating HTTP responses to S3 snapshot scheduling. New endpoints that validate, preview, or partially fail must be intentional about response codes and whether a snapshot should follow.

`src/server/storage/s3-storage.ts` depends on SQLite WAL checkpointing, a fixed restorable table list, and compatible table shapes. Restore changes must account for migrations in `src/server/db/migrations/` and schema definitions in `src/server/db/schema.ts`.

`src/server/http/auth-routes.ts` currently owns both login and invite registration. It is the right place to enforce public auth behavior, but it can become overloaded if profile, invite, session, and limiter logic all stay inline. Extract small helpers only when the route becomes hard to test.

`src/server/http/event-routes.ts` capacity checks are vulnerable to concurrent writes. Fixing invite concurrency should use the same transaction discipline that will later apply to participation.

`src/server/auth/current-user.ts` updates `lastSeenAt` during authenticated requests. Adding rate limits, CSRF checks, restore invalidation, or session expiry must consider that reads can already cause writes.

`src/server/audit-log.ts` is useful for operator visibility but can leak sensitive operational material if callers pass raw metadata. Hardening work should define redacted audit metadata shapes for auth, invite, backup, and restore operations.

`src/main.tsx` duplicates API DTOs and user-facing error codes. If server responses are made more generic or restore endpoints gain staged states, the extracted client API layer should centralize those mappings.

`public/sw.js` and browser push behavior depend on secure-context and OS/browser rules outside the app. Frontend maintainability work can improve messaging, but it cannot make LAN HTTP push reliable without deployment TLS.

## What Not To Over-Abstract Yet

Do not introduce a full service/repository architecture across all routers. The codebase is small, and broad rewrites would add risk before the LAN-party release. Prefer narrow helpers for rate limiting, invite consumption, restore validation, and frontend API calls.

Do not add Redux, React Query, a router package, or generated API clients as a prerequisite for this milestone. The immediate frontend need is file/component separation and shared API typing, not a new client architecture.

Do not turn S3 into a coordination backend. `src/server/storage/s3-storage.ts` should remain snapshot storage for a single active writer. Multi-instance safety is out of scope and requires a different persistence or locking design.

Do not over-generalize audit metadata redaction into a complex policy engine yet. Start with explicit safe metadata in the auth, invite, backup, and restore call sites.

Do not build a generic workflow engine for restore. A small staged restore operation with validation, pre-restore backup, audit, and recovery summary is enough.

Do not rely on frontend confirmations or disabled buttons as safety controls. Destructive admin behavior must be safe at the server and storage layer even if a request is sent manually.

## Suggested Architecture Outcomes

After the milestone, Hermes should still feel like the same app architecturally, but with sharper boundaries:

- Auth and invite endpoints return less enumerating public responses and enforce abuse controls at the HTTP/database boundary.
- Invite and participation limits are protected by SQLite transactions or constraints rather than read-then-write checks.
- Restore validates snapshots, creates a pre-restore backup, checks foreign keys, and returns operator recovery information before scheduling any follow-up snapshot.
- `src/main.tsx` is reduced to app composition, with panel components and API helpers moved into frontend modules.
- Audit entries remain useful but avoid storing reusable secrets, OTPs, raw session tokens, or credential values.
- Documentation matches the real deployment contract: one active writer, TLS/reverse proxy outside Hermes, secure cookies enabled in production, SMTP and VAPID configured explicitly, and S3 used only for snapshots.
