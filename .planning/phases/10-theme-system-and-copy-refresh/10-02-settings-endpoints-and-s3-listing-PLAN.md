---
phase: 10-theme-system-and-copy-refresh
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server/db/migrations/0011_theme_background_settings.sql
  - src/server/settings.ts
  - src/server/storage/s3-storage.ts
  - src/server/http/admin-routes.ts
  - src/server/http/background-routes.ts
  - src/server/app.ts
  - src/server/settings.theme.test.ts
  - src/server/http/admin-themes.test.ts
  - src/server/http/backgrounds.test.ts
autonomous: true
requirements: [THEME-01, THEME-02]
tags: [settings, migration, s3, admin-endpoints, zod]

must_haves:
  truths:
    - "Settings persist activeThemeId, customThemes, and activeBackgroundKey across process restarts and snapshot restore."
    - "Admin theme CRUD endpoints (create/update/delete/activate) are admin-only, CSRF-guarded, reject invalid tokens with stable error codes, and emit a single settings_theme_updated audit row per mutation."
    - "Admin can list background presets strictly scoped to the `themes/backgrounds/` S3 prefix; arbitrary key listing (e.g. snapshot keys) is impossible."
    - "Any signed-in client can fetch the image bytes for a background preset via a public/signed-in endpoint that streams only from the `themes/backgrounds/` prefix — snapshot keys and recovery keys are never reachable."
    - "If S3 is disabled or the prefix is empty the listing endpoint returns `{ backgrounds: [] }` without throwing."
  artifacts:
    - path: "src/server/db/migrations/0011_theme_background_settings.sql"
      provides: "Seed rows for new app_settings keys (activeThemeId, customThemes, activeBackgroundKey) with idempotent INSERT OR IGNORE"
      contains: "activeThemeId"
    - path: "src/server/settings.ts"
      provides: "Extended settingsSchema with Zod-validated theme + background fields and strict token sanitization"
      exports: ["settingsSchema", "HermesSettings", "themeRecordSchema", "readSettings", "writeSettings"]
    - path: "src/server/storage/s3-storage.ts"
      provides: "listThemeBackgrounds() + getThemeBackgroundStream(key) helpers, prefix-locked to `themes/backgrounds/`"
      exports: ["listThemeBackgrounds", "getThemeBackgroundStream", "THEME_BACKGROUND_PREFIX"]
    - path: "src/server/http/admin-routes.ts"
      provides: "POST/PATCH/DELETE /api/admin/themes, POST /api/admin/themes/:id/activate, GET /api/admin/backgrounds, POST /api/admin/backgrounds/select"
      contains: "settings_theme_updated"
    - path: "src/server/http/background-routes.ts"
      provides: "GET /api/backgrounds/:key public streaming route (auth-optional; scoped to THEME_BACKGROUND_PREFIX)"
      exports: ["createBackgroundRouter"]
    - path: "src/server/app.ts"
      provides: "Mounts createBackgroundRouter under /api/backgrounds"
  key_links:
    - from: "src/server/http/admin-routes.ts"
      to: "src/server/settings.ts"
      via: "imports settingsSchema + themeRecordSchema for validation on each theme CRUD call"
      pattern: "themeRecordSchema"
    - from: "src/server/http/admin-routes.ts"
      to: "src/server/storage/s3-storage.ts"
      via: "imports listThemeBackgrounds"
      pattern: "listThemeBackgrounds"
    - from: "src/server/http/background-routes.ts"
      to: "src/server/storage/s3-storage.ts"
      via: "imports getThemeBackgroundStream + THEME_BACKGROUND_PREFIX"
      pattern: "THEME_BACKGROUND_PREFIX"
    - from: "src/server/app.ts"
      to: "src/server/http/background-routes.ts"
      via: "app.use(\"/api/backgrounds\", createBackgroundRouter(context))"
      pattern: "createBackgroundRouter"
---

<objective>
Extend the server so Hermes persists Phase-10 settings, exposes admin endpoints for custom theme CRUD + background selection, lists S3 background presets (locked to a Hermes-specific prefix), and streams chosen backgrounds to signed-in clients — without ever exposing snapshot or recovery keys.

Purpose: D-04 (DB-backed custom themes), D-07 (audit codes), D-08 (S3 prefix scoping), D-09 (list endpoint), D-12 (empty-S3 fallback), D-17 (stable error codes), D-18 (admin-only + CSRF), D-19 (explicit migration). This plan is the persistence + API foundation for the UI plans 10-03 and 10-04.

Output: one SQL migration, extended settings schema with token sanitization, new admin routes, one public streaming route, and three vitest suites that prove authorization + prefix scoping + validation.
</objective>

<execution_context>
@AGENTS.md
@.planning/codebase/CONVENTIONS.md
@.planning/codebase/STACK.md
@.planning/codebase/CONCERNS.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/phases/10-theme-system-and-copy-refresh/10-CONTEXT.md
@src/server/settings.ts
@src/server/http/admin-routes.ts
@src/server/storage/s3-storage.ts
@src/server/db/schema.ts
@src/server/app.ts

<interfaces>
<!-- From src/server/settings.ts (current): -->
<!-- settingsSchema = z.object({ appName, defaultNotificationsEnabled, eventAutoArchiveHours, publicRegistrationEnabled, themePrimaryColor, themeLoginColor, themeManagerColor, themeAdminColor, themeSurfaceColor }) -->
<!-- defaultSettings is a HermesSettings literal. -->
<!-- readSettings(context) / writeSettings(context, settings, updatedByUserId) -->

<!-- From src/server/http/admin-routes.ts (existing settings handler, lines 794–818): -->
<!-- router.put("/settings", ...) uses settingsSchema.partial(), audit action "settings.update". -->
<!-- The router applies an admin guard + CSRF guard at router.use() level; all new routes inherit both. -->

<!-- From src/server/storage/s3-storage.ts: -->
<!-- S3Client creation is in createS3Client(); bucket/region come from readS3Config(). -->
<!-- `restorableTables` list and snapshot keys like "hermes.sqlite" and "recoveries/..." are the SENSITIVE keys that must never appear in listings. -->

<!-- Client-side applyTheme (from plan 10-01) already enforces the same token key/value regex — server uses the SAME regex so client + server agree. -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add migration 0011 and extend settingsSchema with sanitized theme + background fields</name>
  <files>src/server/db/migrations/0011_theme_background_settings.sql, src/server/settings.ts, src/server/settings.theme.test.ts</files>
  <read_first>
    - src/server/db/migrations/0009_event_soft_delete.sql (migration style — plain SQL, no transactions required by runner)
    - src/server/db/migrate.ts (how migrations are applied and recorded)
    - src/server/settings.ts (existing settingsSchema shape)
    - src/client/theme/presets.ts (from 10-01; import HERMES_TOKEN_KEY_PATTERN + HERMES_TOKEN_VALUE_PATTERN — server reuses the same regex)
    - .planning/codebase/CONVENTIONS.md (Drizzle + explicit migration pattern; audit logs must not leak token bodies)
  </read_first>
  <action>
    1. Create `src/server/db/migrations/0011_theme_background_settings.sql`. Because `app_settings` is a KV table (`key PRIMARY KEY, value TEXT`), no DDL change is required. Seed the three new keys with idempotent INSERT OR IGNORE so a freshly restored snapshot (pre-Phase-10) gets safe defaults on boot:

       ```sql
       -- 0011: Seed theme + background keys introduced in Phase 10 (THEME-01, THEME-02).
       -- Idempotent: re-running is safe because of INSERT OR IGNORE.
       INSERT OR IGNORE INTO app_settings (key, value, updated_by_user_id, updated_at)
       VALUES
         ('activeThemeId',        '"default"',     NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
         ('customThemes',         '[]',            NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
         ('activeBackgroundKey',  'null',          NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
       ```

    2. Extend `src/server/settings.ts`:

       - Import the regex constants from the client theme module (they live in `src/client/theme/presets.ts`, which is pure TS and safe to import from the server):
         ```typescript
         import { HERMES_TOKEN_KEY_PATTERN, HERMES_TOKEN_VALUE_PATTERN, BUILT_IN_THEMES } from "../client/theme/presets";
         ```

       - Add `themeRecordSchema` (Zod) for a CUSTOM theme:
         ```typescript
         export const themeRecordSchema = z.object({
           id: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
           name: z.string().trim().min(1).max(80),
           builtIn: z.literal(false),
           tokens: z.record(
             z.string().regex(HERMES_TOKEN_KEY_PATTERN),
             z.string().regex(HERMES_TOKEN_VALUE_PATTERN),
           ).refine((map) => Object.keys(map).length <= 50, { message: "too_many_tokens" }),
         });
         ```

       - Extend `settingsSchema` with:
         ```typescript
         activeThemeId: z.string().trim().min(1).max(64).default("default"),
         customThemes: z.array(themeRecordSchema).max(20).default([]),
         activeBackgroundKey: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9._-]+$/).nullable().default(null),
         ```
         The `activeBackgroundKey` regex enforces BASENAME ONLY (no slashes, no traversal) — the streaming route will prepend the `themes/backgrounds/` prefix itself.

       - Update `defaultSettings` to include the three new fields with their defaults.

       - Add a `refine` on `settingsSchema` ensuring `activeThemeId` resolves to either a built-in id OR one of the `customThemes[].id` values. Error message code: `ungueltige_theme_aktiv_id`.

    3. Create `src/server/settings.theme.test.ts`:
       - `readSettings` on an empty DB returns defaults including `activeThemeId === "default"`, `customThemes === []`, `activeBackgroundKey === null`.
       - `settingsSchema.parse` rejects token value `"url(javascript:alert(1))"` with a Zod error.
       - `settingsSchema.parse` rejects token key `"background-image"` (not matching the `--hermes-` namespace).
       - `settingsSchema.parse` rejects an `activeBackgroundKey` of `"../hermes.sqlite"` (slashes).
       - `settingsSchema.parse` rejects `activeThemeId` that is neither built-in nor in `customThemes`.
       - `writeSettings` round-trips a valid custom theme through readSettings (JSON string stored in the `value` column, JSON parsed on read).

       Use `better-sqlite3` with an in-memory DB and run the 0001..0011 migrations the same way existing tests do. Follow the pattern in `src/server/http/app-flow.test.ts`.
  </action>
  <acceptance_criteria>
    - `rg -n "activeThemeId|customThemes|activeBackgroundKey" src/server/settings.ts` returns ≥ 6 matches.
    - `rg -n "HERMES_TOKEN_KEY_PATTERN|HERMES_TOKEN_VALUE_PATTERN" src/server/settings.ts` returns ≥ 2 matches.
    - `rg -n "INSERT OR IGNORE INTO app_settings" src/server/db/migrations/0011_theme_background_settings.sql` returns 1 match.
    - `ls src/server/db/migrations/0011_theme_background_settings.sql` exits 0.
    - `npx vitest run src/server/settings.theme.test.ts --reporter=dot` exits 0.
    - `npx tsc --noEmit` exits 0.
  </acceptance_criteria>
  <verify>
    <automated>npx tsc --noEmit && npx vitest run src/server/settings.theme.test.ts --reporter=dot</automated>
  </verify>
  <done>
    Migration file exists and is idempotent; extended settingsSchema refuses malicious tokens, cross-prefix backgrounds keys, and dangling activeThemeId references; vitest suite locks the behaviour.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add admin theme CRUD endpoints + background select endpoint with audit logging</name>
  <files>src/server/http/admin-routes.ts, src/server/http/admin-themes.test.ts</files>
  <read_first>
    - src/server/http/admin-routes.ts (router.use admin guard lines 125–139, CSRF guard lines 141–148, existing PUT /settings handler lines 794–818, audit write patterns throughout)
    - src/server/settings.ts (extended schema from Task 1, including themeRecordSchema)
    - src/server/audit-log.ts (tryWriteAuditLog signature)
    - .planning/phases/10-theme-system-and-copy-refresh/10-CONTEXT.md (D-07 audit codes; D-17 stable error codes; D-18 admin + CSRF)
    - .planning/codebase/CONVENTIONS.md (400 = invalid input with German code, 404 = not found, 409 = conflict, 201 = created, 204 = deleted; requireAdmin + requireCsrf already applied)
  </read_first>
  <action>
    Add the following routes to `createAdminRouter(context)`. Reuse the existing `router.use` admin + CSRF guards — do NOT re-check inside handlers except where noted. All writes go through `writeSettings(context, nextSettings, admin.id)` so that a single settings row update scheme is preserved; this means the handler reads current settings, mutates `customThemes`/`activeThemeId`/`activeBackgroundKey`, validates the whole object with `settingsSchema.parse`, and persists. Audit codes strictly per D-07.

    Endpoints (all under the `/api/admin` router):

    - `POST /themes` — body: `themeRecordSchema.omit({ builtIn: true })` plus a client-supplied id OR server-generated if absent. Response: `201 { theme }`. Rejects duplicate id with `409 { error: "theme_existiert_bereits" }`. Rejects attempts to shadow a built-in id with `409 { error: "theme_existiert_bereits" }`. Audit: `action: "settings_theme_updated", metadata: { op: "created", themeId }` — NO token body in metadata.

    - `PATCH /themes/:id` — body: partial `themeRecordSchema` (`name` and/or `tokens`). `404 { error: "theme_nicht_gefunden" }` if not a custom theme id. Audit: `{ op: "updated", themeId }`.

    - `DELETE /themes/:id` — if activeThemeId === :id, atomically reset activeThemeId to `"default"` in the same `writeSettings` call. `404 { error: "theme_nicht_gefunden" }` if not present. Response: `204`. Audit: `{ op: "deleted", themeId, wasActive: boolean }`.

    - `POST /themes/:id/activate` — accept either a built-in id or a custom-theme id. `404 { error: "theme_nicht_gefunden" }` otherwise. Response: `200 { settings }` (the full updated settings). Audit: `{ op: "active-changed", themeId }`.

    - `GET /backgrounds` — delegate to `listThemeBackgrounds()` from Task 3. Response: `200 { backgrounds: Array<{ key: string; contentType?: string; size?: number }> }`. Does NOT include URLs — URLs are constructed client-side from `GET /api/backgrounds/:key`. No audit (this is a read).

    - `POST /backgrounds/select` — body: `{ key: string | null }` validated with the same basename regex as `activeBackgroundKey`. If key is non-null, verify it matches a row from `listThemeBackgrounds()` before persisting (reject with `404 { error: "background_nicht_gefunden" }` otherwise). Response: `200 { settings }`. Audit: `action: "settings_background_updated", metadata: { key }`.

    Stable error codes to register: `theme_existiert_bereits`, `theme_nicht_gefunden`, `ungueltige_theme`, `background_nicht_gefunden`, `ungueltige_theme_aktiv_id`. (German, per the existing convention in admin-routes.ts.)

    Create `src/server/http/admin-themes.test.ts` with supertest coverage:
    1. Non-admin gets `403 admin_erforderlich` on each new endpoint.
    2. Missing CSRF token gets `403 csrf_token_ungueltig` (or whatever the existing code is).
    3. POST /themes with a malicious token value (e.g. `url(javascript:alert(1))`) returns `400 ungueltige_theme`.
    4. POST /themes with a token key outside the `--hermes-` namespace returns `400 ungueltige_theme`.
    5. POST /themes succeeds with a valid body, returns `201`, audit row `settings_theme_updated` exists with metadata `{ op: "created" }` and NO `tokens` key in metadata.
    6. Activate nonexistent id → `404 theme_nicht_gefunden`.
    7. Activate `"neon-cyber"` (built-in) → `200`, settings now have `activeThemeId === "neon-cyber"`.
    8. DELETE an active custom theme resets `activeThemeId` to `"default"` atomically (a single readSettings afterwards reflects both changes).
    9. POST /backgrounds/select with `{ key: "../hermes.sqlite" }` returns `400 ungueltige_settings` (Zod rejects early via the basename regex).
    10. POST /backgrounds/select with a key not in the S3 listing returns `404 background_nicht_gefunden` (stub `listThemeBackgrounds` in the test — see Task 3 for how to expose a test seam).
  </action>
  <acceptance_criteria>
    - `rg -n "\"settings_theme_updated\"" src/server/http/admin-routes.ts` returns ≥ 4 matches (created/updated/deleted/active-changed).
    - `rg -n "\"settings_background_updated\"" src/server/http/admin-routes.ts` returns 1 match.
    - `rg -n "router\.(post|patch|delete)\(['\\\"]/themes" src/server/http/admin-routes.ts` returns ≥ 4 route registrations.
    - `rg -n "listThemeBackgrounds" src/server/http/admin-routes.ts` returns ≥ 2 matches (GET + POST select).
    - `rg -n "metadata:\s*\{\s*op:" src/server/http/admin-routes.ts` — spot-check: no `tokens` appears inside any theme audit metadata.
    - `npx vitest run src/server/http/admin-themes.test.ts --reporter=dot` exits 0.
  </acceptance_criteria>
  <verify>
    <automated>npx vitest run src/server/http/admin-themes.test.ts --reporter=dot</automated>
  </verify>
  <done>
    All five admin endpoints exist with stable error codes, audit writes use the D-07 code set without leaking token bodies, and the supertest suite pins behaviour.
  </done>
</task>

<task type="auto">
  <name>Task 3: Add listThemeBackgrounds + getThemeBackgroundStream helpers and mount /api/backgrounds streaming route</name>
  <files>src/server/storage/s3-storage.ts, src/server/http/background-routes.ts, src/server/app.ts, src/server/http/backgrounds.test.ts</files>
  <read_first>
    - src/server/storage/s3-storage.ts (createS3Client, readS3Config, ListObjectsV2Command usage in cleanupOldRecoveries as a reference; restorableTables / snapshot keys — these MUST NOT leak through the new helpers)
    - src/server/app.ts (router wiring pattern — e.g. `app.use("/api/push", createPushRouter(context))`)
    - src/server/auth/current-user.ts (requireUser — the public-ish endpoint still requires an authenticated session, since Hermes has no anonymous pages in scope)
    - .planning/phases/10-theme-system-and-copy-refresh/10-CONTEXT.md (D-08, D-10, D-12)
  </read_first>
  <action>
    1. Add to `src/server/storage/s3-storage.ts`:

       ```typescript
       export const THEME_BACKGROUND_PREFIX = "themes/backgrounds/";
       export const THEME_BACKGROUND_KEY_PATTERN = /^[a-zA-Z0-9._-]+$/;

       export type ThemeBackgroundEntry = {
         key: string;          // basename only, no prefix
         size?: number;
         contentType?: string; // inferred from extension
         lastModified?: string;
       };

       export async function listThemeBackgrounds(): Promise<ThemeBackgroundEntry[]> {
         if (!isS3StorageEnabled()) return [];              // D-12
         try {
           const { bucket, client } = createS3Client();
           const result = await client.send(new ListObjectsV2Command({
             Bucket: bucket,
             Prefix: THEME_BACKGROUND_PREFIX,               // D-08 — locked to Hermes prefix
             MaxKeys: 100,
           }));
           return (result.Contents ?? [])
             .filter((entry) => entry.Key?.startsWith(THEME_BACKGROUND_PREFIX))
             .map((entry) => ({
               key: (entry.Key as string).slice(THEME_BACKGROUND_PREFIX.length),
               size: entry.Size,
               lastModified: entry.LastModified?.toISOString(),
               contentType: inferContentType(entry.Key as string),
             }))
             .filter((entry) => entry.key.length > 0 && THEME_BACKGROUND_KEY_PATTERN.test(entry.key));
         } catch (error) {
           console.error("[Hermes] Failed to list theme backgrounds", error);
           return [];                                        // D-12 — empty-state fallback
         }
       }

       export async function getThemeBackgroundStream(key: string): Promise<
         | { body: NodeJS.ReadableStream; contentType: string; contentLength?: number }
         | null
       > {
         if (!THEME_BACKGROUND_KEY_PATTERN.test(key)) return null;   // reject traversal
         if (!isS3StorageEnabled()) return null;
         const { bucket, client } = createS3Client();
         try {
           const result = await client.send(new GetObjectCommand({
             Bucket: bucket,
             Key: `${THEME_BACKGROUND_PREFIX}${key}`,                 // hard-coded prefix
           }));
           if (!result.Body) return null;
           return {
             body: result.Body as NodeJS.ReadableStream,
             contentType: result.ContentType ?? inferContentType(key),
             contentLength: typeof result.ContentLength === "number" ? result.ContentLength : undefined,
           };
         } catch (error) {
           if ((error as { name?: string } | null)?.name === "NoSuchKey") return null;
           throw error;
         }
       }
       ```

       Add a small `inferContentType(key)` helper for the common extensions (`.jpg|.jpeg` → `image/jpeg`, `.png` → `image/png`, `.webp` → `image/webp`, `.avif` → `image/avif`; fallback `application/octet-stream`).

       For the admin test seam: export a `__setThemeBackgroundLister(fn)` or a named factory (`createThemeBackgroundsApi`) that tests can override. Simplest: export the helpers as above and in the admin route use `import * as storage from "../storage/s3-storage"` + vitest `vi.spyOn(storage, "listThemeBackgrounds")`. No new test hook file is needed.

    2. Create `src/server/http/background-routes.ts`:

       ```typescript
       import { Router } from "express";
       import type { DatabaseContext } from "../db/client";
       import { requireUser } from "../auth/current-user";
       import { getThemeBackgroundStream, THEME_BACKGROUND_KEY_PATTERN } from "../storage/s3-storage";

       export function createBackgroundRouter(context: DatabaseContext) {
         const router = Router();

         router.get("/:key", async (request, response) => {
           // Require auth — Hermes has no anonymous surface for backgrounds; every app user is signed in.
           const user = requireUser(context, request);
           if (!user) { response.status(401).json({ error: "nicht_angemeldet" }); return; }

           const key = String(request.params.key ?? "");
           if (!THEME_BACKGROUND_KEY_PATTERN.test(key)) {
             response.status(400).json({ error: "ungueltiger_hintergrund" });
             return;
           }

           try {
             const result = await getThemeBackgroundStream(key);
             if (!result) { response.status(404).json({ error: "background_nicht_gefunden" }); return; }
             response.setHeader("Content-Type", result.contentType);
             if (typeof result.contentLength === "number") {
               response.setHeader("Content-Length", String(result.contentLength));
             }
             response.setHeader("Cache-Control", "private, max-age=3600");
             result.body.pipe(response);
           } catch (error) {
             console.error("[Hermes] Failed to stream theme background", error);
             response.status(502).json({ error: "hintergrund_unverfuegbar" });
           }
         });

         return router;
       }
       ```

    3. Mount in `src/server/app.ts` alongside existing routers (e.g. `app.use("/api/backgrounds", createBackgroundRouter(context))`). Follow the existing import-and-use style — read the file first and slot the mount next to `/api/push`.

    4. Create `src/server/http/backgrounds.test.ts`:
       - Anonymous GET → 401 `nicht_angemeldet`.
       - Key with `/` → 400 `ungueltiger_hintergrund`.
       - Key with `..` → 400 `ungueltiger_hintergrund`.
       - When S3 is disabled (default in tests) → 404 `background_nicht_gefunden`.
       - With a mocked `getThemeBackgroundStream` returning a ReadableStream → 200 with `Content-Type: image/jpeg`, body matches mock bytes.
       - `listThemeBackgrounds` returns `[]` when S3 is disabled (no env vars).
       - `listThemeBackgrounds` filters out any key whose basename contains a slash or traversal after the prefix.

    Use `vi.mock` or a spy on the `s3-storage` module for the streaming test — do NOT hit real S3.

    Security guardrails enforced by this task:
    - `THEME_BACKGROUND_PREFIX` is hard-coded; no caller can alter it. (Mitigates T-10-05 SSRF-ish listing of snapshot/recovery keys.)
    - `THEME_BACKGROUND_KEY_PATTERN` rejects any `/`, `..`, or URL-encoded characters. (Mitigates path traversal.)
    - The streaming route does not accept a `url` or `prefix` body parameter anywhere. (Forecloses the deferred custom-URL SSRF vector from CONTEXT.)
  </action>
  <acceptance_criteria>
    - `rg -n "THEME_BACKGROUND_PREFIX\s*=\s*\"themes/backgrounds/\"" src/server/storage/s3-storage.ts` returns 1 match.
    - `rg -n "export (async )?function (listThemeBackgrounds|getThemeBackgroundStream)" src/server/storage/s3-storage.ts` returns 2 matches.
    - `rg -n "createBackgroundRouter" src/server/app.ts` returns ≥ 1 match (import + mount).
    - `rg -n "app\.use\(\"/api/backgrounds\"" src/server/app.ts` returns 1 match.
    - `rg -n "restorableTables|recoveries/|hermes\\.sqlite" src/server/http/background-routes.ts` returns 0 matches (sensitive keys never reachable from this router).
    - `npx vitest run src/server/http/backgrounds.test.ts --reporter=dot` exits 0.
  </acceptance_criteria>
  <verify>
    <automated>npx vitest run src/server/http/backgrounds.test.ts --reporter=dot && npx tsc --noEmit</automated>
  </verify>
  <done>
    Listing and streaming helpers are prefix-locked, the public-signed-in router is mounted, and vitest proves traversal + unauth paths fail.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| admin client → admin-routes | Untrusted JSON theme body crosses here; must be validated by Zod before reaching DB or DOM. |
| admin-routes → S3 ListObjects | Bucket contains sensitive keys (snapshot, recoveries/); listing must be prefix-locked. |
| signed-in client → /api/backgrounds/:key | Path parameter crosses here; must reject `/`, `..`, and URL-encoded traversal. |
| admin audit → admin-routes response | Audit metadata could leak theme tokens; must record only `{ op, themeId }`. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-05 | Information Disclosure (SSRF-adjacent) | `listThemeBackgrounds` over the whole bucket | mitigate | Helper hard-codes `THEME_BACKGROUND_PREFIX = "themes/backgrounds/"` in the `ListObjectsV2Command`, then re-filters results to ensure `key.startsWith(prefix)`; snapshot keys (`hermes.sqlite`, `recoveries/…`) are therefore unreachable. Test `backgrounds.test.ts` asserts cross-prefix keys are filtered out. |
| T-10-06 | Tampering / Path Traversal | `/api/backgrounds/:key` | mitigate | Handler validates `:key` against `THEME_BACKGROUND_KEY_PATTERN = /^[a-zA-Z0-9._-]+$/` BEFORE any S3 call; helper reapplies the same check. |
| T-10-07 | Elevation of Privilege | Admin theme CRUD endpoints | mitigate | Routes live under `createAdminRouter`, which already chains `requireUser` → admin-role check → `requireCsrf`. No handler skips these guards. Test `admin-themes.test.ts` verifies 401/403 for non-admin and missing-CSRF cases. |
| T-10-08 | Spoofing / Stored XSS-via-CSS | `customThemes[].tokens` persisted in settings | mitigate | `themeRecordSchema` enforces `HERMES_TOKEN_KEY_PATTERN` (`--hermes-*` only) and `HERMES_TOKEN_VALUE_PATTERN` (rejects `url(`, `expression(`, `javascript:`, `<>`, quotes, `;`, `\`, comments, length > 200). The client (plan 10-01) reapplies the same regex as defence in depth. |
| T-10-09 | Information Disclosure (logs) | Audit metadata for theme mutations | mitigate | All theme-mutation audits use `metadata: { op, themeId }` only. Reviewer check in acceptance_criteria: no `tokens` key appears in any theme audit write. |
| T-10-10 | Tampering | `activeThemeId` pointing to a deleted theme | mitigate | `settingsSchema` refines that `activeThemeId` must be a built-in id OR in `customThemes`; DELETE handler atomically resets to `"default"` if the active theme is removed. |
| T-10-11 | SSRF via custom background URL | N/A — DEFERRED in CONTEXT | transfer | Custom-URL upload is deferred (D-10). This plan exposes NO endpoint that accepts an arbitrary URL; only S3 bucket listing behind a hard-coded prefix. Flagged here so downstream phases do not reintroduce the vector without reopening this row. |
| T-10-12 | Denial of Service | Unbounded customThemes array | mitigate | `settingsSchema` caps `customThemes` at 20 entries and each theme at 50 tokens; Zod rejects beyond. |
| T-10-13 | Tampering | Snapshot restore overwrites Phase-10 settings with pre-Phase-10 JSON | mitigate | Migration 0011 uses `INSERT OR IGNORE` at boot time, so a restored pre-Phase-10 snapshot gains safe defaults on the next `runMigrations()`; `settingsSchema` defaults also backfill at read time. |
</threat_model>

<verification_criteria>
- All three vitest suites created in this plan pass.
- `npx tsc --noEmit` is clean.
- `npm test` stays green overall (plan does not touch event/OTP logic).
- A manual curl against `/api/admin/backgrounds` as a non-admin returns 403; as an admin with no S3 configured returns `{ backgrounds: [] }`.
</verification_criteria>

<success_criteria>
- Migration 0011 exists and is idempotent.
- `settingsSchema` accepts the three new fields with default values and rejects every malicious input exercised by the test suite.
- Admin router has the full theme CRUD set + background listing + background select, every mutation emits exactly one audit row using the D-07 codes without leaking token bodies.
- `/api/backgrounds/:key` streams only from `themes/backgrounds/` and rejects traversal.
- No code path in this plan reads from or lists snapshot/recovery keys.
</success_criteria>

<output>
After completion, create `.planning/phases/10-theme-system-and-copy-refresh/10-02-SUMMARY.md` recording:
- Final Zod schema signatures for `themeRecordSchema` and `settingsSchema`
- The exact route table added (method, path, error codes, audit code)
- Mock/spy pattern used in the vitest suites so plan 10-04's client tests can reuse it
</output>
