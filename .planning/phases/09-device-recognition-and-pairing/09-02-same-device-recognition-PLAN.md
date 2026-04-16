---
phase: 09-device-recognition-and-pairing
plan: 02
type: execute
wave: 2
depends_on: [01]
files_modified:
  - src/server/http/auth-routes.ts
  - src/server/http/auth-device-recognition.test.ts
autonomous: true
requirements: [AUTH-01]
must_haves:
  truths:
    - "verify-code accepts an optional `deviceKey` (base64url, 22-44 chars) and an optional `pwa` boolean and never echoes either value back."
    - "When (userId, deviceKeyHash) matches an existing non-revoked session, verify-code updates that row's tokenHash/lastSeenAt/userAgent/deviceName/deviceSignals INSTEAD of inserting a new sessions row."
    - "When deviceKey is absent but normalizedDeviceSignals match a single existing non-revoked session for the user, the same update-in-place behavior applies (D-02 fallback)."
    - "When neither match path applies, verify-code inserts a new session as today (no behavioral regression for fresh devices)."
    - "Response sets `Cache-Control: no-store` on verify-code so the device key never gets cached by intermediaries (D-05)."
    - "An audit log entry distinguishes `auth.login` (new session) from `auth.login_recognized` (existing session updated) without ever recording the device key."
  artifacts:
    - path: "src/server/http/auth-routes.ts"
      provides: "verify-code route extended with device recognition"
      contains: "auth.login_recognized"
    - path: "src/server/http/auth-device-recognition.test.ts"
      provides: "Vitest covering: same-device key reuse, signals fallback, fresh device, key-mismatch, malformed key rejection"
      contains: "describe(\"auth device recognition\""
  key_links:
    - from: "src/server/http/auth-routes.ts (verify-code handler)"
      to: "src/server/auth/device-key.ts"
      via: "hashDeviceKey + normalizeDeviceSignals + deviceSignalsFingerprint"
      pattern: "hashDeviceKey\\(|normalizeDeviceSignals\\("
    - from: "src/server/http/auth-routes.ts (verify-code handler)"
      to: "sessions table"
      via: "Drizzle update by (userId, deviceKeyHash) before falling through to insert"
      pattern: "sessions\\.deviceKeyHash"
---

<objective>
Implement AUTH-01 server-side: extend the existing `POST /api/auth/verify-code` handler so that re-login from a recognized device updates the existing session row instead of inserting a new one. Recognition uses (1) the client-supplied device key (preferred) and (2) normalized low-entropy device signals (fallback), per D-01/D-02. Add a focused vitest covering happy + negative paths.

Purpose: Without this plan, every browser refresh-then-relogin keeps creating duplicate `sessions` rows for the same user+device, polluting the device list UI shipped in Phase 1.

Output: One modified route file, one new test file. No new tables, no new endpoints (those are in 09-03).
</objective>

<execution_context>
@$HOME/.cursor/get-shit-done/workflows/execute-plan.md
@$HOME/.cursor/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/09-device-recognition-and-pairing/09-CONTEXT.md
@.planning/phases/09-device-recognition-and-pairing/09-01-schema-and-device-model-PLAN.md
@AGENTS.md
@src/server/http/auth-routes.ts
@src/server/auth/sessions.ts
@src/server/auth/device-names.ts

<interfaces>
Helpers consumed from 09-01:

```typescript
// src/server/auth/device-key.ts
export function hashDeviceKey(rawKey: string): string;
export function normalizeDeviceSignals(input: { userAgent: string | undefined; pwa?: boolean }): NormalizedDeviceSignals;
export function deviceSignalsFingerprint(signals: NormalizedDeviceSignals): string;
```

Existing primitives used unchanged:

```typescript
// src/server/auth/sessions.ts
export function createSessionId(): string;
export function createSessionToken(): string;
export function hashSessionToken(token: string): string;
export function setSessionCookie(response: Response, token: string): void;
```

Existing `sessions` Drizzle columns now in scope (after 09-01): `id, userId, deviceName, userAgent, lastSeenAt, createdAt, tokenHash, revokedAt, deviceKeyHash, deviceSignals`.

Existing audit code: `auth.login`. New audit code introduced here: `auth.login_recognized`.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend verify-code Zod schema and add the recognition branch</name>
  <files>src/server/http/auth-routes.ts</files>
  <read_first>
    - src/server/http/auth-routes.ts (full `verifyCodeSchema` and the `router.post("/verify-code", ...)` handler — lines 28–31 and 444–541)
    - src/server/auth/device-key.ts (created in 09-01 — verify exports before importing)
    - src/server/db/schema.ts (sessions table now has deviceKeyHash + deviceSignals)
    - .planning/phases/09-device-recognition-and-pairing/09-CONTEXT.md (D-01..D-05)
  </read_first>
  <action>
    Edit `src/server/http/auth-routes.ts`:

    1. Add imports at the top (alongside existing `../auth/sessions` import):
       ```ts
       import { deviceSignalsFingerprint, hashDeviceKey, normalizeDeviceSignals } from "../auth/device-key";
       ```

    2. Replace the `verifyCodeSchema` definition with:
       ```ts
       const verifyCodeSchema = requestCodeSchema.extend({
         code: z.string().trim().regex(/^\d{6}$/),
         deviceName: z.string().trim().max(120).optional(),
         deviceKey: z.string().trim().regex(/^[A-Za-z0-9_-]{22,44}$/).optional(),
         pwa: z.boolean().optional()
       });
       ```
       Rationale: 22 chars is base64url(16 bytes) without padding (the minimum, per `DEVICE_KEY_BYTES = 16`); 44 chars allows 32-byte keys for forward compat.

    3. Inside the verify-code handler, AFTER the `const sessionId = createSessionId();` block but BEFORE the `context.sqlite.transaction(...)` block, compute recognition state:
       ```ts
       const deviceKeyHash = parsed.data.deviceKey ? hashDeviceKey(parsed.data.deviceKey) : null;
       const normalizedSignals = normalizeDeviceSignals({
         userAgent: request.get("user-agent") ?? undefined,
         pwa: parsed.data.pwa
       });
       const deviceSignals = deviceSignalsFingerprint(normalizedSignals);

       let recognizedSession: typeof sessions.$inferSelect | undefined;
       if (deviceKeyHash) {
         recognizedSession = context.db
           .select()
           .from(sessions)
           .where(and(eq(sessions.userId, user.id), eq(sessions.deviceKeyHash, deviceKeyHash), isNull(sessions.revokedAt)))
           .get();
       }
       if (!recognizedSession) {
         const candidates = context.db
           .select()
           .from(sessions)
           .where(and(eq(sessions.userId, user.id), eq(sessions.deviceSignals, deviceSignals), isNull(sessions.revokedAt), isNull(sessions.deviceKeyHash)))
           .all();
         // Only fallback-match when EXACTLY ONE candidate exists; otherwise treat as a new device (D-02 keeps fallback conservative).
         if (candidates.length === 1) {
           recognizedSession = candidates[0];
         }
       }
       ```

    4. Replace the existing transaction body so it either UPDATES the recognized row or INSERTS a new one:
       ```ts
       context.sqlite.transaction(() => {
         context.db
           .update(loginChallenges)
           .set({ consumedAt: timestamp })
           .where(eq(loginChallenges.id, challenge.id))
           .run();

         if (recognizedSession) {
           context.db
             .update(sessions)
             .set({
               tokenHash: sessionTokenHash,
               lastSeenAt: timestamp,
               userAgent: request.get("user-agent") ?? null,
               deviceName: resolvedDeviceName,
               deviceKeyHash: deviceKeyHash ?? recognizedSession.deviceKeyHash ?? null,
               deviceSignals
             })
             .where(eq(sessions.id, recognizedSession.id))
             .run();
         } else {
           context.db
             .insert(sessions)
             .values({
               id: sessionId,
               userId: user.id,
               deviceName: resolvedDeviceName,
               userAgent: request.get("user-agent") ?? null,
               lastSeenAt: timestamp,
               createdAt: timestamp,
               tokenHash: sessionTokenHash,
               revokedAt: null,
               deviceKeyHash,
               deviceSignals
             })
             .run();
         }
       })();
       ```

    5. Audit log: replace the existing `tryWriteAuditLog` call so action and summary differ when recognized. NEVER include `deviceKey` or `deviceKeyHash` in metadata:
       ```ts
       tryWriteAuditLog(context, {
         actor: user,
         action: recognizedSession ? "auth.login_recognized" : "auth.login",
         entityType: "session",
         entityId: recognizedSession?.id ?? sessionId,
         summary: recognizedSession
           ? `${user.username} hat sich von einem bekannten Gerät erneut angemeldet.`
           : `${user.username} hat sich angemeldet.`,
         metadata: {
           deviceName: resolvedDeviceName,
           deviceClass: normalizedSignals.deviceClass,
           platform: normalizedSignals.platform,
           browser: normalizedSignals.browser,
           pwa: normalizedSignals.pwa,
           recognized: Boolean(recognizedSession)
         }
       });
       ```

    6. Before `setSessionCookie(response, sessionToken);`, add `response.setHeader("Cache-Control", "no-store");` to satisfy D-05 (this response carries the new cookie associated with the device key — must not be cached).

    7. Do NOT change `request-code`, `register`, `email-change*`, `sessions` (GET/PATCH/DELETE), or `logout`. Do NOT change other audit codes.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "auth.login_recognized" src/server/http/auth-routes.ts` returns ≥ 1 line.
    - `grep -n "deviceKey:" src/server/http/auth-routes.ts` shows the Zod schema field.
    - `grep -n "Cache-Control" src/server/http/auth-routes.ts` returns ≥ 1 line in the verify-code handler.
    - `grep -n "deviceKeyHash" src/server/http/auth-routes.ts` shows it used both in update set and insert values.
    - `grep -nE "metadata:.*deviceKey[^H]" src/server/http/auth-routes.ts` returns 0 lines (audit metadata never carries the raw key field).
    - `npx tsc --noEmit -p tsconfig.json` exits 0.
  </acceptance_criteria>
  <done>verify-code recognizes returning devices and updates the existing session row in place, audited under a distinct action.</done>
</task>

<task type="auto">
  <name>Task 2: Add the auth-device-recognition vitest suite</name>
  <files>src/server/http/auth-device-recognition.test.ts</files>
  <read_first>
    - src/server/http/app-flow.test.ts (lines 1–60 for the test bootstrap pattern: `bootstrapAdmin`, `createHermesApp`, `request.agent(...)`, env-var fixtures, afterEach cleanup)
    - src/server/http/auth-routes.ts (the modified verify-code handler)
    - src/server/auth/device-key.ts (the helper exports)
  </read_first>
  <action>
    Create `src/server/http/auth-device-recognition.test.ts`. Mirror the bootstrap from `app-flow.test.ts` (same beforeEach/afterEach env vars + `bootstrapAdmin()` + `createHermesApp()`). Then add a `describe("auth device recognition", () => { ... })` with these tests:

    1. **same-device key reuse updates existing session, does not insert a new one**
       - Login admin with `deviceKey: "AAAAAAAAAAAAAAAAAAAAAA"` (22-char base64url) and `deviceName: "test"`.
       - Read `sessions` table count for the admin user via the SQLite handle (open a `Database(databasePath)` like `app-flow.test.ts` does).
       - Login again with the SAME `deviceKey` value but a different `deviceName: "test-renamed"`.
       - Assert: `sessions` row count for the user did NOT increase. The single row's `device_name` is now `test-renamed` and `device_key_hash IS NOT NULL`.
       - Assert: an `audit_logs` row with `action = 'auth.login_recognized'` exists; no row with that action carries the literal raw key string `AAAAAAAAAAAAAAAAAAAAAA` in `summary` or `metadata`.

    2. **fallback by signals (no deviceKey, same UA) updates existing session**
       - Login with no `deviceKey` and a fixed `User-Agent` header (use supertest's `.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120")`).
       - Login again with no `deviceKey` and the same User-Agent.
       - Assert: `sessions` row count did NOT increase; the row's `device_signals` is non-null and matches `windows|chrome|desktop|web`.

    3. **fresh device path: different deviceKey produces a NEW session row**
       - Login with `deviceKey: "AAAAAAAAAAAAAAAAAAAAAA"`.
       - Login again with `deviceKey: "BBBBBBBBBBBBBBBBBBBBBB"`.
       - Assert: `sessions` count for the user increased by exactly 1; both rows are non-revoked.

    4. **malformed deviceKey is rejected with 400**
       - POST `/api/auth/verify-code` with `deviceKey: "short"` (fails the 22-char regex).
       - Assert: status 400, body `{ error: "ungueltiger_code" }`.

    5. **Cache-Control: no-store is set on verify-code response**
       - Login successfully.
       - Assert: `response.headers["cache-control"]` includes `"no-store"`.

    For all tests, use `process.env.HERMES_DEV_LOGIN_CODE = "123456"` and `request.agent(started.app)` style. Open the SQLite handle inline (`new Database(databasePath)`) and close it before the test's `expect`s end. Do NOT invoke the real mailer — `HERMES_MAIL_MODE = "console"`.
  </action>
  <verify>
    <automated>npx vitest run src/server/http/auth-device-recognition.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/server/http/auth-device-recognition.test.ts` exists.
    - `npx vitest run src/server/http/auth-device-recognition.test.ts` exits 0.
    - File contains `describe("auth device recognition"` (exact substring).
    - File contains all five test names: `same-device key reuse`, `fallback by signals`, `fresh device path`, `malformed deviceKey`, `Cache-Control`.
    - File contains the literal string `auth.login_recognized` (so the audit assertion is real).
    - `grep -E "AAAAAAAAAAAAAAAAAAAAAA" src/server/http/auth-device-recognition.test.ts` matches at least once (test uses a real deterministic key value).
  </acceptance_criteria>
  <done>All five tests pass and lock in the AUTH-01 server contract.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → POST /api/auth/verify-code body | New `deviceKey` and `pwa` fields cross the boundary. Zod limits shape; HMAC at storage time prevents leakage. |
| logs (console + audit) | Device key MUST NOT appear; audit metadata uses normalized signals only. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-07 | Spoofing | Attacker submits a guessed deviceKey to take over a session | mitigate | Recognition only UPDATES the row's transient fields (tokenHash, lastSeenAt, deviceName, userAgent); it does NOT bypass OTP — the email code is still required. The attacker would also need a valid OTP for the target user. |
| T-09-08 | Information Disclosure | Audit metadata leaks device key | mitigate | Acceptance criterion: grep finds zero `metadata.*deviceKey[^H]` lines. Only `deviceClass/platform/browser/pwa/recognized` are recorded. |
| T-09-09 | Information Disclosure | Verify-code response cached in proxy/browser | mitigate | `Cache-Control: no-store` set on the verify-code response (D-05). |
| T-09-10 | Tampering | Fallback-by-signals collapses two distinct devices into one | mitigate | Fallback ONLY applies when exactly one candidate exists AND that candidate has `device_key_hash IS NULL`. Two ambiguous candidates → fall through to the new-session insert path (conservative). |
| T-09-11 | DoS | Rate limit | accept (covered upstream) | Existing `login_verify` rate limit (Phase 1) already throttles this endpoint; no new throttle needed for device recognition. |
| T-09-12 | Repudiation | Cannot tell recognized vs new login from audit log | mitigate | New audit code `auth.login_recognized` distinguishes; `recognized: true/false` field in metadata for filterability. |
</threat_model>

<verification>
- `npx tsc --noEmit -p tsconfig.json` passes.
- `npx vitest run src/server/http/auth-device-recognition.test.ts` passes.
- `npx vitest run src/server/http/app-flow.test.ts` still passes (no regression to existing login tests).
- `grep "deviceKey" src/server/http/auth-routes.ts | grep -v deviceKeyHash | grep metadata` returns no lines (audit redaction).
</verification>

<success_criteria>
- Re-login from the same device updates the existing session row (verifiable: row count stable, deviceName updated).
- Fresh device produces a new row (verifiable: row count +1).
- Malformed device key returns 400 with `ungueltiger_code`.
- `Cache-Control: no-store` is present on the verify-code response.
- Audit log distinguishes recognized vs new login and never carries the raw key.
</success_criteria>

<output>
After completion, create `.planning/phases/09-device-recognition-and-pairing/09-02-SUMMARY.md` recording: the new request-body fields, the new audit code, the recognition decision tree (key match → signals match → new), and confirmation that `app-flow.test.ts` still passes.
</output>
