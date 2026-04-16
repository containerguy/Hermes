---
phase: 12
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server/db/migrations/0010_audio_haptic_prefs.sql
  - src/server/db/schema.ts
  - src/server/auth/current-user.ts
  - src/server/db/bootstrap-admin.ts
  - src/server/http/admin-routes.ts
  - src/server/http/auth-routes.ts
  - src/server/push/push-service.ts
  - src/server/http/push-routes.ts
  - src/server/push/push-payload.test.ts
autonomous: true
requirements:
  - NOTIF-01
must_haves:
  truths:
    - "A user with both notification sub-toggles OFF receives push payloads without a `vibrate` field and with `silent: true`."
    - "A user with `notificationsHapticEnabled=true` receives payloads containing a `vibrate` array (caller-provided or the [120, 60, 120] default per D-02)."
    - "A user with `notificationsAudibleEnabled=true` receives payloads with `silent: false`."
    - "New users created via any path (register, admin create, bootstrap-admin) default BOTH sub-toggles to `false` per D-09."
    - "Existing users retain their current behaviour by migrating to BOTH sub-toggles OFF (no implicit opt-in per D-09)."
    - "`PATCH /api/push/preferences` accepts optional `audibleEnabled` and `hapticEnabled` booleans and persists them on the user row, returning them through `publicUser`."
    - "Push payload shape is validated by a Zod schema before `web-push.sendNotification` is called (D-03)."
    - "No new npm dependencies are added (D-15); `package.json` diff is empty."
  artifacts:
    - path: "src/server/db/migrations/0010_audio_haptic_prefs.sql"
      provides: "Adds `notifications_audible_enabled` and `notifications_haptic_enabled` INTEGER NOT NULL DEFAULT 0 to `users`."
      contains: "ALTER TABLE users ADD COLUMN notifications_audible_enabled"
    - path: "src/server/db/schema.ts"
      provides: "Drizzle columns `notificationsAudibleEnabled` and `notificationsHapticEnabled`."
      contains: "notificationsAudibleEnabled"
    - path: "src/server/push/push-service.ts"
      provides: "Per-user payload finalization that strips `vibrate` when haptic is off, sets `silent` from audible toggle, applies [120,60,120] default, and Zod-validates the outgoing payload."
      contains: "finalizePushPayload"
    - path: "src/server/http/push-routes.ts"
      provides: "Extended `preferenceSchema` accepting `audibleEnabled` and `hapticEnabled` optional booleans."
      contains: "audibleEnabled"
    - path: "src/server/push/push-payload.test.ts"
      provides: "Vitest suite covering all four toggle combinations and the Zod contract."
      contains: "finalizePushPayload"
  key_links:
    - from: "src/server/push/push-service.ts (sendPushToUser)"
      to: "users.notificationsAudibleEnabled + notificationsHapticEnabled"
      via: "read user row and branch payload fields"
      pattern: "notificationsHapticEnabled"
    - from: "src/server/http/push-routes.ts (PATCH /preferences)"
      to: "users row update"
      via: "Zod-parsed optional booleans persisted via drizzle `.set(...)`"
      pattern: "audibleEnabled"
    - from: "src/server/auth/current-user.ts (publicUser)"
      to: "client User type"
      via: "expose `notificationsAudibleEnabled` + `notificationsHapticEnabled` on the user JSON"
      pattern: "notificationsAudibleEnabled"
---

<objective>
Server-side foundation for NOTIF-01: persist two per-user sub-toggles (`notificationsAudibleEnabled`, `notificationsHapticEnabled`), extend `PATCH /api/push/preferences` to accept them, and finalize Web Push payloads per recipient so `silent` and `vibrate` are emitted ONLY when the matching toggle is on. All existing push callers (`sendPushToEnabledUsers`, `sendPushToOperators`) remain signature-compatible.

Purpose: Unblock the client plan (12-02) with a stable, Zod-validated contract for push payloads and user preferences, and guarantee per-user gating on the server so the client cannot bypass it.

Output: Migration `0010_audio_haptic_prefs.sql`, schema + `publicUser` additions, a `finalizePushPayload(user, payload)` helper wired into `sendPushToUser`, an extended `preferenceSchema` on `/api/push/preferences`, and a new `push-payload.test.ts` asserting payload shape across toggle states.
</objective>

<execution_context>
@.planning/phases/12-audio-and-haptic-notifications/12-CONTEXT.md
@AGENTS.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/12-audio-and-haptic-notifications/12-CONTEXT.md
@.planning/codebase/CONCERNS.md

# Canonical files that define the current contract
@src/server/push/push-service.ts
@src/server/http/push-routes.ts
@src/server/db/schema.ts
@src/server/auth/current-user.ts
@src/server/push/push-service-cleanup.test.ts

<interfaces>
<!-- Extracted from the codebase so the executor does not need to explore. -->

From src/server/push/push-service.ts:
```typescript
type PushPayload = {
  title: string;
  body: string;
  url?: string;
  vibrate?: number[];
  requireInteraction?: boolean;
};

export async function sendPushToUser(
  context: DatabaseContext,
  userId: string,
  payload: PushPayload
): Promise<void>;
export async function sendPushToEnabledUsers(
  context: DatabaseContext,
  payload: PushPayload
): Promise<void>;
export async function sendPushToOperators(
  context: DatabaseContext,
  payload: PushPayload
): Promise<void>;
```

From src/server/http/push-routes.ts:
```typescript
const preferenceSchema = z.object({ enabled: z.boolean() });
// PATCH /api/push/preferences returns { user: publicUser(updated) }
```

From src/server/auth/current-user.ts:
```typescript
export function publicUser(user: typeof users.$inferSelect): {
  id: string;
  phoneNumber: string;
  username: string;
  displayName: string | null;
  email: string;
  role: "user" | "manager" | "admin";
  notificationsEnabled: boolean;
  deletedAt: string | null;
};
```

From src/server/db/schema.ts (users table — existing columns that stay):
```typescript
notificationsEnabled: integer("notifications_enabled", { mode: "boolean" })
  .notNull()
  .default(true)
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Migration 0010, Drizzle schema, publicUser, user-creation defaults</name>
  <files>src/server/db/migrations/0010_audio_haptic_prefs.sql, src/server/db/schema.ts, src/server/auth/current-user.ts, src/server/db/bootstrap-admin.ts, src/server/http/admin-routes.ts, src/server/http/auth-routes.ts</files>
  <read_first>
    - src/server/db/schema.ts (users table shape)
    - src/server/db/migrations/0008_push_subscription_failures.sql (canonical pattern for simple ALTER TABLE ADD COLUMN migrations — imitate it)
    - src/server/auth/current-user.ts (publicUser shape)
    - src/server/db/bootstrap-admin.ts, src/server/http/admin-routes.ts, src/server/http/auth-routes.ts (every place a user row is INSERTed — all three must set the new columns to `false`)
  </read_first>
  <action>
    1. Create `src/server/db/migrations/0010_audio_haptic_prefs.sql` with exactly two `ALTER TABLE users ADD COLUMN` statements:
       - `notifications_audible_enabled INTEGER NOT NULL DEFAULT 0`
       - `notifications_haptic_enabled INTEGER NOT NULL DEFAULT 0`
       Defaults are **0 / false** for all existing users — this implements D-09 "no implicit opt-in". Do NOT touch `notifications_enabled`.
    2. In `src/server/db/schema.ts` add two Drizzle columns named exactly `notificationsAudibleEnabled` and `notificationsHapticEnabled`, mirroring the existing `notificationsEnabled` definition but with `.default(false)`. Column name strings must match the migration (`notifications_audible_enabled`, `notifications_haptic_enabled`).
    3. In `src/server/auth/current-user.ts` extend `publicUser` to also return `notificationsAudibleEnabled` and `notificationsHapticEnabled`. Keep all existing fields in place.
    4. In `src/server/db/bootstrap-admin.ts`, wherever `notificationsEnabled: true` is set on the admin insert/update, also set `notificationsAudibleEnabled: false` and `notificationsHapticEnabled: false` (admin bootstrap is an existing user path per D-09).
    5. In `src/server/http/admin-routes.ts`, at the user-create insert (currently uses `notificationsEnabled: readSettings(context).defaultNotificationsEnabled`), also set `notificationsAudibleEnabled: false` and `notificationsHapticEnabled: false`. Do NOT add them to `updateUserSchema` — those toggles are owned by the owning user, not admins, per D-10/D-11.
    6. In `src/server/http/auth-routes.ts`, at the invite-registration insert (line ~324, the block that sets `notificationsEnabled: settings.defaultNotificationsEnabled`), also set `notificationsAudibleEnabled: false` and `notificationsHapticEnabled: false`.
    7. Do NOT add an audit entry for any of this (D-11). Do NOT add new dependencies (D-15).
    8. Run `npm test` — all existing suites must still pass (the new boolean fields default to false everywhere, so no existing payload shape changes).
  </action>
  <verify>
    <automated>grep -n "notifications_audible_enabled" src/server/db/migrations/0010_audio_haptic_prefs.sql &amp;&amp; grep -n "notifications_haptic_enabled" src/server/db/migrations/0010_audio_haptic_prefs.sql &amp;&amp; grep -n "notificationsAudibleEnabled" src/server/db/schema.ts &amp;&amp; grep -n "notificationsHapticEnabled" src/server/db/schema.ts &amp;&amp; grep -n "notificationsAudibleEnabled" src/server/auth/current-user.ts &amp;&amp; grep -n "notificationsHapticEnabled" src/server/auth/current-user.ts &amp;&amp; grep -n "notificationsAudibleEnabled: false" src/server/db/bootstrap-admin.ts src/server/http/admin-routes.ts src/server/http/auth-routes.ts &amp;&amp; grep -n "notificationsHapticEnabled: false" src/server/db/bootstrap-admin.ts src/server/http/admin-routes.ts src/server/http/auth-routes.ts &amp;&amp; npx vitest run --dir src 2>&amp;1 | tail -20</automated>
  </verify>
  <done>
    Migration file exists with both ALTER TABLE statements, Drizzle schema exposes both camelCase properties, `publicUser` surfaces both, and all three user-insert sites set the new columns to `false`. `npx vitest run --dir src` exits 0 with no new failures.
  </done>
</task>

<task type="auto">
  <name>Task 2: finalizePushPayload + Zod payload contract + /preferences extension + tests</name>
  <files>src/server/push/push-service.ts, src/server/http/push-routes.ts, src/server/push/push-payload.test.ts</files>
  <read_first>
    - src/server/push/push-service.ts (full file — current `PushPayload` type, `sendPushToUser` branching, `sendPushToEnabledUsers`, `sendPushToOperators`)
    - src/server/push/push-service-cleanup.test.ts (canonical pattern for vitest + `web-push` mock + sqlite tmp db — imitate its `beforeEach/afterEach`, `vi.mock("web-push", ...)` and `webpush.sendNotification as ReturnType<typeof vi.fn>` usage)
    - src/server/http/push-routes.ts (current `preferenceSchema` and PATCH handler)
  </read_first>
  <action>
    1. In `src/server/push/push-service.ts`:
       a. Define and export `export const DEFAULT_VIBRATE_PATTERN = [120, 60, 120] as const;` (D-02 canonical default).
       b. Define `pushPayloadSchema` with `z.object({ title: z.string().min(1), body: z.string(), url: z.string().optional(), vibrate: z.array(z.number().int().nonnegative()).max(16).optional(), silent: z.boolean().optional(), requireInteraction: z.boolean().optional(), tag: z.string().optional(), renotify: z.boolean().optional() })`. This is the D-03 explicit contract. Extend the `PushPayload` TS type to allow the same optional fields (`silent`, `tag`, `renotify`) so callers stay unchanged but the type matches runtime validation.
       c. Add `export function finalizePushPayload(user: Pick&lt;typeof users.$inferSelect, "notificationsAudibleEnabled" | "notificationsHapticEnabled"&gt;, payload: PushPayload): PushPayload` with the following rules (implement D-01):
          - If `user.notificationsHapticEnabled` is true → include `vibrate` set to `payload.vibrate ?? DEFAULT_VIBRATE_PATTERN` (caller pattern wins over default).
          - If `user.notificationsHapticEnabled` is false → OMIT the `vibrate` key entirely (use object destructuring; do not set `undefined` and then `JSON.stringify` — the field must not appear in the serialized payload).
          - Set `silent: !user.notificationsAudibleEnabled` explicitly so the field is always present (D-01 audio affordance).
          - Preserve `title`, `body`, `url`, `requireInteraction`, `tag`, `renotify` as-is.
       d. In `sendPushToUser`, after the existing `if (!user?.notificationsEnabled) return;` guard, build `const finalized = finalizePushPayload(user, payload);`, then `const parsed = pushPayloadSchema.safeParse(finalized);` — if `!parsed.success`, `console.error("[Hermes] Push payload invalid", parsed.error);` and `return;` (silent fallback per AGENTS.md; do not throw). Pass `JSON.stringify(parsed.data)` to `webpush.sendNotification`. Keep all existing failure-count / 404 / 410 revocation logic unchanged.
       e. Do not change the signatures or behaviour of `sendPushToEnabledUsers` or `sendPushToOperators`. The per-user gating is centralized in `sendPushToUser` via `finalizePushPayload`, so existing callers in `event-routes.ts` that pass `vibrate: [260, 90, 120]` etc. continue to work AND get correctly gated per recipient.
    2. In `src/server/http/push-routes.ts`:
       a. Replace `preferenceSchema` with `z.object({ enabled: z.boolean().optional(), audibleEnabled: z.boolean().optional(), hapticEnabled: z.boolean().optional() }).refine(v =&gt; v.enabled !== undefined || v.audibleEnabled !== undefined || v.hapticEnabled !== undefined, { message: "leere_preferenz" })`.
       b. In the handler, build the update object conditionally: only include `notificationsEnabled`, `notificationsAudibleEnabled`, `notificationsHapticEnabled` when their respective body field was provided. Always bump `updatedAt`.
       c. Do NOT write an audit entry (D-11).
       d. Keep the existing `401 nicht_angemeldet` and `400 ungueltige_preferenz` error shape; reuse `ungueltige_preferenz` for the Zod failure.
    3. Create `src/server/push/push-payload.test.ts` (model on `push-service-cleanup.test.ts`):
       - `vi.mock("web-push", ...)` as in the cleanup test.
       - For each of the four toggle combinations (`audible=false,haptic=false`, `audible=true,haptic=false`, `audible=false,haptic=true`, `audible=true,haptic=true`), insert a user row with those values + `notifications_enabled=1`, insert one active subscription, call `sendPushToUser(context, userId, { title: "t", body: "b", vibrate: [200, 50, 200] })`, then read the JSON string passed to `webpush.sendNotification` and assert:
         * haptic off → parsed object has NO `vibrate` key (`expect("vibrate" in payload).toBe(false)`).
         * haptic on, caller-provided vibrate → `payload.vibrate` equals `[200, 50, 200]` (caller wins).
         * Repeat one case WITHOUT a caller-provided vibrate: assert `payload.vibrate` equals `[120, 60, 120]` (default per D-02).
         * audible off → `payload.silent === true`.
         * audible on → `payload.silent === false`.
       - Also add a unit-level test that calls `finalizePushPayload` directly with a minimal user object (no DB) and asserts the same four combinations — this locks the helper contract even if `sendPushToUser` is later refactored.
    4. No new dependencies (D-15).
  </action>
  <verify>
    <automated>grep -n "DEFAULT_VIBRATE_PATTERN" src/server/push/push-service.ts &amp;&amp; grep -n "finalizePushPayload" src/server/push/push-service.ts &amp;&amp; grep -n "pushPayloadSchema" src/server/push/push-service.ts &amp;&amp; grep -n "audibleEnabled" src/server/http/push-routes.ts &amp;&amp; grep -n "hapticEnabled" src/server/http/push-routes.ts &amp;&amp; npx vitest run src/server/push/push-payload.test.ts &amp;&amp; npx vitest run --dir src 2>&amp;1 | tail -20</automated>
  </verify>
  <done>
    `finalizePushPayload`, `pushPayloadSchema`, and `DEFAULT_VIBRATE_PATTERN` are exported from `push-service.ts`; `/api/push/preferences` accepts all three optional booleans; `push-payload.test.ts` passes with assertions on all four toggle combinations; entire `npx vitest run --dir src` still exits 0 (existing tests unchanged). `package.json` diff is empty (D-15).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → `PATCH /api/push/preferences` | Untrusted body crosses into user-preference storage. Must be Zod-validated. |
| in-process caller → `sendPushToUser` | Callers inside `event-routes.ts` pass a `PushPayload`. The `vibrate`/`silent` fields MUST be finalized per recipient, never passed through as-is. |
| server → `web-push.sendNotification` | JSON payload leaves the trust boundary. Must be Zod-validated before send (D-03). |
| migration → existing users table | Existing rows must not be implicitly opted in (D-09). Migration defaults are `0`. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-12-01 | Tampering | `sendPushToUser` payload | mitigate | `finalizePushPayload` re-derives `silent` and `vibrate` from the user row for every recipient; caller-supplied `silent`/`vibrate` are intentionally overwritten or stripped so a caller cannot bypass the per-user toggle. |
| T-12-02 | Spoofing / schema drift | outgoing push payload | mitigate | `pushPayloadSchema.safeParse(finalized)` runs before `webpush.sendNotification`; invalid payload logs and returns early (no throw), matching AGENTS.md silent-fallback rule. |
| T-12-03 | Denial of service (user annoyance / battery) | `vibrate` pattern | mitigate | Default capped to `[120, 60, 120]` (D-02). Schema caps the array to 16 entries and requires non-negative ints, so a future careless caller cannot ship a 10-second buzz. |
| T-12-04 | Elevation of privilege / admin-scope | `updateUserSchema` in admin-routes | mitigate | New toggles are NOT added to admin user-update schema; only the owning user can change them via `/api/push/preferences` (D-10 ownership, D-11 no-audit rationale). |
| T-12-05 | Information disclosure | audit log | accept | D-11 explicitly excludes these personal UI prefs from audit logging; no PII leak risk. |
| T-12-06 | Repudiation / retention | push_subscriptions | accept | No change from status quo; existing failure/revocation logic untouched. |
| T-12-07 | Tampering (migration) | existing users | mitigate | `DEFAULT 0` on both new columns ensures no existing user is implicitly opted in (D-09). |
</threat_model>

<verification>
- `npx vitest run --dir src` exits 0 (all pre-existing tests green, new `push-payload.test.ts` green).
- `git diff package.json package-lock.json` is empty (D-15).
- `grep -R "audio" src/server/push/audio*.mp3 src/server/push/*.wav 2>/dev/null` returns nothing (D-04 — no custom audio files shipped).
- `sqlite3 $(mktemp).sqlite` after running migrations shows `users` with both new columns at `DEFAULT 0` (manual spot-check optional — the test already exercises migration via `runMigrations`).
</verification>

<success_criteria>
- Phase 12 Success Criterion #1 (server half): push payloads carry `silent`/`vibrate` shaped by the user's toggles — proven by `push-payload.test.ts`.
- Phase 12 Success Criterion #3 (server half): server tests assert push payload shape — delivered by `push-payload.test.ts`.
- D-01, D-02, D-03, D-09, D-10, D-11, D-13, D-15 all implemented and verifiable by grep/tests.
</success_criteria>

<output>
After completion, create `.planning/phases/12-audio-and-haptic-notifications/12-01-SUMMARY.md` with: files touched, migration number, the exact shape of the finalized payload (JSON example for each of the four toggle combinations), and a note confirming `package.json` is unchanged.
</output>
