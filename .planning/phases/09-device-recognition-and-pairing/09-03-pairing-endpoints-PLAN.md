---
phase: 09-device-recognition-and-pairing
plan: 03
type: execute
wave: 3
depends_on: [01, 02]
files_modified:
  - src/server/http/auth-routes.ts
  - src/server/http/auth-pair.test.ts
autonomous: true
requirements: [AUTH-02]
must_haves:
  truths:
    - "An authenticated, CSRF-protected POST /api/auth/pair-token mints a 256-bit pairing token, persists ONLY its HMAC, and returns { token, expiresAt } once."
    - "POST /api/auth/pair-token is rate-limited via the new pair_token_create scope (per-session AND per-user keys), returning 429 { error: 'rate_limit_aktiv', retryAfterSeconds }."
    - "An UNAUTHENTICATED POST /api/auth/pair-redeem accepts { token, deviceName?, deviceKey?, pwa? }, validates and consumes the token atomically, creates a NEW session for the same user, and sets the standard session cookie."
    - "Redemption fails with stable error codes: pair_token_invalid (400), pair_token_expired (400), pair_token_consumed (400), pair_origin_revoked (401)."
    - "Redeeming a valid token does NOT revoke the originating session (D-10)."
    - "Audit entries device_pair_created (origin) and device_pair_redeemed (new session) are emitted; neither row contains the token, the token hash, or the device key in summary or metadata."
    - "Cache-Control: no-store is set on both responses (D-05 — pair-token because it carries the only copy of the secret; pair-redeem because it sets the session cookie)."
  artifacts:
    - path: "src/server/http/auth-routes.ts"
      provides: "Two new routes: POST /pair-token (auth-required) and POST /pair-redeem (public)"
      contains: "/pair-token"
    - path: "src/server/http/auth-pair.test.ts"
      provides: "Vitest covering happy-path mint+redeem, expiry, double-consume, origin-revoked, rate-limit, malformed token, audit redaction"
      contains: "describe(\"auth device pairing\""
  key_links:
    - from: "src/server/http/auth-routes.ts (pair-token handler)"
      to: "src/server/auth/pairing-tokens.ts"
      via: "createPairingToken + hashPairingToken + PAIR_TOKEN_TTL_MS"
      pattern: "createPairingToken\\(|hashPairingToken\\("
    - from: "src/server/http/auth-routes.ts (pair-token handler)"
      to: "src/server/auth/rate-limits.ts"
      via: "checkRateLimit({ scope: 'pair_token_create' }) + recordRateLimitFailure"
      pattern: "pair_token_create"
    - from: "src/server/http/auth-routes.ts (pair-redeem handler)"
      to: "pairing_tokens table"
      via: "single transaction: select by hashed token → validate expiry/consume/origin → mark consumed → insert new session"
      pattern: "pairingTokens"
---

<objective>
Implement AUTH-02 server-side: ship the two endpoints that turn an authenticated session into a session-bound, single-use, ≤10-min pairing token, and let an unauthenticated client redeem that token to create a second session for the same user without an email OTP.

Purpose: This is the entire backend for "Add a device". The original session must remain active (D-10), tokens must be opaque (D-08, D-13), origin-session revocation must invalidate outstanding tokens (D-08), and the audit trail must be useful without leaking secrets (D-11).

Output: One modified route file (mint + redeem handlers), one new vitest file. No schema changes (those landed in 09-01). No client work (that's 09-04).
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
@.planning/phases/09-device-recognition-and-pairing/09-02-same-device-recognition-PLAN.md
@AGENTS.md
@src/server/http/auth-routes.ts
@src/server/auth/csrf.ts
@src/server/auth/rate-limits.ts

<interfaces>
Helpers consumed (all already shipped by 09-01):

```typescript
// src/server/auth/pairing-tokens.ts
export const PAIR_TOKEN_BYTES: number;             // 32 → 256 bits per D-08
export const PAIR_TOKEN_TTL_MS: number;            // 600_000
export function createPairingToken(): string;
export function hashPairingToken(token: string): string;

// src/server/auth/device-key.ts (also used by pair-redeem so the new session inherits AUTH-01 fields)
export function hashDeviceKey(rawKey: string): string;
export function normalizeDeviceSignals(input: { userAgent: string | undefined; pwa?: boolean }): NormalizedDeviceSignals;
export function deviceSignalsFingerprint(signals: NormalizedDeviceSignals): string;

// src/server/auth/rate-limits.ts (extended in 09-01)
export type RateLimitScope = "login_request" | "login_verify" | "invite_register" | "pair_token_create";
```

CSRF: `pair-token` is auth-required; per the existing `csrfExemptPaths` set in `createAuthRouter`, ANY new POST that is NOT explicitly added to that set is automatically CSRF-checked. `pair-redeem` is unauthenticated → MUST be added to `csrfExemptPaths` (analogous to `/verify-code`).

Stable error codes (D-12) MUST match exactly: `pair_token_invalid`, `pair_token_expired`, `pair_token_consumed`, `pair_origin_revoked`.

Audit codes (D-11): `device_pair_created`, `device_pair_redeemed`. (Optionally also `device_pair_failed` per CONTEXT specifics for malformed/expired/consumed/revoked redemption attempts.)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add POST /pair-token (auth-required mint endpoint)</name>
  <files>src/server/http/auth-routes.ts</files>
  <read_first>
    - src/server/http/auth-routes.ts (full file; specifically the `csrfExemptPaths` set on line ~134, the `getCurrentSession` usage, and the `recordRateLimitFailure`/`checkRateLimit` patterns in `request-code` for shape)
    - src/server/auth/pairing-tokens.ts (created in 09-01)
    - src/server/auth/rate-limits.ts (`pair_token_create` scope added in 09-01)
    - src/server/db/schema.ts (`pairingTokens` table)
    - .planning/phases/09-device-recognition-and-pairing/09-CONTEXT.md (D-06, D-07, D-08, D-09, D-11, D-13, D-14)
  </read_first>
  <action>
    Edit `src/server/http/auth-routes.ts`:

    1. Add imports near the existing auth imports:
       ```ts
       import { createPairingToken, hashPairingToken, PAIR_TOKEN_TTL_MS } from "../auth/pairing-tokens";
       import { pairingTokens } from "../db/schema";
       ```

    2. After `router.delete("/sessions/:id", ...)` and BEFORE `router.post("/logout", ...)`, add the mint handler:
       ```ts
       router.post("/pair-token", (request, response) => {
         const current = getCurrentSession(context, request);
         if (!current) {
           response.status(401).json({ error: "nicht_angemeldet" });
           return;
         }

         const sessionKey = `session:${current.session.id}`;
         const userKey = `user:${current.user.id}`;
         const sessionLimit = checkRateLimit(context, { scope: "pair_token_create", key: sessionKey, sourceIp: request.ip });
         if (!sessionLimit.ok) {
           response.status(429).json({ error: sessionLimit.error, retryAfterSeconds: sessionLimit.retryAfterSeconds });
           return;
         }
         const userLimit = checkRateLimit(context, { scope: "pair_token_create", key: userKey, sourceIp: request.ip });
         if (!userLimit.ok) {
           response.status(429).json({ error: userLimit.error, retryAfterSeconds: userLimit.retryAfterSeconds });
           return;
         }

         const token = createPairingToken();
         const tokenHash = hashPairingToken(token);
         const tokenId = randomUUID();
         const timestamp = nowIso();
         const expiresAt = new Date(Date.now() + PAIR_TOKEN_TTL_MS).toISOString();

         context.db
           .insert(pairingTokens)
           .values({
             id: tokenId,
             userId: current.user.id,
             originSessionId: current.session.id,
             tokenHash,
             expiresAt,
             consumedAt: null,
             consumedSessionId: null,
             createdAt: timestamp
           })
           .run();

         // Count this mint against both keys so a session OR a user that asks too often gets blocked.
         recordRateLimitFailure(context, { scope: "pair_token_create", key: sessionKey });
         recordRateLimitFailure(context, { scope: "pair_token_create", key: userKey });

         tryWriteAuditLog(context, {
           actor: current.user,
           action: "device_pair_created",
           entityType: "session",
           entityId: current.session.id,
           summary: `${current.user.username} hat ein Pairing-Token erstellt.`,
           metadata: { originSessionId: current.session.id, expiresAt }
         });

         response.setHeader("Cache-Control", "no-store");
         response.status(201).json({ token, expiresAt });
       });
       ```
       Notes: We re-use `recordRateLimitFailure` as a generic "count an attempt" hook (matches its current behavior — increments and possibly blocks). Token value appears ONLY in the response body, never in DB or audit.

    3. Do NOT add `/pair-token` to `csrfExemptPaths` — auth-required POSTs MUST be CSRF-protected (D-14).
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n 'router.post("/pair-token"' src/server/http/auth-routes.ts` returns ≥ 1 line.
    - `grep -n 'createPairingToken\\|hashPairingToken' src/server/http/auth-routes.ts` shows BOTH imports used.
    - `grep -n 'device_pair_created' src/server/http/auth-routes.ts` returns ≥ 1 line.
    - `grep -n 'pair_token_create' src/server/http/auth-routes.ts` shows the rate-limit scope used at least twice (session-key + user-key checks).
    - `grep -n '/pair-token' src/server/http/auth-routes.ts` does NOT appear inside the `csrfExemptPaths = new Set([...])` literal (visual check / `grep -A2 csrfExemptPaths` shows only existing entries).
    - `npx tsc --noEmit -p tsconfig.json` exits 0.
  </acceptance_criteria>
  <done>Authenticated, CSRF-checked, rate-limited mint endpoint exists; tokens persist HMAC-only.</done>
</task>

<task type="auto">
  <name>Task 2: Add POST /pair-redeem (public, single-use redemption)</name>
  <files>src/server/http/auth-routes.ts</files>
  <read_first>
    - src/server/http/auth-routes.ts (the pair-token handler from Task 1, the verify-code handler for the new-session insert pattern from 09-02, and `csrfExemptPaths`)
    - src/server/auth/sessions.ts (cookie + token primitives)
    - src/server/auth/device-key.ts
    - .planning/phases/09-device-recognition-and-pairing/09-CONTEXT.md (D-08, D-10, D-12, D-14)
  </read_first>
  <action>
    Edit `src/server/http/auth-routes.ts`:

    1. Add `/pair-redeem` to the `csrfExemptPaths` Set (it is unauthenticated; CSRF applies after a session exists). Final set: `new Set(["/request-code", "/verify-code", "/register", "/pair-redeem"])`.

    2. Add a Zod schema near the other schemas at the top of the file:
       ```ts
       const pairRedeemSchema = z.object({
         token: z.string().trim().regex(/^[A-Za-z0-9_-]{32,128}$/),
         deviceName: z.string().trim().max(120).optional(),
         deviceKey: z.string().trim().regex(/^[A-Za-z0-9_-]{22,44}$/).optional(),
         pwa: z.boolean().optional()
       });
       ```

    3. Right after the `pair-token` handler from Task 1, add:
       ```ts
       router.post("/pair-redeem", (request, response) => {
         const parsed = pairRedeemSchema.safeParse(request.body);
         if (!parsed.success) {
           response.status(400).json({ error: "pair_token_invalid" });
           return;
         }

         const tokenHash = hashPairingToken(parsed.data.token);
         const timestamp = nowIso();

         const tokenRow = context.db.select().from(pairingTokens).where(eq(pairingTokens.tokenHash, tokenHash)).get();
         if (!tokenRow) {
           tryWriteAuditLog(context, {
             action: "device_pair_failed",
             entityType: "pairing_token",
             entityId: null,
             summary: "Pairing-Redemption mit unbekanntem Token abgelehnt.",
             metadata: { reason: "pair_token_invalid", sourceIp: request.ip ?? null }
           });
           response.status(400).json({ error: "pair_token_invalid" });
           return;
         }
         if (tokenRow.consumedAt) {
           response.status(400).json({ error: "pair_token_consumed" });
           return;
         }
         if (tokenRow.expiresAt <= timestamp) {
           response.status(400).json({ error: "pair_token_expired" });
           return;
         }

         const origin = context.db
           .select()
           .from(sessions)
           .where(and(eq(sessions.id, tokenRow.originSessionId), isNull(sessions.revokedAt)))
           .get();
         if (!origin) {
           response.status(401).json({ error: "pair_origin_revoked" });
           return;
         }

         const user = context.db
           .select()
           .from(users)
           .where(and(eq(users.id, tokenRow.userId), isNull(users.deletedAt)))
           .get();
         if (!user) {
           response.status(401).json({ error: "pair_origin_revoked" });
           return;
         }

         const newSessionId = createSessionId();
         const newSessionToken = createSessionToken();
         const newSessionTokenHash = hashSessionToken(newSessionToken);
         const resolvedDeviceName = resolveDeviceName(parsed.data.deviceName, request.get("user-agent") ?? undefined);
         const deviceKeyHash = parsed.data.deviceKey ? hashDeviceKey(parsed.data.deviceKey) : null;
         const normalizedSignals = normalizeDeviceSignals({
           userAgent: request.get("user-agent") ?? undefined,
           pwa: parsed.data.pwa
         });
         const deviceSignals = deviceSignalsFingerprint(normalizedSignals);

         const consumed = context.sqlite.transaction(() => {
           const claim = context.db
             .update(pairingTokens)
             .set({ consumedAt: timestamp, consumedSessionId: newSessionId })
             .where(and(eq(pairingTokens.id, tokenRow.id), isNull(pairingTokens.consumedAt)))
             .run();
           if (claim.changes === 0) {
             return false;
           }
           context.db
             .insert(sessions)
             .values({
               id: newSessionId,
               userId: user.id,
               deviceName: resolvedDeviceName,
               userAgent: request.get("user-agent") ?? null,
               lastSeenAt: timestamp,
               createdAt: timestamp,
               tokenHash: newSessionTokenHash,
               revokedAt: null,
               deviceKeyHash,
               deviceSignals
             })
             .run();
           return true;
         })();

         if (!consumed) {
           response.status(400).json({ error: "pair_token_consumed" });
           return;
         }

         tryWriteAuditLog(context, {
           actor: user,
           action: "device_pair_redeemed",
           entityType: "session",
           entityId: newSessionId,
           summary: `${user.username} hat ein neues Gerät über Pairing verbunden.`,
           metadata: {
             originSessionId: tokenRow.originSessionId,
             newSessionId,
             deviceName: resolvedDeviceName,
             deviceClass: normalizedSignals.deviceClass,
             platform: normalizedSignals.platform,
             browser: normalizedSignals.browser,
             pwa: normalizedSignals.pwa
           }
         });

         response.setHeader("Cache-Control", "no-store");
         setSessionCookie(response, newSessionToken);
         response.status(201).json({ user: publicUser(user) });
       });
       ```

    4. Do NOT auto-revoke the originating session anywhere in this handler (D-10). Do NOT include `parsed.data.token`, `tokenHash`, or `parsed.data.deviceKey` in any audit metadata.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n 'router.post("/pair-redeem"' src/server/http/auth-routes.ts` returns ≥ 1 line.
    - `grep -n 'csrfExemptPaths' src/server/http/auth-routes.ts | head -1` and the set literal contains `/pair-redeem` (visual / `grep -A1 csrfExemptPaths`).
    - All four error codes appear: `grep -E 'pair_token_invalid|pair_token_expired|pair_token_consumed|pair_origin_revoked' src/server/http/auth-routes.ts | wc -l` ≥ 4.
    - `grep -n 'device_pair_redeemed' src/server/http/auth-routes.ts` returns ≥ 1 line.
    - No bare `token` key appears in any `metadata:` literal inside the redeem handler: `grep -nE 'metadata:\s*\{[^}]*\btoken\s*:' src/server/http/auth-routes.ts` returns no matches (the string `pair_token_*` inside error codes is NOT a match for this key-shape check).
    - There is NO `update(sessions).set({ revokedAt:` call in the new redeem handler (originating session stays active per D-10). The `revokedAt: null` initializer on the NEW session row in the INSERT is expected and not flagged. Narrow check: `grep -n 'update(sessions)' src/server/http/auth-routes.ts` inside the redeem block returns no matches against `tokenRow.originSessionId`.
    - `npx tsc --noEmit -p tsconfig.json` exits 0.
  </acceptance_criteria>
  <done>Public, atomically-single-use redemption endpoint creates a new session and sets the cookie; original session untouched.</done>
</task>

<task type="auto">
  <name>Task 3: Add the auth-pair vitest suite (mint + redeem + negatives)</name>
  <files>src/server/http/auth-pair.test.ts</files>
  <read_first>
    - src/server/http/app-flow.test.ts (test bootstrap + `request.agent` + `fetchCsrf` helper at lines 27–30)
    - src/server/http/auth-routes.ts (the two new handlers)
    - src/server/auth/pairing-tokens.ts (TTL constant, used to compose an expired-token test)
    - .planning/phases/09-device-recognition-and-pairing/09-CONTEXT.md (D-08, D-10, D-11, D-12)
  </read_first>
  <action>
    Create `src/server/http/auth-pair.test.ts`. Reuse the bootstrap pattern from `app-flow.test.ts`. The suite `describe("auth device pairing", () => { ... })` MUST contain these tests:

    1. **mint requires authentication**
       - Without logging in, POST `/api/auth/pair-token` (no CSRF header).
       - Assert: 401, body `{ error: "nicht_angemeldet" }`.

    2. **mint requires CSRF**
       - Login as admin. POST `/api/auth/pair-token` WITHOUT the CSRF header.
       - Assert: 403, body `{ error: "csrf_token_ungueltig" }`.

    3. **happy path: mint then redeem creates a second session, original session intact**
       - Login as admin (agentA). Fetch CSRF, POST `/api/auth/pair-token` with `x-hermes-csrf` header. Assert response 201 carries `{ token, expiresAt }` and `Cache-Control` header includes `no-store`.
       - With a fresh agent (agentB), POST `/api/auth/pair-redeem` with `{ token, deviceName: "phone", deviceKey: "BBBBBBBBBBBBBBBBBBBBBB" }`. Assert 201, `{ user: { id: ... } }` matches admin id, response has a `Set-Cookie: hermes_session=...` header and `Cache-Control: no-store`.
       - Open the SQLite handle and assert: `sessions` rows for the admin = 2, both with `revoked_at IS NULL`. The newest row has `device_key_hash IS NOT NULL`. `pairing_tokens` row for this id has `consumed_at IS NOT NULL` and `consumed_session_id` matches the new session id.
       - Audit log assertions: exactly one `device_pair_created` and one `device_pair_redeemed` entry exist for the admin user; neither row's `summary` nor `metadata` contains the literal token string returned in the mint response.

    4. **double-redemption returns pair_token_consumed**
       - From #3's setup, redeem the same token a second time with a fresh agent.
       - Assert: 400, body `{ error: "pair_token_consumed" }`. `sessions` count for admin remains 2.

    5. **expired token returns pair_token_expired**
       - Login, mint a token, then directly UPDATE `pairing_tokens.expires_at` via the SQLite handle to `new Date(Date.now() - 60_000).toISOString()`.
       - Redeem with a fresh agent. Assert: 400, body `{ error: "pair_token_expired" }`.

    6. **origin-revoked token returns pair_origin_revoked**
       - Login (agentA), mint a token. From agentA, DELETE `/api/auth/sessions/{currentId}` to revoke.
       - With a fresh agent, redeem. Assert: 401, body `{ error: "pair_origin_revoked" }`.

    7. **malformed token returns pair_token_invalid**
       - POST `/api/auth/pair-redeem` with `{ token: "short" }`. Assert: 400, body `{ error: "pair_token_invalid" }`.

    8. **rate limit fires after 5 mints in a window**
       - Login. Mint 5 tokens in a loop (each with CSRF). The 6th mint MUST return 429 with `error: "rate_limit_aktiv"` and a numeric `retryAfterSeconds`.

    9. **audit redaction**
       - Mint a token, capture its value. Query `audit_logs WHERE action IN ('device_pair_created','device_pair_redeemed')` (after also redeeming once). For every row: `summary` must NOT contain the token; `metadata` JSON must NOT contain the token. (Use `expect(JSON.stringify(row)).not.toContain(token)`.)

    For #2/#3/#8, reuse the helper:
    ```ts
    async function fetchCsrf(agent: ReturnType<typeof request.agent>) {
      const r = await agent.get("/api/auth/csrf").expect(200);
      return r.body.token as string;
    }
    ```
    Send CSRF as the `x-hermes-csrf` header (matching the existing `CSRF_HEADER` import).
  </action>
  <verify>
    <automated>npx vitest run src/server/http/auth-pair.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/server/http/auth-pair.test.ts` exists.
    - `npx vitest run src/server/http/auth-pair.test.ts` exits 0.
    - File contains `describe("auth device pairing"`.
    - File contains all stable error code strings: `pair_token_invalid`, `pair_token_expired`, `pair_token_consumed`, `pair_origin_revoked`, AND `rate_limit_aktiv`.
    - File contains BOTH audit codes: `device_pair_created` and `device_pair_redeemed`.
    - File contains `expect(JSON.stringify(row)).not.toContain(token)` (or equivalent assertion that the token does not appear in audit log rows).
  </acceptance_criteria>
  <done>All 9 tests pass and lock in the AUTH-02 server contract.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| authenticated client → POST /pair-token | Mint endpoint. Auth + CSRF + rate-limit gate. |
| anonymous client → POST /pair-redeem | Public endpoint. Token bearer == authority. Single-use. |
| QR/URL display surface | Token leaves the server in plaintext exactly once (response body) and is rendered as `#login?pair=<token>` on the originating screen — handled in 09-04. |
| browser history | Token in URL fragment (`#login?pair=...`) — fragments are NOT sent to servers, but they DO land in browser history. Mitigated by short TTL + single-use; hardened further in 09-04 by stripping the fragment after redemption. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-13 | Spoofing | Forged token redemption | mitigate | 256-bit random tokens (D-08); HMAC lookup means attacker needs the exact pre-image. Brute force is throttled by no rate-limit on redeem yet — tracked as T-09-15. |
| T-09-14 | Information Disclosure | Token leaked in audit log | mitigate | Test #9 enforces token absence from `audit_logs.summary` and `audit_logs.metadata`. |
| T-09-15 | DoS / Brute force | Token enumeration via /pair-redeem | mitigate (partial) | TTL ≤10min + single-use (D-08) + 256-bit entropy reduces feasibility to ~negligible per token. We do NOT add a /pair-redeem rate limit in this plan because Phase 1's IP-level throttling is currently scoped to `login_*`/`invite_*` only; the planner accepts this residual risk because (a) entropy makes guessing infeasible within TTL, (b) every failure already writes a `device_pair_failed` audit row that an admin can spot. (If incident response shows abuse, follow-up work can add a `pair_token_redeem` scope using the existing rate-limit machinery.) |
| T-09-16 | Repudiation | Origin session can deny minting | mitigate | `device_pair_created` audit row records `originSessionId` and timestamp. |
| T-09-17 | Tampering | Concurrent double-redeem race | mitigate | Atomic claim: `UPDATE pairing_tokens SET consumed_at = ... WHERE id = ? AND consumed_at IS NULL` inside a transaction; only one writer wins; loser sees `changes === 0` → returns `pair_token_consumed`. |
| T-09-18 | Information Disclosure | Token cached by intermediary | mitigate | `Cache-Control: no-store` on both responses (D-05). |
| T-09-19 | Elevation of Privilege | Session fixation via pairing | mitigate | New session uses `createSessionId()` + `createSessionToken()` (fresh values), `setSessionCookie()` rotates the cookie. There is no path by which the redeemer can influence the new session id. |
| T-09-20 | Session fixation v2 | Origin session token reused for new device | mitigate | New session is INSERTED, not UPDATED; new `tokenHash` is independent. Original session's `tokenHash` is untouched. |
| T-09-21 | CSRF | Mint endpoint without CSRF | mitigate | `/pair-token` is NOT in `csrfExemptPaths`, so the existing router-level `requireCsrf` middleware enforces the token. Test #2 enforces this in CI. |
| T-09-22 | CSRF | Redeem endpoint without CSRF | accept | `/pair-redeem` is unauthenticated; CSRF doesn't apply (no session cookie to ride). The bearer-token model already requires the secret. Listed in `csrfExemptPaths` consistent with `/verify-code` precedent. |
</threat_model>

<verification>
- `npx tsc --noEmit -p tsconfig.json` passes.
- `npx vitest run src/server/http/auth-pair.test.ts` passes (all 9 tests).
- `npx vitest run src/server/http/app-flow.test.ts` and `npx vitest run src/server/http/auth-device-recognition.test.ts` still pass.
- Final csrfExemptPaths check: `grep -A2 'csrfExemptPaths = new Set' src/server/http/auth-routes.ts` shows `/pair-redeem` AND does NOT show `/pair-token`.
</verification>

<success_criteria>
- Mint endpoint exists, is auth+CSRF gated, returns the token only in the response body, persists only its HMAC, audits via `device_pair_created`.
- Redeem endpoint exists, is public, single-use atomic, returns the four stable error codes for the four failure modes, sets the session cookie, audits via `device_pair_redeemed`, leaves the originating session active.
- Rate limit fires at the 6th mint within the window.
- All audit assertions confirm the token never reaches the log surface.
</success_criteria>

<output>
After completion, create `.planning/phases/09-device-recognition-and-pairing/09-03-SUMMARY.md` recording: the two endpoints' contracts (request/response shape + error codes), the rate-limit configuration in effect, residual risk T-09-15 (no /pair-redeem rate limit yet) for follow-up consideration, and confirmation that the test count = 9.
</output>
