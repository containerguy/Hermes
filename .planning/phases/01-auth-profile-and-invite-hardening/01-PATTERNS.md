# Phase 1 Pattern Mapping: Auth, Profile, And Invite Hardening

## PATTERN MAPPING COMPLETE

This mapping is for planning and implementation prompts. It identifies where Phase 1 should extend existing Hermes code, which local patterns to preserve, and how data should move through the current Express/SQLite/React architecture.

## Existing System Shape

- Server routes are split by product area under `src/server/http/` and are built with `express.Router()`.
- Route input validation uses Zod schemas near the top of each route file.
- Route handlers return compact JSON wrappers such as `{ user }`, `{ sessions }`, `{ inviteCodes }`, `{ settings }`, and `{ error }`.
- Multi-step writes use `context.sqlite.transaction(() => { ... })()`.
- Database structure is defined twice: Drizzle schema in `src/server/db/schema.ts` and SQL migrations in `src/server/db/migrations/*.sql`.
- Auth state is cookie-based through `SESSION_COOKIE` in `src/server/auth/sessions.ts`.
- Current-user lookup is centralized in `getCurrentSession()` and role checks are built from `requireUser()` / `requireAdmin()`.
- Audit entries are explicit route-side calls to `writeAuditLog()` and admin reads use `listAuditLogs()`.
- Frontend calls go through the shared `requestJson()` helper in `src/main.tsx`.
- API integration tests use Supertest agents, temporary SQLite files, `bootstrapAdmin()`, and `HERMES_DEV_LOGIN_CODE`.

## Files To Modify Or Create

### `src/server/http/auth-routes.ts`

Role: Existing auth and current-user route module. Extend it for generic login responses, challenge superseding/cleanup, throttling hooks, profile self-service, email-change confirmation, session rename, session-token hashing integration, and CSRF checks on authenticated mutations.

Closest analog: Existing handlers in this file:

- `router.post("/request-code", ...)` validates `requestCodeSchema`, finds active user by username, calls `issueLoginChallenge()`, sends mail, and returns `202`.
- `router.post("/verify-code", ...)` verifies the newest challenge, inserts a session, audits `auth.login`, and sets the cookie.
- `router.post("/register", ...)` validates invite registration, inserts user plus invite use in a SQLite transaction, sends a login code, and audits `auth.register`.
- `router.get("/sessions", ...)`, `router.delete("/sessions/:id", ...)`, and `router.post("/logout", ...)` show the current current-user/session ownership pattern.

Patterns to follow:

- Keep Zod schemas next to related route logic.
- Return early after every error response.
- Use German machine-readable error codes.
- Keep success payloads small and stable.
- Use transactions when mutating a challenge/session/user plus related rows.
- Do not expose whether a username exists from `/api/auth/request-code`; return the same success-shaped `202` for known and unknown usernames.
- Keep `sendIssuedLoginCode()` as the mail-sending boundary, but ensure audit/rate-limit writes cannot expose existence through status or timing-sensitive details.

Data flow and integration notes:

- `issueLoginChallenge()` should supersede older unconsumed challenges for the same username before inserting the new one.
- Challenge cleanup can run opportunistically at request-code and verify-code entry points.
- Unknown username login-code attempts should not create a login challenge or send mail; they should create redacted admin/audit visibility via the audit-safe helper described below.
- `/api/auth/verify-code` should call rate-limit checks before expensive lookup/verification and record failed attempts after rejected codes.
- Session creation should stop using the raw cookie token as `sessions.id`. Store an opaque session id plus token hash, or store a `tokenHash` column and use that for lookup. Coordinate with `current-user.ts`, `sessions.ts`, push session references, logout, revoke, and tests.
- Add current-user routes here, likely:
  - `PATCH /api/auth/profile` for display-name updates.
  - `POST /api/auth/email-change` to request a confirmation code to the new email.
  - `POST /api/auth/email-change/verify` to confirm and activate the new email.
  - `PATCH /api/auth/sessions/:id` to rename the user's own device/session.
- Mutating authenticated routes in this file should participate in the selected CSRF design. Public unauthenticated endpoints may be exempt if that is the chosen implementation.

### `src/server/http/admin-routes.ts`

Role: Existing admin route module. Extend it for active email uniqueness checks, display-name/admin email updates, role-change session revocation, invite lifecycle actions, rate-limit admin operations, safer invite audit metadata, and CSRF checks on admin mutations.

Closest analog: Existing handlers in this file:

- `router.use(...)` enforces admin access through `requireUser()` and role check.
- `router.post("/users", ...)` creates users with optional legacy `phoneNumber`, fallback phone number, default notification setting, and `user.create` audit entry.
- `router.patch("/users/:id", ...)` performs generic user updates and audits `user.update`.
- `router.delete("/users/:id", ...)` soft-deletes users, deletes participations, revokes push subscriptions and sessions in a transaction, then audits `user.delete`.
- `router.get("/invite-codes", ...)` serializes invites through `serializeInviteCode()`.
- `router.post("/invite-codes", ...)` generates or normalizes a code, inserts it, and audits `invite.create`.
- `router.delete("/invite-codes/:id", ...)` currently deactivates by setting `revokedAt` and audits `invite.revoke`.

Patterns to follow:

- Keep admin-only routes in this router unless they belong to current-user self-service.
- Use `requireAdmin()` inside handlers when the actor is needed for audit metadata.
- Use `serializeInviteCode()` as the central place for API invite shape, including `usedCount`.
- Preserve full invite code visibility in the admin API/UI per context decision D-15, but never write full invite codes to audit metadata.
- Keep user deletion soft-delete/anonymization behavior and never allow deleting the current admin account.

Data flow and integration notes:

- Add explicit active-email checks before admin user create/update so duplicate active email failures are stable and not only SQLite conflicts.
- Extend user schemas for `displayName`.
- If role or admin-driven email changes occur, revoke the affected user's sessions in the same route flow after the successful update. Display-name-only updates should not revoke sessions.
- Add invite lifecycle endpoints:
  - `PATCH /api/admin/invite-codes/:id` for `label`, `maxUses`, `expiresAt`.
  - `POST /api/admin/invite-codes/:id/deactivate` to set `revokedAt`.
  - `POST /api/admin/invite-codes/:id/reactivate` to clear `revokedAt` only if the invite is otherwise valid.
  - `DELETE /api/admin/invite-codes/:id` to hard-delete only if `usedCount` is zero; otherwise return a conflict or require deactivation.
- Existing `DELETE /api/admin/invite-codes/:id` behavior is only revoke/deactivate. Rename or preserve with compatibility consciously; frontend and tests must match.
- Add admin rate-limit operations under a small route group such as `/api/admin/rate-limits`: list active blocks, clear one block, and manage allowlist entries.
- Include CSRF enforcement for all mutating admin routes once the middleware/helper exists.

### `src/server/auth/sessions.ts`

Role: Session cookie and token helper module. Extend it to support token hashing and possibly session id generation.

Closest analog: Existing functions:

- `createSessionToken()` generates a random base64url bearer token.
- `setSessionCookie()` writes `hermes_session` with `httpOnly`, `sameSite: "lax"`, optional `secure`, max age, and path.
- `clearSessionCookie()` clears the same cookie settings.

Patterns to follow:

- Keep cookie name and cookie option behavior centralized here.
- Keep generated raw tokens high entropy and only return them to the caller for the cookie.
- Do not add a heavy dependency; use Node crypto.

Data flow and integration notes:

- Add `hashSessionToken(rawToken)` using SHA-256 or HMAC-SHA-256 if a secret is introduced.
- If `sessions.id` becomes an opaque DB id, add a `createSessionId()` helper and keep raw token separate from persisted id.
- Update `auth-routes.ts` login/logout/revoke, `current-user.ts`, `push-routes.ts` if it references current session ids, and schema/migration together.
- If legacy sessions cannot be safely migrated, mark them revoked through a migration or startup compatibility path and require users to log in again.

### `src/server/auth/current-user.ts`

Role: Current session lookup and public user serialization. Modify it for hashed token lookup and display-name API shape.

Closest analog: Existing functions:

- `publicUser()` currently returns `id`, `phoneNumber`, `username`, `email`, `role`, `notificationsEnabled`, and `deletedAt`.
- `getCurrentSession()` reads the cookie token, joins `sessions` to `users`, ignores revoked sessions, rejects deleted users, updates `lastSeenAt`, and returns `{ session, user }`.
- `requireUser()` and `requireAdmin()` wrap `getCurrentSession()`.

Patterns to follow:

- Keep all current-user authorization helpers here.
- Keep deleted users unusable even if a stale session row exists.
- Keep `lastSeenAt` update in the successful current-session path.

Data flow and integration notes:

- Replace `eq(sessions.id, token)` with lookup by `sessions.tokenHash` or by the chosen hashed-token storage field.
- Include `displayName` in `publicUser()` once added to users.
- If session ids become non-secret, route-visible session ids in `/api/auth/sessions` remain okay; the raw cookie token must never be returned.
- If CSRF tokens are tied to session id or token hash, this module may provide the authenticated session material used by CSRF validation.

### `src/server/db/schema.ts`

Role: Drizzle table definitions. Add Phase 1 fields/tables/indexes to match migrations.

Closest analog: Existing tables:

- `users` defines identity, role, notifications, soft-delete, and unique indexes.
- `loginChallenges` stores OTP challenges with identity data and timestamps.
- `sessions` stores session rows and currently uses raw session token as primary key.
- `inviteCodes` and `inviteCodeUses` store invite data and usage accounting.
- `auditLogs` stores admin-visible action history.

Patterns to follow:

- Keep names aligned with existing snake_case SQL columns and camelCase Drizzle fields.
- Use Drizzle `index()` / `uniqueIndex()` for lookup-heavy paths.
- Prefer additive changes for Phase 1 to avoid table rebuild complexity in SQLite.

Data flow and integration notes:

- Add `users.displayName` as `display_name`, likely not null with migration default to username.
- Add `emailChangeChallenges` table with `id`, `userId`, `newEmail`, `codeHash`, `expiresAt`, `consumedAt`, `createdAt`, and optional `sentAt`.
- Add persisted rate-limit tables, for example `rateLimitEntries` and `rateLimitAllowlist`.
- Add `sessions.tokenHash` unique/indexed if preserving `sessions.id`; or redefine semantics carefully if `sessions.id` becomes opaque. Coordinate with migration and push subscription foreign key references.
- Add login challenge indexes by username/consumed/expiry/created and expiry cleanup.
- Add email-change and rate-limit indexes for the selected lookup patterns.

### `src/server/db/migrations/0005_auth_profile_invite_hardening.sql`

Role: New SQL migration for Phase 1 schema changes. Create it instead of editing existing migration files.

Closest analog: Existing migrations:

- `0001_initial.sql` creates base users, challenges, sessions, push subscriptions, events, participations, and settings.
- `0002_unique_username.sql` adds username uniqueness.
- `0003_audit_logs.sql` creates audit table and indexes.
- `0004_invites_and_deleted_users.sql` adds `deleted_at`, invite tables, and invite indexes.

Patterns to follow:

- Use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and additive `ALTER TABLE ... ADD COLUMN` where possible.
- Preserve existing data and avoid destructive table rebuilds unless a plan explicitly covers all affected foreign keys.
- Keep migration id sequential after `0004`.

Data flow and integration notes:

- Add `display_name` to `users` and backfill from `username`.
- Add `token_hash` to `sessions` and index it. If raw legacy session rows are invalidated, update `revoked_at` for rows missing a hash or handle with code after migration.
- Create `email_change_challenges`.
- Create persisted rate-limit tables.
- Add login challenge indexes.
- If invite code entropy changes only affects future generation, no migration is needed for existing codes.

### `src/server/audit-log.ts`

Role: Audit write/read helper. Harden it so route-level audit failures and metadata redaction are consistent.

Closest analog: Existing functions:

- `writeAuditLog()` inserts one audit row with actor id/name, action, entity, summary, JSON metadata, and timestamp.
- `listAuditLogs()` orders by newest first, clamps the limit to 1..500, and parses JSON metadata.

Patterns to follow:

- Keep the simple route-facing audit input shape unless a helper wrapper makes route code simpler.
- Keep list limit clamping.
- Keep audit metadata JSON serializable and sparse.

Data flow and integration notes:

- Add an audit-safe wrapper such as `tryWriteAuditLog()` or make `writeAuditLog()` catch and log internally, matching D-27 that audit failures must not block primary actions.
- Add small metadata helpers such as `maskEmail()` and `maskInviteCode()` or a generic redaction helper used by auth/admin routes.
- Stop storing full invite codes in `invite.create` / `invite.revoke` metadata. Existing `admin-routes.ts` currently writes `metadata: { code }` and `metadata: { code: invite.code }`; those should become masked or id/label-only.
- Avoid logging OTPs, raw session tokens, and full invite codes.

### New `src/server/auth/rate-limits.ts` Or `src/server/security/rate-limits.ts`

Role: Persisted rate-limit domain helper for auth and invite flows plus admin operations.

Closest analog: No direct existing module. Closest local patterns are:

- `src/server/settings.ts` for database-backed app configuration helpers.
- `src/server/audit-log.ts` for small database-backed infrastructure helpers.
- Route modules that call helper functions with `DatabaseContext`.

Patterns to follow:

- Keep functions small and synchronous where possible because current SQLite operations are synchronous.
- Accept `DatabaseContext` explicitly.
- Return route-friendly outcomes such as `{ allowed: true }` or `{ allowed: false, retryAfterSeconds }`.
- Store redacted/normalized keys, not raw secrets.

Data flow and integration notes:

- Use scopes such as `login_request`, `login_verify`, and `invite_register`.
- Use keys based on normalized username, source IP, and normalized invite code where appropriate.
- Add allowlist checks before blocking LAN-trusted IPs.
- Expose admin-facing list/clear/allowlist helpers to `admin-routes.ts`.
- Make tests deterministic by keeping thresholds configurable inside this module or via constants that tests can hit intentionally.

### New `src/server/auth/csrf.ts` Or `src/server/security/csrf.ts`

Role: CSRF token generation and verification for mutating cookie-authenticated requests.

Closest analog: No direct existing module. Closest integration points are:

- `setSessionCookie()` / `clearSessionCookie()` for cookie concerns.
- `getCurrentSession()` for authenticated request context.
- Express router-level `router.use(...)` in `admin-routes.ts`.

Patterns to follow:

- Keep CSRF concerns explicit and centrally reusable rather than duplicating checks in every handler.
- Prefer a small helper/middleware that can be applied to authenticated mutating route groups.
- Use German error code such as `csrf_token_ungueltig`.

Data flow and integration notes:

- Public unauthenticated auth routes can be exempt if the implemented decision documents that scope.
- Add a bootstrapping endpoint such as `GET /api/auth/csrf` or use a readable token cookie. The frontend `requestJson()` then sends `X-Hermes-CSRF` or similar for non-GET methods.
- Tests need one missing-token failure and one valid-token success for an admin mutation and current-user mutation.

### New `src/server/auth/device-names.ts`

Role: Default session/device name derivation from submitted device name and user agent.

Closest analog: No direct module. Closest current code is inline logic in `verify-code` that stores `parsed.data.deviceName ?? null`.

Patterns to follow:

- Keep the helper dependency-free and deterministic.
- Accept optional submitted name plus optional user agent.
- Trim and cap names consistently with route validation.

Data flow and integration notes:

- `verify-code` should store submitted non-empty device name first; otherwise derive `Windows-PC`, `iPhone`, `Android-Smartphone`, `Mac`, `Linux-PC`, `Smartphone`, `PC`, or `Unbekanntes Gerät`.
- `PATCH /api/auth/sessions/:id` should validate and store user-provided names for sessions owned by the current user.
- Frontend session list can continue displaying `session.deviceName || "Unbenanntes Gerät"`, but with fallback generation it should usually receive a useful name.

### New `src/server/users/email-uniqueness.ts` Or `src/server/domain/users.ts` Extension

Role: Shared active-email uniqueness validation for admin create/update, invite registration, and profile email-change request/verify.

Closest analog:

- `src/server/domain/users.ts` already owns `userRoleSchema`, used by `admin-routes.ts`.
- `fallbackPhoneNumber()` duplicated in auth/admin route files shows user identity helpers are currently local and could remain local unless extracted.

Patterns to follow:

- Keep domain validation reusable but not over-abstracted.
- Return stable route-level error decisions rather than throwing SQLite conflict exceptions for expected duplicate-email cases.

Data flow and integration notes:

- Check `users.email` with `deletedAt IS NULL`.
- Exclude the current user when validating self-service email-change if they enter the current email.
- Re-check uniqueness during email-change verification, not only during request, to prevent races.
- Keep existing DB unique index as final protection.

### `src/main.tsx`

Role: Existing React monolith. Extend minimally for Phase 1 UI behavior; avoid broad component extraction that belongs to Phase 5.

Closest analog: Existing client patterns:

- `requestJson()` is the single fetch wrapper with `credentials: "include"` and JSON error handling.
- `errorMessages` maps backend error codes to German user-facing copy.
- `LoginPanel()` owns login, invite registration, current profile, notification actions, session list, logout, and session revocation.
- `AdminPanel()` owns user CRUD, settings/theme, invite create/revoke, audit log, backup, and restore.
- `loadAdminData()` fetches users, settings, audit logs, and invite codes together.
- `displayRoute` already relabels login to profile when a user is signed in.

Patterns to follow:

- Keep additions in existing panels for Phase 1; do not extract modules yet.
- Use existing `busy`, `message`, `error`, and `load...()` state patterns.
- Use `requestJson()` for all API calls.
- Add German error messages for every new backend error code.
- Keep forms responsive by reusing existing classes like `admin-form`, `action-row`, `device-list`, `invite-list`, and `audit-list`.

Data flow and integration notes:

- Add CSRF header behavior centrally in `requestJson()` for mutating methods, with a small token bootstrap/cache.
- Add `displayName` to `User` type and render it in profile/admin lists while preserving username as login identity.
- Add profile display-name update and email-change request/verify controls inside the current logged-in branch of `LoginPanel()`.
- Add session rename UI beside current device revoke controls.
- Add invite edit/deactivate/reactivate/delete UI in `AdminPanel()` while keeping full invite code visible to admins.
- Add rate-limit operations UI under `AdminPanel()` if the plan includes the admin rate-limit view in this phase.
- Update registration defaults/copy if invite code defaults change to 300 uses and 30-day expiry in admin creation.

### `src/server/http/app-flow.test.ts`

Role: Existing end-to-end API integration test file. Extend it or split into sibling tests for Phase 1 coverage.

Closest analog: Existing test patterns:

- `beforeEach()` creates a temp SQLite database, sets env vars, runs `bootstrapAdmin()`, and starts `createHermesApp()`.
- `afterEach()` closes the app and removes SQLite/WAL/SHM files.
- `login(agent, username)` requests a code and verifies with `HERMES_DEV_LOGIN_CODE`.
- Supertest agents preserve session cookies across calls.
- Current test already covers admin user creation, fallback phone number, settings update, invite registration, session revoke, user delete, event participation, and audit log visibility.

Patterns to follow:

- Keep API tests route-level and behavior-oriented.
- Use existing `HERMES_DEV_LOGIN_CODE = "123456"` for deterministic OTP flows.
- Use Supertest agents to verify session invalidation and CSRF behavior.
- Add small helper functions only if repeated setup gets noisy.

Data flow and integration notes:

- Update expected unknown-user request-code behavior from current `404` to generic `202`.
- Add tests for same outward request-code shape for known and unknown usernames.
- Add rate-limit tests for request-code and verify-code using thresholds selected in the rate-limit helper.
- Add test that a second login code supersedes the first code.
- Add test that raw cookie token is not a reusable `sessions.id`/persisted lookup value.
- Add tests that role change and admin email change revoke affected sessions.
- Add tests for duplicate active email in admin create, invite registration, and profile email change.
- Add tests for display-name update, email-change confirm, default device name, and session rename.
- Add tests for invite edit, deactivate, reactivate, unused hard-delete, and used delete conflict/deactivation behavior.
- Add CSRF missing/valid token tests once CSRF is implemented.

## Cross-Cutting Data Flow

### Login-code request

1. Frontend `LoginPanel.requestCode()` calls `requestJson("/api/auth/request-code", { method: "POST" })`.
2. `auth-routes.ts` validates username with `requestCodeSchema`.
3. Rate-limit helper checks source IP and normalized username.
4. Route finds active user if present.
5. Unknown user path writes redacted audit/admin visibility and returns `202 { ok: true }`.
6. Known user path supersedes older open challenges, inserts a new challenge, sends mail, records sent timestamp, and returns the same `202 { ok: true }`.

### Login-code verification and session creation

1. Frontend calls `/api/auth/verify-code` with username, code, and optional device name.
2. Rate-limit helper checks source IP and normalized username.
3. Route loads newest unconsumed, unexpired challenge.
4. Failed verification records rate-limit failure and returns `401 code_abgelehnt` unless throttled.
5. Successful verification consumes the challenge, derives/stores device name, creates a non-reusable persisted session record, audits `auth.login`, and sets the raw cookie token.
6. `getCurrentSession()` resolves future requests through token hash, not raw token.

### Current-user profile and email change

1. Frontend profile area calls current-user routes under `/api/auth`.
2. `getCurrentSession()` authenticates the cookie.
3. Display-name update validates, writes `users.displayName`, audits `user.profile_update`, and returns `publicUser()`.
4. Email-change request validates active uniqueness, creates an email-change challenge, sends code to new email, and leaves login email unchanged.
5. Email-change verify re-checks uniqueness, consumes the challenge, updates `users.email`, audits, and revokes sessions according to the Phase 1 decision.

### Admin user changes

1. `AdminPanel` calls `/api/admin/users` routes through `requestJson()`.
2. Admin router middleware authenticates admin role.
3. Create/update routes perform explicit active-email uniqueness checks.
4. Role or admin email changes update the user and revoke affected sessions.
5. Audit metadata avoids unnecessary PII; admin-driven email changes remain auditable.

### Invite lifecycle

1. `AdminPanel` loads full invite code data through `GET /api/admin/invite-codes`.
2. Admin create uses stronger generated code defaults if no custom code is supplied.
3. Admin edit/deactivate/reactivate/delete routes validate current usage through `serializeInviteCode()` or a shared used-count helper.
4. Public registration normalizes invite code, rate-limits attempts, validates registration setting/invite state, checks active email uniqueness, and inserts user plus invite use in a transaction.
5. Audit entries use invite id/label/masked code, never full code.

### CSRF

1. Frontend gets or reads a CSRF token after session establishment.
2. `requestJson()` includes the token header on mutating methods.
3. Server CSRF middleware validates authenticated mutating requests before handlers perform writes.
4. Tests cover missing-token rejection and valid-token success.

## Planning Boundaries

- Do not implement event capacity concurrency in Phase 1; that is Phase 2.
- Do not implement backup/restore safety changes in Phase 1; that is Phase 3.
- Do not perform broad frontend extraction in Phase 1; keep UI edits local to `src/main.tsx`.
- Do not introduce native push sounds or mobile app behavior; Phase 4 covers honest PWA limitations.
- Preserve Docker/S3/operator docs work for Phase 6 unless a code change introduces an unavoidable env variable.
