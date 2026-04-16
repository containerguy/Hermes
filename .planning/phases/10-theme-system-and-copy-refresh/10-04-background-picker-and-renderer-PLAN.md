---
phase: 10-theme-system-and-copy-refresh
plan: 04
type: execute
wave: 3
depends_on: ["10-01", "10-02", "10-03"]
files_modified:
  - src/client/components/themes/BackgroundPicker.tsx
  - src/client/components/AdminPanel.tsx
  - src/main.tsx
  - src/styles.css
  - src/client/components/themes/BackgroundPicker.test.tsx
autonomous: true
requirements: [THEME-02]
tags: [backgrounds, admin-ui, readability-overlay]

must_haves:
  truths:
    - "Admin can list and select a background from the S3 `themes/backgrounds/` prefix in AdminPanel; selection persists across reloads."
    - "With a background selected, the app shell renders a fixed full-viewport image layer with a readability overlay (contrast/blur as needed); without one, the app falls back to the current solid-color background."
    - "If /api/admin/backgrounds returns an empty array, the picker shows a clear empty state and no request is made for image bytes (D-12)."
    - "The client never fetches a background key that contains `/`, `..`, or any character outside `[a-zA-Z0-9._-]`."
  artifacts:
    - path: "src/client/components/themes/BackgroundPicker.tsx"
      provides: "Admin UI listing backgrounds as thumbnails and POSTing selections; exports BackgroundPicker"
      exports: ["BackgroundPicker"]
    - path: "src/client/components/AdminPanel.tsx"
      provides: "New \"background\" AdminSection rendering BackgroundPicker"
      contains: "BackgroundPicker"
    - path: "src/main.tsx"
      provides: "Fixed .app-background layer rendered from settings.activeBackgroundKey with a readability overlay"
      contains: "app-background"
    - path: "src/styles.css"
      provides: "Rules for .app-background, .app-background-overlay, .background-picker-grid"
      contains: ".app-background"
  key_links:
    - from: "src/main.tsx"
      to: "/api/backgrounds/:key"
      via: "background-image url() referencing the streaming route mounted by plan 10-02"
      pattern: "/api/backgrounds/"
    - from: "src/client/components/AdminPanel.tsx"
      to: "src/client/components/themes/BackgroundPicker.tsx"
      via: "import + render"
      pattern: "BackgroundPicker"
    - from: "src/client/components/themes/BackgroundPicker.tsx"
      to: "/api/admin/backgrounds"
      via: "requestJson GET + POST /select"
      pattern: "/api/admin/backgrounds"
---

<objective>
Ship the admin-facing background picker and the client-side background renderer for THEME-02: list S3 presets, let admins pick one, render it full-viewport behind the shell, and keep text readable with an overlay.

Purpose: D-08/D-09/D-11/D-12. All backend listing/streaming already exists (plan 10-02). This plan is the client surface only.

Output: one new component, one new vitest suite, a new AdminPanel section, a small CSS addition, and a handful of JSX lines in `src/main.tsx` for the background layer.
</objective>

<execution_context>
@AGENTS.md
@.planning/codebase/CONVENTIONS.md
@.planning/codebase/CONCERNS.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/10-theme-system-and-copy-refresh/10-CONTEXT.md
@.planning/phases/10-theme-system-and-copy-refresh/10-02-settings-endpoints-and-s3-listing-PLAN.md
@.planning/phases/10-theme-system-and-copy-refresh/10-03-admin-theme-editor-ui-PLAN.md
@src/client/components/AdminPanel.tsx
@src/main.tsx
@src/client/types/core.ts

<interfaces>
<!-- From plan 10-02: -->
GET  /api/admin/backgrounds         -> 200 { backgrounds: Array<{ key: string; size?: number; contentType?: string; lastModified?: string }> }
POST /api/admin/backgrounds/select  -> 200 { settings } ; body: { key: string | null }
GET  /api/backgrounds/:key          -> 200 image/* (signed-in only)
// Key pattern: /^[a-zA-Z0-9._-]+$/ — no slashes, no traversal. Server re-validates.

<!-- From plan 10-01: -->
AppSettings now carries activeBackgroundKey: string | null
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Build the BackgroundPicker component</name>
  <files>src/client/components/themes/BackgroundPicker.tsx</files>
  <read_first>
    - src/client/components/themes/ThemeEditor.tsx (from plan 10-03 — mirror the component structure, requestJson usage, and error mapping)
    - src/client/api/request.ts (requestJson signature + CSRF behaviour)
    - .planning/phases/10-theme-system-and-copy-refresh/10-CONTEXT.md (D-08, D-09, D-12)
  </read_first>
  <action>
    Create `src/client/components/themes/BackgroundPicker.tsx` exporting:

    ```typescript
    export function BackgroundPicker({
      settings,
      onSettingsChanged,
    }: {
      settings: AppSettings;
      onSettingsChanged: (settings: AppSettings) => void;
    }): JSX.Element
    ```

    Behaviour:

    1. On mount: `requestJson<{ backgrounds: Array<{ key: string; contentType?: string; size?: number }> }>("/api/admin/backgrounds")`. Store the list in local state. While loading show a neutral placeholder; on error display `getErrorMessage(code)`.

    2. Client-side filter: DROP any entry whose `key` does not match `/^[a-zA-Z0-9._-]+$/` before rendering. (Defense in depth — the server should not return such entries, but the UI must not render a broken `<img>` even if the server regresses.)

    3. Render:
       - A grid of thumbnail cards, one per entry. Thumbnail `<img src={"/api/backgrounds/" + key} alt={key} loading="lazy" />`. Each card has a "Auswählen" button that calls `POST /api/admin/backgrounds/select` with `{ key }` and, on success, calls `onSettingsChanged(result.settings)`.
       - An explicit "Kein Hintergrund" card (always first) whose button posts `{ key: null }` — lets an admin revert to the default solid background.
       - The currently active card is highlighted via `aria-current="true"` and a `.is-active` className (match the pattern from plan 10-03's ThemeEditor).

    4. Empty state: when the list is empty, render a short German message — voice-aligned with COPY-01 ("Noch keine Hintergründe im S3-Bucket unter `themes/backgrounds/`."). No placeholder thumbnails, no network calls for image bytes.

    5. Do NOT construct URLs from user input. The only URL built is `/api/backgrounds/${encodeURIComponent(key)}` AND only after the client regex check passes.

    6. Do NOT call `applyTheme` here — background is not a theme token. The renderer in `src/main.tsx` (Task 3) reads `settings.activeBackgroundKey` directly.

    7. No new dependencies. No CSS-in-JS. Plain className usage only.
  </action>
  <acceptance_criteria>
    - `rg -n "export function BackgroundPicker" src/client/components/themes/BackgroundPicker.tsx` returns 1 match.
    - `rg -n "/api/admin/backgrounds" src/client/components/themes/BackgroundPicker.tsx` returns ≥ 2 matches (GET + /select).
    - `rg -n "/api/backgrounds/" src/client/components/themes/BackgroundPicker.tsx` returns ≥ 1 match (thumbnail src).
    - `rg -n "\\[a-zA-Z0-9\\._-\\]" src/client/components/themes/BackgroundPicker.tsx` returns ≥ 1 match (the client-side filter regex).
    - `rg -n "Noch keine Hintergr" src/client/components/themes/BackgroundPicker.tsx` returns 1 match (empty state copy).
    - `rg -n "tailwind|@mui|styled-components" src/client/components/themes/BackgroundPicker.tsx` returns 0 matches.
    - `npx tsc --noEmit` exits 0.
  </acceptance_criteria>
  <verify>
    <automated>MISSING — Wave 0 test scaffold: create src/client/components/themes/BackgroundPicker.test.tsx (Task 4 below). Run: npx vitest run src/client/components/themes/BackgroundPicker.test.tsx --reporter=dot</automated>
  </verify>
  <done>
    BackgroundPicker renders a grid from /api/admin/backgrounds, enforces the client-side key regex, posts selections, and handles the empty state; tsc clean.
  </done>
</task>

<task type="auto">
  <name>Task 2: Mount BackgroundPicker in AdminPanel under a new "background" section</name>
  <files>src/client/components/AdminPanel.tsx</files>
  <read_first>
    - src/client/components/AdminPanel.tsx (after plan 10-03 applied — the AdminSection union already includes "themes"; this task adds "background")
    - .planning/phases/10-theme-system-and-copy-refresh/10-03-SUMMARY.md (the summary written at end of plan 10-03 — it documents how the "themes" entry was added)
  </read_first>
  <action>
    Edit `src/client/components/AdminPanel.tsx`:

    1. Extend `type AdminSection` with `"background"`.
    2. Add a nav entry for "Hintergrund" mirroring the "Themes" entry added in plan 10-03.
    3. In the section-render switch, when `activeSection === "background"`, render:
       ```tsx
       <BackgroundPicker settings={settings} onSettingsChanged={(next) => {
         setSettings(next);
         onSettingsChanged(next);
       }} />
       ```
    4. Import `BackgroundPicker` from `./themes/BackgroundPicker`.
    5. Do NOT touch the "themes" section from plan 10-03 beyond adding the sibling "background" entry.
    6. AdminPanel net growth target: ≤ 20 lines over plan 10-03.
  </action>
  <acceptance_criteria>
    - `rg -n "type AdminSection = .*\"background\"" src/client/components/AdminPanel.tsx` returns 1 match.
    - `rg -n "import.*BackgroundPicker.*from\s+['\\\"]\\./themes/BackgroundPicker['\\\"]" src/client/components/AdminPanel.tsx` returns 1 match.
    - `rg -n "<BackgroundPicker" src/client/components/AdminPanel.tsx` returns 1 match.
    - `npx tsc --noEmit` exits 0.
    - `npm run build` succeeds.
  </acceptance_criteria>
  <verify>
    <automated>npx tsc --noEmit && npm run build >/tmp/bg-build.log 2>&1 ; grep -Eq "error|Error" /tmp/bg-build.log && { echo 'build error'; exit 1; } || echo ok</automated>
  </verify>
  <done>
    AdminPanel has a "Hintergrund" section that renders BackgroundPicker; prior "themes" section still works.
  </done>
</task>

<task type="auto">
  <name>Task 3: Render the background layer + readability overlay from src/main.tsx</name>
  <files>src/main.tsx, src/styles.css</files>
  <read_first>
    - src/main.tsx (the App component shell at lines 210–237 — the background layer attaches at the top-level `<main className="app-shell ...">`)
    - src/styles.css (existing body background gradient at lines 28–34 — the new rules layer on top without replacing it)
    - .planning/phases/10-theme-system-and-copy-refresh/10-CONTEXT.md (D-11 readability; D-12 fallback)
  </read_first>
  <action>
    1. In `src/main.tsx`, inside the top-level `<main className={"app-shell page-" + activePage}>`, conditionally render an `.app-background` layer ABOVE the existing header + content:

       ```tsx
       {appSettings.activeBackgroundKey ? (
         <>
           <div
             className="app-background"
             aria-hidden="true"
             style={{ backgroundImage: `url("/api/backgrounds/${encodeURIComponent(appSettings.activeBackgroundKey)}")` }}
           />
           <div className="app-background-overlay" aria-hidden="true" />
         </>
       ) : null}
       ```

       Client-side re-validate `appSettings.activeBackgroundKey` against `/^[a-zA-Z0-9._-]+$/` before rendering. If it does not match, render null (fallback to solid background — D-12). Do not log or alert; just silently fall back.

    2. In `src/styles.css`, add:

       ```css
       .app-background {
         position: fixed;
         inset: 0;
         z-index: -2;
         background-size: cover;
         background-position: center;
         background-repeat: no-repeat;
         background-color: var(--hermes-color-surface);
         pointer-events: none;
       }

       .app-background-overlay {
         position: fixed;
         inset: 0;
         z-index: -1;
         pointer-events: none;
         background: linear-gradient(
           180deg,
           color-mix(in srgb, var(--hermes-color-surface) 60%, transparent) 0%,
           color-mix(in srgb, var(--hermes-color-surface) 75%, transparent) 100%
         );
         backdrop-filter: saturate(0.9) blur(0.5px);
       }

       @supports not (color: color-mix(in srgb, red, blue)) {
         .app-background-overlay { background: rgba(246, 248, 244, 0.7); }
       }

       @media (prefers-reduced-transparency: reduce) {
         .app-background-overlay { background: var(--hermes-color-surface); }
         .app-background { display: none; }
       }
       ```

       These rules consume `--hermes-*` tokens only (plan 10-01). They coexist with the existing `body` gradient: the body gradient remains the fallback when `activeBackgroundKey` is null; with a background selected, `.app-background` sits behind everything and the overlay preserves readability.

    3. No changes to how settings are fetched — `src/main.tsx` already calls `/api/settings` on mount (line 142–148), and the server plan 10-02 ensures `/api/settings` includes `activeBackgroundKey`. Confirm this is true before shipping by reading `src/server/http/settings-routes.ts` (or wherever the public settings route lives); if that endpoint currently strips unknown keys, add `activeBackgroundKey` to its exposed fields. (Expected: `readSettings` already returns the full HermesSettings including the new field, so this is a read-only confirmation, not a code change — but verify.)
  </action>
  <acceptance_criteria>
    - `rg -n "app-background" src/main.tsx` returns ≥ 2 matches (div className + encoded URL template).
    - `rg -n "encodeURIComponent\(appSettings\.activeBackgroundKey\)" src/main.tsx` returns 1 match.
    - `rg -n "\\[a-zA-Z0-9\\._-\\]" src/main.tsx` returns ≥ 1 match (client-side re-validation).
    - `rg -n "\\.app-background\\s*\\{" src/styles.css` returns 1 match.
    - `rg -n "\\.app-background-overlay\\s*\\{" src/styles.css` returns 1 match.
    - `rg -n "prefers-reduced-transparency" src/styles.css` returns 1 match.
    - `rg -n "var\\(--hermes-color-surface\\)" src/styles.css | wc -l` returns ≥ 2 (overlay uses hermes tokens).
    - `wc -l src/main.tsx` reports ≤ pre-task + 20 lines (bloat guardrail).
    - `npx tsc --noEmit` exits 0 and `npm run build` succeeds.
  </acceptance_criteria>
  <verify>
    <automated>npx tsc --noEmit && npm run build >/tmp/bg-render.log 2>&1 ; grep -Eq "error|Error" /tmp/bg-render.log && { echo 'build error'; exit 1; } || echo ok</automated>
  </verify>
  <done>
    With a selected background, the app renders a fixed image behind the shell and a readability overlay; without one, the old body gradient still shows; reduced-transparency users get a flat fallback.
  </done>
</task>

<task type="auto">
  <name>Task 4: Vitest suite for BackgroundPicker (empty state, traversal rejection, activate flow)</name>
  <files>src/client/components/themes/BackgroundPicker.test.tsx</files>
  <read_first>
    - src/client/components/ui-correctness.test.tsx (vitest + @testing-library/react style)
    - src/client/components/themes/ThemeEditor.test.tsx (from plan 10-03 — reuse the fetch-stubbing approach)
  </read_first>
  <action>
    Create `src/client/components/themes/BackgroundPicker.test.tsx` with these cases:

    1. **Empty state**: stub fetch so `GET /api/admin/backgrounds` returns `{ backgrounds: [] }`. Mount the picker. Assert the empty-state copy "Noch keine Hintergründe im S3-Bucket unter `themes/backgrounds/`." appears AND no `/api/backgrounds/…` thumbnail request is made.

    2. **Server returns a malicious key**: stub fetch so `/api/admin/backgrounds` returns `{ backgrounds: [{ key: "../hermes.sqlite" }, { key: "valid.jpg" }] }`. Mount the picker. Assert only the `valid.jpg` thumbnail is rendered; `../hermes.sqlite` is filtered out and NO `<img>` with that src exists in the DOM. (This test pins the client-side defence-in-depth for T-10-06.)

    3. **Activate flow**: stub fetch so listing returns `[{ key: "night.jpg" }]`. Click the "Auswählen" button. Assert a `POST /api/admin/backgrounds/select` with body `{ key: "night.jpg" }` is issued, and on success `onSettingsChanged` is called with the response's `settings`.

    4. **Clear selection**: stub fetch so listing returns `[{ key: "night.jpg" }]` and settings are seeded with `activeBackgroundKey: "night.jpg"`. Click "Kein Hintergrund". Assert a `POST /api/admin/backgrounds/select` with body `{ key: null }` is issued.

    Use `vi.fn()` for `window.fetch`. Assert requests using `fetch.mock.calls` or via a small helper that records body + url.
  </action>
  <acceptance_criteria>
    - `rg -n "activeBackgroundKey" src/client/components/themes/BackgroundPicker.test.tsx` returns ≥ 1 match.
    - `rg -n "\"../hermes.sqlite\"|\\.\\./hermes\\.sqlite" src/client/components/themes/BackgroundPicker.test.tsx` returns ≥ 1 match (the traversal test case).
    - `rg -n "\"key\":\\s*null|key: null" src/client/components/themes/BackgroundPicker.test.tsx` returns ≥ 1 match (the clear-selection test case).
    - `npx vitest run src/client/components/themes/BackgroundPicker.test.tsx --reporter=dot` exits 0.
  </acceptance_criteria>
  <verify>
    <automated>npx vitest run src/client/components/themes/BackgroundPicker.test.tsx --reporter=dot</automated>
  </verify>
  <done>
    Vitest suite pins empty state, traversal filtering, activate, and clear.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Admin client → /api/admin/backgrounds | Trusted after admin + CSRF guard (plan 10-02); no new boundary. |
| `settings.activeBackgroundKey` → background-image URL in main.tsx | Untrusted value (could be tampered via DB restore); must be validated client-side before rendering. |
| Server-returned background key → `<img src>` in BackgroundPicker | Server is trusted but the UI still validates to survive regressions. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-18 | Tampering / Path Traversal | `<img src="/api/backgrounds/…">` interpolation in main.tsx and BackgroundPicker | mitigate | Both call sites regex-check `activeBackgroundKey` / listing entries against `/^[a-zA-Z0-9._-]+$/` and `encodeURIComponent` the value before interpolation. Server endpoint (plan 10-02) rejects at 400 if traversal still reaches it. |
| T-10-19 | Information Disclosure | `<img>` 404/500 network logs could leak internal key names | accept | Browsers log 404s but the key space is limited to safe basenames; no secret is ever in a background key. |
| T-10-20 | Denial of Service | Large background images | mitigate | S3-managed; `loading="lazy"` on thumbnails; overall picker pulls only the MaxKeys=100 list from plan 10-02. |
| T-10-21 | Availability | S3 offline / empty bucket | mitigate | BackgroundPicker renders empty-state copy; main.tsx renders no background layer when key is null; body gradient remains the fallback. Test case 1 pins this. |
| T-10-22 | Accessibility regression | Overlay reduces contrast of text above the background | mitigate | Overlay uses `color-mix(in srgb, var(--hermes-color-surface) 60-75%, transparent)` and a `prefers-reduced-transparency` media query falls back to a solid surface color. Theme activation does not depend on the background layer. |
</threat_model>

<verification_criteria>
- `npx vitest run src/client/components/themes/BackgroundPicker.test.tsx` passes.
- `npx tsc --noEmit` is clean.
- `npm run build` succeeds.
- Manual: picking a background in AdminPanel renders it immediately as a fixed full-viewport image; clearing the selection returns to the default look; reduced-transparency OS setting falls back to a solid surface.
</verification_criteria>

<success_criteria>
- AdminPanel has a "Hintergrund" section with thumbnails, empty state, and active marker.
- main.tsx renders `.app-background` + `.app-background-overlay` from `settings.activeBackgroundKey`, with client-side key validation.
- Overlay preserves readability (confirmed by the reduced-transparency media query + contrast-aware `color-mix`).
- Vitest suite pins empty state, traversal filtering, activate, and clear flows.
</success_criteria>

<output>
After completion, create `.planning/phases/10-theme-system-and-copy-refresh/10-04-SUMMARY.md` noting:
- The final AdminPanel section order (for plan 10-05's copy sweep to reference correctly)
- The overlay's tuning values (opacity, blur) — so a future THEME-03 AI generation pipeline can aim its output luminance accordingly
</output>
