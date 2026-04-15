# Phase 1 Research: Auth, Profile, And Invite Hardening

## RESEARCH COMPLETE

This research is scoped to Phase 1 planning. It identifies what the planner needs to know before splitting the phase into executable implementation prompts for auth abuse controls, profile/device changes, invite lifecycle hardening, migrations, and focused tests.

## Phase summary

Phase 1 hardens the existing username plus email OTP authentication, current-user profile/device flows, and public invite registration. The phase should preserve the current single-instance Express/SQLite/React architecture and avoid broad frontend modularization work that belongs to Phase 5.

Required outcomes:

- Login-code requests no longer reveal whether a username exists.
- Login-code request, OTP verification, and public invite registration flows have practical throttling for a 25-person LAN deployment.
- Login challenge cleanup and indexing prevent unbounded challenge growth.
- Session tokens are not persisted as directly reusable bearer tokens in SQLite or S3 snapshots.
- Role, deletion, and admin-driven email changes revoke affected sessions predictably.
- Mutating cookie-authenticated routes use an explicit CSRF design or a documented accepted risk; Phase 1 context selects CSRF token implementation.
- Active email uniqueness is enforced across admin user creation/update, invite registration, and self-service profile email changes.
- Users can manage display name, confirmed email change, and device names.
- Invite codes have documented entropy, reduced secret exposure in audit metadata, and admin lifecycle actions for deactivate/reactivate/edit/delete where safe.

## Existing code touchpoints

- `src/server/http/auth-routes.ts`
  - `POST /api/auth/request-code` currently returns `404 user_nicht_gefunden` for unknown usernames and has no throttling.
  - `issueLoginChallenge()` inserts challenges but does not invalidate older open challenges for the same username.
  - `POST /api/auth/verify-code` selects the newest unconsumed, unexpired challenge and creates a session with the raw cookie token as `sessions.id`.
  - `POST /api/auth/register` validates public registration and invite state, then inserts user and invite use in a transaction, but invite max-use counting is read-before-write and Phase 2 owns atomic max-use enforcement.
  - `GET /api/auth/me`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, and `POST /api/auth/logout` are the natural home for current-user profile/session additions.
- `src/server/http/admin-routes.ts`
  - Admin user create/update/delete routes already support email, role changes, soft-delete anonymization, push/session revocation on delete, and audit logging.
  - Admin invite routes currently support list, create, and `DELETE` as revoke/deactivate only.
  - `GET /api/admin/audit-log` should be kept stable, but limit parsing and metadata redaction should be hardened.
  - A rate-limit operations view can live under `/api/admin/rate-limits` or similar and remain admin-only.
- `src/server/auth/sessions.ts`
  - Defines `SESSION_COOKIE`, token generation, cookie set/clear behavior, and secure-cookie env behavior.
  - Needs token hashing helpers and possibly session ID/token lookup separation.
- `src/server/auth/current-user.ts`
  - Resolves current session by cookie token via `eq(sessions.id, token)`.
  - Needs compatibility with hashed session lookup and should avoid leaking deleted users.
- `src/server/db/schema.ts` and `src/server/db/migrations/*.sql`
  - Current users table has unique `phone_number`, `username`, and `email`.
  - `phone_number` is still required as legacy compatibility data, but login no longer uses it.
  - Current sessions table stores raw session token as primary key.
  - Current login challenges table has identity index from the initial phone-era schema, but no username/expiry cleanup index in Drizzle schema.
  - Invite codes store raw code and use `revoked_at` for deactivation.
- `src/server/audit-log.ts`
  - Audit writes are synchronous and can fail the primary route.
  - Metadata is arbitrary JSON and currently may include full invite codes and emails.
- `src/main.tsx`
  - `requestJson()` is the shared fetch wrapper and should get CSRF header behavior if CSRF is implemented.
  - `LoginPanel()` owns login, registration, profile display, sessions, and push preferences.
  - `AdminPanel()` owns user CRUD, invite list/create/revoke, settings, audit, backup, and restore.
- `src/server/http/app-flow.test.ts`
  - Uses Supertest agents, `HERMES_DEV_LOGIN_CODE`, bootstrap admin, temp SQLite databases, and should be extended for Phase 1 API behavior.

## Auth/rate limit/session-token/CSRF approach notes

### Generic login-code response

`POST /api/auth/request-code` should return the same success-shaped response for known and unknown active usernames, likely `202 { ok: true }`. Unknown usernames should not send mail or create a login challenge, but may write a redacted audit/security event such as `auth.request_unknown` with source IP, normalized username hash or masked username, and timestamp. If audit-write isolation is added, this event must not break the response.

The frontend should treat `202` as "Falls der Nutzer existiert, wurde ein Code versendet." New error text should stay German.

### Rate limits

Planner should add a small local rate-limit helper backed by SQLite, not Redis. Hermes is single-instance; in-memory limits would be lost on restart and would not satisfy admin inspection/clear requirements. A `rate_limits` or `auth_rate_limits` table can store:

- `scope`: endpoint family such as `login_request`, `login_verify`, `invite_register`.
- `key`: hashed or normalized key, for example `username:<lowercase>` or `ip:<source>`.
- `attempt_count`, `window_started_at`, `blocked_until`, `last_attempt_at`.
- Optional `metadata` for admin display after redaction.

Use separate keys for source IP and username/invite username. Practical defaults can be moderate, for example request-code per username and per IP windows; verify-code per username and IP; invite-register per IP and invite code. Expose retry information generically: `429 { error: "rate_limit_aktiv", retryAfterSeconds }`.

Admin allowlist/clear controls should be narrow: list current blocked entries, clear a block, and manage trusted IP prefixes or exact IPs. If this feels too large, it can be planned as a late Plan 01-01 task but should still be included because D-05 requires it.

### Challenge cleanup and superseding

On each request-code for an existing user:

- Mark older unconsumed challenges for that username as consumed or superseded before inserting a new challenge, satisfying "only newest code remains valid".
- Delete or mark consumed expired challenges on a bounded cadence, such as opportunistic cleanup at request-code/verify-code time.
- Add SQL indexes for username plus consumed/expiry lookup and cleanup.

The schema may keep `phone_number` on login challenges for compatibility, but new query paths should be username/email centered.

### Hashed session tokens

Current sessions use raw bearer token as `sessions.id`, which leaks reusable cookies via SQLite/S3 snapshots. Planner should choose a minimally disruptive migration:

- Add a `token_hash` column to `sessions`, unique and indexed.
- Generate raw token for cookie only, persist `hashSessionToken(rawToken)`.
- Use a stable server-side hash, preferably SHA-256 or HMAC-SHA-256. HMAC with an env secret is stronger, but introduces required secret lifecycle. For this LAN app, SHA-256 already prevents direct token reuse from snapshots if tokens have enough entropy. If adding `HERMES_SESSION_HASH_SECRET`, docs/env must be updated in Phase 6.
- Update `getCurrentSession()`, logout, revoke, session listing, and push subscription session references.

Migration question: existing sessions have raw IDs. D-24 allows forcing affected users to log in again if seamless migration is unsafe. The least risky plan is to revoke legacy sessions during migration or at first boot after migration if `token_hash` is null. Avoid trying to hash existing raw IDs while keeping them valid unless the code can also migrate primary-key references cleanly.

A more invasive but cleaner model is to keep `sessions.id` as a random non-secret database ID and add `token_hash`. That requires changing session creation, current lookup, audit entity IDs, push `session_id`, tests, and any client references. This is feasible in Phase 1 and preferable for long-term safety, but planners should size it carefully.

### Session invalidation

Deletion already revokes sessions and push subscriptions. Role changes and admin-driven email changes currently do not revoke affected sessions. Planner should implement:

- Admin role change revokes all sessions for the affected user.
- Admin email change revokes all sessions for the affected user after successful update.
- Admin display-name-only or notification-only changes do not need revocation.
- Self-service confirmed email change revokes other sessions or all sessions depending on chosen safety posture. Context specifically requires admin-driven email changes revoke sessions; all-session revocation after email confirmation is safer and simpler to explain.

Tests should assert old Supertest agents fail after revocation.

### CSRF

Phase context selects explicit CSRF token design. Keep it simple:

- Add a non-secret readable CSRF cookie or an authenticated `GET /api/auth/csrf` endpoint returning a token tied to session ID/server secret.
- Require `X-Hermes-CSRF` or `X-CSRF-Token` on mutating cookie-authenticated routes.
- `requestJson()` adds the header for non-GET methods after bootstrapping the token.
- Login request/verify/register need careful handling because they are unauthenticated. Option A: exempt public auth endpoints but protect all authenticated mutations. Option B: issue a CSRF token before login and require it everywhere. Option A is simpler and still addresses admin destructive routes.

Planner must include tests for missing/invalid CSRF on at least one admin mutation and one current-user mutation, plus successful authenticated mutation with token.

## Profile/email/device-name approach notes

### Display name

Add `display_name` to `users`, nullable or not-null defaulting to existing username. `publicUser()` should include it. Use display name in event/admin UI labels where appropriate, but keep username visible where login identity matters. Since Phase 5 owns broad UI extraction, Phase 1 can keep display-name rendering minimal.

Add `PATCH /api/auth/profile` or `PUT /api/auth/profile` for current user:

- Accept `displayName` with trim, min/max, and no uniqueness requirement.
- Reject empty after trim.
- Write audit `user.profile_update` with sparse metadata.

Admin update route should accept `displayName` too and audit it.

### Email uniqueness

The current full unique index on `users.email` already enforces uniqueness globally, but deleted users are anonymized on soft delete, which releases emails. Phase 1 still needs consistent validation and user-facing errors across:

- Admin create user.
- Admin update user email.
- Invite registration.
- Self-service email-change request.

Planner should add explicit active-user checks before writes to return stable German error codes rather than relying only on SQLite conflict. Keep database uniqueness as final protection.

### Confirmed self-service email change

Add an email-change challenge table rather than overloading login challenges. It should include:

- `id`, `user_id`, `new_email`, `code_hash`, `expires_at`, `consumed_at`, `created_at`, maybe `sent_at`.
- Index by `user_id`, `new_email`, `expires_at`.

Flow:

1. Logged-in user requests email change with a new email.
2. Server validates email format and active uniqueness.
3. Server sends confirmation code to the new email.
4. Current login email remains unchanged until verification.
5. User submits code to verify; server re-checks uniqueness, updates user email, consumes challenge, audits, and revokes sessions according to the chosen invalidation rule.

Do not send the new email as login destination until confirmed.

### Device names

Current `verify-code` accepts optional `deviceName` and stores null otherwise. Planner should implement default device-name derivation from `User-Agent` without adding a heavy dependency:

- Basic heuristics: iPhone/iPad, Android, Windows, macOS, Linux, mobile fallback, desktop fallback.
- Use the submitted `deviceName` when non-empty after trim.
- Store fallback such as `Windows-PC`, `iPhone`, `Android-Smartphone`, or `Unbekanntes Gerät`.

Add an authenticated route to rename a session/device, for example `PATCH /api/auth/sessions/:id`, only for the current user's own session, validating max length. Audit `auth.session_rename`.

Frontend can add a small edit control in the existing profile/sessions list, but avoid large component reshaping.

## Invite lifecycle approach notes

### Entropy and code treatment

Current generated invite code is 10 uppercase hex chars from UUID without dashes, around 40 bits. For public registration, planner should increase generated code entropy. A good target is at least 80 bits, for example 16 base32/base36 chars from secure random bytes. Codes remain case-insensitive by normalization.

User-supplied custom codes are still allowed by current UI/API. Require minimum length and character constraints that discourage weak codes, or generate by default and document custom codes as credential-like. Since D-15 allows admins to see full codes in UI/API, the main secret reduction is in audit logs and docs.

### Admin list and audit disclosure

D-15 says full invite codes are visible to admins. Keep `GET /api/admin/invite-codes` returning full code unless the planner explicitly adds a "reveal" action, but audit metadata must stop storing full codes. Use `inviteCodeId`, `inviteLabel`, and optionally `maskedCode` such as first/last few characters.

Add a small redaction helper for audit metadata if repeated across auth/admin routes.

### Lifecycle endpoints

Current `DELETE /api/admin/invite-codes/:id` deactivates via `revokedAt`. Phase 1 needs more explicit lifecycle:

- `PATCH /api/admin/invite-codes/:id` for label, `maxUses`, `expiresAt`.
- `POST /api/admin/invite-codes/:id/deactivate` sets `revokedAt`.
- `POST /api/admin/invite-codes/:id/reactivate` clears `revokedAt` only if expiry is null or future.
- `DELETE /api/admin/invite-codes/:id` hard-deletes only if `usedCount = 0`; otherwise return conflict or deactivate/hide according to UI choice.

Validation:

- Required label, max 120.
- `maxUses` null or 1..500, and cannot be less than current `usedCount`.
- `expiresAt` null or valid datetime. Reactivation of expired invite requires editing `expiresAt` first or in same update.

Audit:

- `invite.update`, `invite.deactivate`, `invite.reactivate`, `invite.delete_unused`.
- Never include full code.

### Public registration throttling

Registration should check rate limits before expensive or revealing operations. Error responses for invalid invite code, exhausted invite, or registration disabled can stay product-specific, but repeated attempts should hit `429`. Consider whether to audit repeated invalid invite attempts in redacted form.

Atomic `maxUses` enforcement is Phase 2 requirement INV-03. Phase 1 should avoid pretending to solve concurrency, but lifecycle edit validation must preserve current used counts.

## Data model and migration implications

Likely new/changed schema:

- `users.display_name TEXT` with migration defaulting existing rows to `username`.
- `email_change_challenges` table for confirmed self-service email changes.
- `rate_limit_entries` or similarly named table for persisted throttling and admin operations.
- Optional `rate_limit_allowlist` table for trusted LAN source IPs or prefixes.
- `sessions.token_hash TEXT` unique/indexed, with migration strategy for legacy raw-token sessions.
- Potential `sessions.id` semantic change from raw token to opaque session ID. If changed, update `push_subscriptions.session_id` references carefully.
- Indexes:
  - Login challenge lookup by `username`, `consumed_at`, `expires_at`, `created_at`.
  - Login challenge cleanup by `expires_at`.
  - Email-change challenge lookup by `user_id`, `consumed_at`, `expires_at`.
  - Rate-limit lookup by `scope`, `key`.

Migration files must be added under `src/server/db/migrations/` and mirrored in `src/server/db/schema.ts`. Because build copies migrations into `dist-server`, no separate copy step is needed beyond normal `npm run build`.

Risk: SQLite cannot add all desired constraints to existing tables without rebuilds. Prefer additive columns/tables/indexes for Phase 1. Use application-level active-email checks plus the existing unique email index rather than rebuilding users for partial unique constraints.

Deleted users are already anonymized, so existing `users_email_unique` can continue to enforce uniqueness for active and anonymized deleted rows. If historical deleted email preservation is ever required, that becomes a future migration problem.

## Test strategy

Add focused API integration tests in `src/server/http/app-flow.test.ts` or a new sibling test file if the existing flow becomes too large. Use existing temp SQLite/bootstrap/Supertest patterns.

Minimum Phase 1 tests:

- Unknown username request-code returns `202` and does not reveal existence.
- Known username request-code returns the same outward shape and sends/creates a valid challenge.
- Request-code rate limit returns `429` after configured threshold and includes retry metadata.
- Verify-code rate limit returns `429` for repeated bad codes.
- Requesting a second login code invalidates or supersedes the first code.
- Expired/superseded login challenges are cleaned or ignored and lookup uses the newest valid challenge.
- Session persistence no longer stores the raw cookie token as a DB primary lookup value or reusable token.
- Legacy sessions are revoked or handled according to migration decision.
- Role changes revoke affected user sessions.
- User deletion keeps affected user unable to use old sessions.
- Admin email change revokes affected user sessions.
- Mutating authenticated route without CSRF token fails, if CSRF is implemented.
- Mutating authenticated route with valid CSRF token succeeds.
- Admin create user rejects duplicate active email with stable error.
- Invite registration rejects duplicate active email with stable error.
- Self-service display-name update validates, persists, and audits.
- Self-service email change sends to new address, keeps old email active before verification, updates after correct code, rejects duplicate active email, and audits.
- Device default name is set when verify-code omits deviceName.
- Session/device rename validates ownership and updates listing.
- Generated invite code meets length/charset/entropy policy.
- Invite create/update/deactivate/reactivate/delete-unused endpoints work and audit without full code metadata.
- Invite edit rejects `maxUses` below used count.
- Used invite delete is rejected or converted to deactivate according to plan.
- Public invite registration throttles repeated invalid attempts.
- Audit metadata for invite actions does not contain raw full invite code or OTP/session secrets.

Run at least:

- `npm test`
- `npm run build`

If planner adds new env variables for session hash secrets or CSRF secrets, Phase 6 docs will cover release docs, but Phase 1 tests should set safe local values.

## Validation Architecture with concrete validation dimensions and required tests

### Dimension 1: User enumeration resistance

Required tests:

- `POST /api/auth/request-code` for existing and unknown username returns the same status and response shape.
- Unknown username does not create a login challenge and does not send mail.
- Unknown username creates only redacted audit/admin visibility, if audit event is implemented.

### Dimension 2: Abuse throttling

Required tests:

- Login-code request is limited by username.
- Login-code request is limited by source IP or request source abstraction.
- OTP verification is limited by username and/or source.
- Invite registration is limited before unlimited invalid-code probing.
- Admin can clear an active rate-limit block, and allowlisted LAN source bypass works if allowlist is implemented.

### Dimension 3: Challenge lifecycle correctness

Required tests:

- Second issued OTP invalidates first OTP.
- Expired OTP cannot be verified.
- Newest valid OTP verifies and consumes the challenge.
- Cleanup path removes or marks stale challenges without deleting needed history unexpectedly.

### Dimension 4: Session secret safety and invalidation

Required tests:

- Cookie token value is not present as a persisted reusable session ID/hash value.
- Authenticated requests still resolve the current user after token hashing.
- Logout and session revoke work with hashed lookup.
- Role changes revoke existing sessions for the target user.
- Admin email change revokes target sessions.
- Soft-delete revokes target sessions and old agent receives `401`.

### Dimension 5: CSRF posture

Required tests:

- Missing/invalid CSRF token blocks at least one authenticated mutating user route and one admin route.
- Valid CSRF token allows the same mutations.
- Public auth routes are either explicitly exempted and tested, or protected with a pre-login token and tested.

### Dimension 6: Profile and email safety

Required tests:

- Display name update trims, validates, persists, returns via `/api/auth/me`, and writes audit.
- Duplicate active email is rejected in admin create/update, invite registration, and profile email-change request.
- Email-change challenge sends code to the new email, keeps old email usable until confirmation, then updates email after verification.
- Wrong/expired email-change code is rejected without changing email.

### Dimension 7: Device management

Required tests:

- Omitted `deviceName` gets a useful default from user-agent or fallback.
- User can rename own session/device.
- User cannot rename another user's session.
- Session listing marks the current session correctly after token-hash changes.

### Dimension 8: Invite credential handling and lifecycle

Required tests:

- Generated invite code length/charset satisfies the documented entropy policy.
- Invite create/list still supports admin operational visibility.
- Invite audit metadata does not store full code.
- Invite update validates label, expiry, and `maxUses >= usedCount`.
- Deactivate blocks registration.
- Reactivate works only when not expired or after expiry edit.
- Unused invite can be hard-deleted.
- Used invite cannot be hard-deleted and preserves historical usage context.

### Dimension 9: Migration compatibility

Required tests:

- Fresh database migration creates all new columns/tables/indexes.
- Existing pre-Phase-1 database migrates without losing users/invites/sessions beyond the deliberate legacy-session revocation decision.
- Drizzle schema and SQL migrations stay aligned enough for `npm run build` and HTTP tests.

### Dimension 10: Audit robustness and redaction

Required tests:

- Audit entries are written for profile update, email change request/confirm, session rename/revoke, role/email admin changes, and invite lifecycle actions.
- Audit metadata excludes OTPs, raw session tokens, and full invite codes.
- Audit write failure behavior matches the Phase 1 decision: either isolated with server logging or intentionally blocking for specific critical actions.
