# Phase 1: Auth, Profile, And Invite Hardening - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 hardens the existing username + email one-time-code login, profile/device management, and invite-code registration/admin lifecycle. It does not introduce a separate LAN-party entity, a new authentication provider, native apps, or active/active deployment. The goal is to make the current self-hosted LAN-party app safe and usable before public registration is enabled.

</domain>

<decisions>
## Implementation Decisions

### Auth-Schutz

- **D-01:** Login-code requests must show users a generic success-shaped response even when the username does not exist.
- **D-02:** Unknown-user login-code requests should still create redacted internal audit/admin visibility so admins can diagnose suspicious attempts without exposing user existence to callers.
- **D-03:** Login-code request and OTP verification limits should be moderate: enough to slow repeated attempts by username and IP, without blocking normal LAN setup mistakes too aggressively.
- **D-04:** Rate-limit feedback should be clear and user-facing, including a retry/wait time where possible, while avoiding details useful for attack tuning.
- **D-05:** Admins need a small rate-limit operations view: active IP/username blocks can be inspected and cleared, and IPs can be allowlisted for the LAN environment.
- **D-06:** For a username, only the newest unconsumed one-time code should remain valid; requesting a new code invalidates older open challenges.

### Profil und E-Mail

- **D-07:** Add a separate mutable display name. The username remains the unique login identifier.
- **D-08:** Display names are not unique. Multiple users may share the same display name.
- **D-09:** Users can request their own email change, but the new email becomes active only after a confirmation code sent to the new address is verified.
- **D-10:** Until the new address is confirmed, login codes continue to be sent to the old email address.
- **D-11:** Admins may directly change another user's email address and display name without the user's confirmation code; those changes must be audited.
- **D-12:** New sessions should get the best available default device name derived from browser/user-agent hints, such as Windows-PC, iPhone, Android-Smartphone, or a clear fallback. Users can overwrite the device name.
- **D-13:** Email addresses must be unique among active accounts across admin-created users, invite registration, and profile email changes.
- **D-14:** Email addresses from soft-deleted users may be reused. Deleted users should be anonymized enough to release the email address while preserving historical/audit context.

### Invite-Lifecycle

- **D-15:** Admins should be able to see full invite codes in the admin UI/API. This is an explicit product choice for LAN operations even though invite codes are credential-like.
- **D-16:** Audit metadata must not store full invite-code secrets. Audit should use invite ID, label, and masked code or no code.
- **D-17:** Existing invite codes can be edited for label, `maxUses`, and `expiresAt`. The invite code string itself should not be changed after creation.
- **D-18:** `maxUses` cannot be edited below the current used count.
- **D-19:** Unused invite codes can be hard-deleted. Used invite codes should be deactivated/hidden from active planning rather than destroying historical usage context.
- **D-20:** Admins can deactivate and reactivate invite codes. Reactivation is allowed only when the invite is otherwise valid; expired invites need a future `expiresAt` before they become usable again.
- **D-21:** New invite codes default to `maxUses = 300` and an expiry 30 days after creation unless the admin chooses different values.
- **D-22:** For Phase 1, organizing invite codes for different LAN parties is handled through the required invite label, for example `LAN April 2026`. A separate LAN-party model is out of scope for this phase.

### Session und Audit-Sicherheit

- **D-23:** Session tokens should be stored hashed at rest so SQLite snapshots do not contain directly reusable raw bearer tokens.
- **D-24:** Migration to hashed session storage should be best-effort seamless. Existing sessions may continue if safely migratable; if not, forcing affected users to log in again is acceptable.
- **D-25:** Role changes, user deletion, and admin-driven email changes revoke the affected user's sessions so changed security state takes effect cleanly.
- **D-26:** Cookie-authenticated mutating API requests should use an explicit CSRF token design. The client sends the token in a header for mutating requests.
- **D-27:** Audit-write failures must not block the primary business action. They should be logged server-side and, where useful, surfaced as an admin-visible warning.
- **D-28:** Audit metadata should avoid full secrets and use sparse personally identifiable information: never OTPs, raw session tokens, or full invite codes; emails only where operationally necessary, otherwise masked.

### the agent's Discretion

- Exact numeric rate-limit windows, burst counts, block durations, and cleanup cadence are left to the agent, as long as they fit a 25-person LAN deployment and satisfy D-03 to D-05.
- Exact CSRF token endpoint/header names are left to the agent, but the implementation must be consistent across the React client and Express mutating routes.
- Exact user-agent parsing library or heuristic for default device names is left to the agent; avoid adding a heavy dependency unless the benefit is clear.
- Exact UI copy for warnings, rate-limit messages, email confirmation, invite states, and admin operations is left to the agent, but user-facing text must remain German.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements

- `.planning/ROADMAP.md` — Phase 1 goal, requirements, canonical refs, and success criteria.
- `.planning/REQUIREMENTS.md` — AUTH, PROF, and INV requirements mapped to Phase 1.
- `.planning/PROJECT.md` — Product constraints, out-of-scope decisions, and deployment/storage assumptions.
- `.planning/research/SUMMARY.md` — Current milestone research priorities and risks.

### Codebase maps

- `.planning/codebase/ARCHITECTURE.md` — Current auth, admin, persistence, audit, and frontend architecture.
- `.planning/codebase/CONCERNS.md` — Known auth/session/invite/audit risks to address.
- `.planning/codebase/CONVENTIONS.md` — TypeScript, route, database, audit, and frontend conventions.

### Implementation touchpoints

- `src/server/http/auth-routes.ts` — Login-code request/verification, invite registration, sessions, logout.
- `src/server/http/admin-routes.ts` — Admin user management, invite-code administration, audit exposure.
- `src/server/auth/sessions.ts` — Session cookie and token creation behavior.
- `src/server/auth/current-user.ts` — Current session lookup and authorization helpers.
- `src/server/db/schema.ts` — Users, login challenges, sessions, invite codes, invite uses, audit tables.
- `src/server/db/migrations/` — SQL migrations that must stay aligned with Drizzle schema.
- `src/server/audit-log.ts` — Audit write/list behavior and metadata parsing.
- `src/main.tsx` — Current login/profile/session/invite/admin UI and client API helper.
- `src/server/http/app-flow.test.ts` — Existing API integration test patterns.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `src/server/http/auth-routes.ts`: Existing Zod schemas, `issueLoginChallenge()`, `sendIssuedLoginCode()`, session list/revoke endpoints, and invite registration flow are the direct extension points.
- `src/server/http/admin-routes.ts`: Existing admin-only middleware, user CRUD, invite create/revoke endpoints, and audit-log route provide the patterns for blocklist/allowlist and invite lifecycle endpoints.
- `src/server/auth/sessions.ts`: Existing cookie settings and token generator are the place to introduce hashed-token helpers and cookie/header consistency.
- `src/server/audit-log.ts`: Existing structured audit writer should be wrapped or hardened rather than replaced.
- `src/main.tsx`: Existing `LoginPanel()` already owns profile, sessions/devices, registration, and notification actions; `AdminPanel()` already owns users and invite codes.
- `src/server/http/app-flow.test.ts`: Existing Supertest agent flow is the best pattern for new auth/profile/invite route coverage.

### Established Patterns

- API routes use Zod validation, German machine-readable error codes, early returns after responses, and `{ resource: value }` JSON wrappers.
- SQLite schema changes require both `src/server/db/schema.ts` and a new SQL migration under `src/server/db/migrations/`.
- Atomic multi-step writes use `context.sqlite.transaction(() => { ... })()`.
- User deletion is soft-delete plus anonymization, session revocation, push subscription revocation, and audit logging.
- Audit logs are written from route handlers with actor, action, entity, summary, and metadata.
- Frontend mutations use `requestJson()` with `credentials: "include"` and reload affected state after success.

### Integration Points

- Auth throttling and generic login responses integrate with `/api/auth/request-code` and `/api/auth/verify-code`.
- Admin block/allow controls integrate under `/api/admin` and the admin UI.
- Profile self-service integrates under `/api/auth` because it belongs to the current logged-in user, while admin overrides remain under `/api/admin/users/:id`.
- Invite edit/deactivate/reactivate/delete integrates with `/api/admin/invite-codes`.
- CSRF token handling touches server app/router middleware, auth/session routes, and the shared frontend `requestJson()` helper.
- Session-token hashing touches session creation, current-session lookup, session revocation, logout, migrations, and tests.

</code_context>

<specifics>
## Specific Ideas

- Admins should be able to recover from accidental IP blocks during LAN setup by clearing active blocks and allowlisting local/trusted IPs.
- The admin invite UI may show full invite codes, but audit logs should not become a long-term storage location for invite secrets.
- Invite labels should carry the LAN-party planning meaning for now, avoiding a new party/event model in Phase 1.
- Device names should be useful without requiring a user to type one, but users can still overwrite the generated label.

</specifics>

<deferred>
## Deferred Ideas

- A first-class LAN-party planning model separate from invite labels is deferred to a later phase.
- Guaranteed custom mobile notification sounds remain out of scope.
- Active/active multi-instance support remains out of scope.

</deferred>

---

*Phase: 01-auth-profile-and-invite-hardening*
*Context gathered: 2026-04-16*
