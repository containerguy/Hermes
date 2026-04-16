---
phase: 10-theme-system-and-copy-refresh
plan: 03
type: execute
wave: 2
depends_on: ["10-01", "10-02"]
files_modified:
  - src/client/components/themes/ThemeEditor.tsx
  - src/client/components/AdminPanel.tsx
  - src/styles.css
  - src/client/components/themes/ThemeEditor.test.tsx
autonomous: true
requirements: [THEME-01]
tags: [admin-ui, theme-editor, live-preview]

must_haves:
  truths:
    - "AdminPanel has a new \"Themes\" section listing built-in and custom themes and letting an admin activate any of them."
    - "Admin can create and edit a custom theme via a token editor and see a live preview applied to a sandboxed area before committing."
    - "On commit, the custom theme is persisted via /api/admin/themes and subsequent reloads show the same theme (covered by the integration test)."
    - "Invalid token values (e.g. `url(javascript:...)`) are rejected client-side with an inline error before any request fires — matching the server regex from plan 10-02."
  artifacts:
    - path: "src/client/components/themes/ThemeEditor.tsx"
      provides: "Theme list + token editor component rendering BUILT_IN_THEMES and custom themes, with live preview + save/activate/delete affordances"
      exports: ["ThemeEditor"]
    - path: "src/client/components/AdminPanel.tsx"
      provides: "New \"themes\" AdminSection that mounts ThemeEditor; extended local defaultSettings including the Phase-10 fields"
      contains: "ThemeEditor"
    - path: "src/styles.css"
      provides: "Minimal layout styles for .theme-editor, .theme-preset-card, .theme-token-grid (uses existing --hermes-* tokens)"
      contains: ".theme-editor"
  key_links:
    - from: "src/client/components/AdminPanel.tsx"
      to: "src/client/components/themes/ThemeEditor.tsx"
      via: "import + render inside a new AdminSection"
      pattern: "ThemeEditor"
    - from: "src/client/components/themes/ThemeEditor.tsx"
      to: "src/client/theme/applyTheme.ts"
      via: "applyTheme({ settings, theme: draft }) for live preview"
      pattern: "applyTheme\\("
    - from: "src/client/components/themes/ThemeEditor.tsx"
      to: "/api/admin/themes"
      via: "requestJson POST/PATCH/DELETE/activate"
      pattern: "/api/admin/themes"
---

<objective>
Put a Theme Editor inside AdminPanel. Admins browse built-in and custom themes, edit CSS tokens with a live preview, and persist their selection through the admin endpoints shipped in plan 10-02.

Purpose: D-01/D-05/D-06 — client-side activation with live preview, editor hosted in AdminPanel, no page reload. This plan is intentionally scoped to THEME-01 (theme editing). Background selection lives in 10-04, copy refresh in 10-05.

Output: one new component file, one new vitest suite, a new AdminPanel section, and a small CSS addition consuming only the existing `--hermes-*` tokens from plan 10-01.
</objective>

<execution_context>
@AGENTS.md
@.planning/codebase/CONVENTIONS.md
@.planning/codebase/CONCERNS.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/10-theme-system-and-copy-refresh/10-CONTEXT.md
@.planning/phases/10-theme-system-and-copy-refresh/10-01-theme-tokens-and-presets-PLAN.md
@.planning/phases/10-theme-system-and-copy-refresh/10-02-settings-endpoints-and-s3-listing-PLAN.md
@src/client/components/AdminPanel.tsx
@src/client/theme/presets.ts
@src/client/theme/applyTheme.ts
@src/client/types/core.ts

<interfaces>
<!-- From plan 10-01 (ships in wave 1): -->
BUILT_IN_THEMES: readonly HermesTheme[]
type HermesTheme = { id: string; name: string; builtIn: boolean; tokens: Record<string, string> }
HERMES_TOKEN_KEY_PATTERN, HERMES_TOKEN_VALUE_PATTERN
applyTheme({ settings: AppSettings; theme?: HermesTheme }): void
resolveActiveTheme(settings: AppSettings): HermesTheme

<!-- From plan 10-02 (ships in wave 1): -->
POST   /api/admin/themes                 -> 201 { theme }
PATCH  /api/admin/themes/:id             -> 200 { theme }
DELETE /api/admin/themes/:id             -> 204
POST   /api/admin/themes/:id/activate    -> 200 { settings }
// All require admin role + CSRF header; requestJson already includes credentials + CSRF.
// Stable error codes: theme_existiert_bereits, theme_nicht_gefunden, ungueltige_theme.

<!-- From src/client/components/AdminPanel.tsx (current): -->
type AdminSection = "users" | "settings" | "storage" | "rateLimits" | "invites" | "audit"
// This plan extends the union with "themes" and adds a left-nav entry + section body.
// Existing `settings` section handles legacy theme colour fields — do NOT delete it; it still controls
// the legacy --teal/--rose/--amber/--blue/--surface surface used by parts of styles.css.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Build the ThemeEditor component with live preview and client-side validation</name>
  <files>src/client/components/themes/ThemeEditor.tsx</files>
  <read_first>
    - src/client/components/AdminPanel.tsx (how existing sections are composed, how requestJson + ApiError + getErrorMessage are used)
    - src/client/api/request.ts (requestJson signature — sends CSRF header automatically)
    - src/client/errors/errors.ts (error-code mapping — no new UI-facing error messages needed if codes are already there, but new codes from 10-02 should be added here in this task)
    - src/client/theme/applyTheme.ts + src/client/theme/presets.ts (from plan 10-01)
    - .planning/phases/10-theme-system-and-copy-refresh/10-CONTEXT.md (D-05 live preview, D-07 audit — client is not involved in audit directly but should not expose theme bodies in error messages either)
  </read_first>
  <action>
    Create `src/client/components/themes/ThemeEditor.tsx` exporting a single function component:

    ```typescript
    export function ThemeEditor({
      settings,
      onSettingsChanged,
    }: {
      settings: AppSettings;
      onSettingsChanged: (settings: AppSettings) => void; // reuse AdminPanel's existing callback
    }): JSX.Element
    ```

    Behaviour:

    1. Left column: a "Themes" list showing every `BUILT_IN_THEMES` entry and every `settings.customThemes` entry. Current `settings.activeThemeId` is highlighted. Each row has:
       - a name + small preview swatch row (6 colored squares rendered inline with the theme's token values — no external images, no SVG)
       - an "Aktivieren" button that POSTs `/api/admin/themes/:id/activate` and, on success, calls `onSettingsChanged(result.settings)` (which will re-run `applyTheme` at the AdminPanel level)
       - for custom themes only: "Bearbeiten" + "Löschen" buttons

    2. Right column: the token editor. Local state holds a `draft: HermesTheme` that starts empty (for "create new") or is seeded from a selected custom theme (for "edit"). For each token key present in the `"default"` preset (i.e. the full surface — we edit the full keyset every time for UX simplicity), render a labelled input. Input shows the current value, `onChange` updates the draft AND immediately calls `applyTheme({ settings, theme: draft })` so the app re-renders in the new theme LIVE. (This means the preview is the real app — no sandboxed iframe needed; committing is an explicit Save action.)

    3. Client-side validation before any save:
       - Import `HERMES_TOKEN_KEY_PATTERN` and `HERMES_TOKEN_VALUE_PATTERN` from `src/client/theme/presets`.
       - For each token, if `!HERMES_TOKEN_VALUE_PATTERN.test(value)`, show an inline error near the field AND disable the save button. Do NOT send invalid values to the server.
       - Name is `z.string().trim().min(1).max(80)` equivalent (enforce via input attributes + manual check).
       - Id (for new themes) is derived from slugifying the name client-side: lower-case, replace non-`[a-z0-9-]` with `-`, trim hyphens, max 64 chars. Collisions with an existing custom theme id OR a built-in id surface the `theme_existiert_bereits` server error; retry-with-suffix is Claude's discretion.

    4. Save button calls either:
       - `requestJson<{ theme: HermesTheme }>("/api/admin/themes", { method: "POST", body: JSON.stringify({ id, name, builtIn: false, tokens }) })` for new
       - `requestJson<{ theme: HermesTheme }>("/api/admin/themes/:id", { method: "PATCH", ... })` for edit
       On success, refresh settings by calling `requestJson<{ settings: AppSettings }>("/api/settings")` and pass to `onSettingsChanged`. This reuses the public settings endpoint the app already calls on boot.

    5. Cancel button discards the draft and re-applies the currently active theme by calling `applyTheme({ settings })` (drops the live-preview overrides).

    6. Delete button posts `DELETE /api/admin/themes/:id` and, on success, re-fetches settings. If the deleted theme was active, the server resets to `"default"` and the UI picks that up via the returned settings.

    7. Add any new error codes from plan 10-02 (`theme_existiert_bereits`, `theme_nicht_gefunden`, `ungueltige_theme`, `background_nicht_gefunden` — the last for plan 10-04 but add it here so it's in place) to `src/client/errors/errors.ts` with German human-readable strings following the "modern, concise, clear" voice (preparing for COPY-01).

    Accessibility: each token input has a `<label htmlFor>` with the raw `--hermes-*` key shown in `<code>`, inputs use `type="text"` (not color — the color picker drops shadows/shapes). Save/Cancel buttons have visible text; no icon-only controls.

    Do NOT introduce any CSS-in-JS, Tailwind, MUI, or any new UI framework — plain className strings only, styles live in styles.css (Task 3).

    Do NOT log token bodies to `console.*` anywhere. Do NOT include the token object in thrown Error messages (use `getErrorMessage` for codes).
  </action>
  <acceptance_criteria>
    - `rg -n "export function ThemeEditor" src/client/components/themes/ThemeEditor.tsx` returns 1 match.
    - `rg -n "HERMES_TOKEN_VALUE_PATTERN|HERMES_TOKEN_KEY_PATTERN" src/client/components/themes/ThemeEditor.tsx` returns ≥ 2 matches.
    - `rg -n "applyTheme\(\{" src/client/components/themes/ThemeEditor.tsx` returns ≥ 2 matches (live preview + cancel reset).
    - `rg -n "/api/admin/themes" src/client/components/themes/ThemeEditor.tsx` returns ≥ 3 matches (POST, PATCH, DELETE).
    - `rg -n "tailwind|@mui|styled-components|css-in-js" src/client/components/themes/ThemeEditor.tsx` returns 0 matches.
    - `rg -n "theme_existiert_bereits|theme_nicht_gefunden|ungueltige_theme|background_nicht_gefunden" src/client/errors/errors.ts` returns ≥ 4 matches.
    - `npx tsc --noEmit` exits 0.
  </acceptance_criteria>
  <verify>
    <automated>MISSING — Wave 0 test scaffold: create src/client/components/themes/ThemeEditor.test.tsx covering the three cases listed in Task 3. Use @testing-library/react (already used by src/client/components/ui-correctness.test.tsx) with `window.fetch` stubbed via vitest. Run: npx vitest run src/client/components/themes/ThemeEditor.test.tsx --reporter=dot</automated>
  </verify>
  <done>
    ThemeEditor renders presets + customs, edits tokens with live preview, rejects malicious token values before hitting the network, persists through the admin endpoints, and compiles clean with tsc.
  </done>
</task>

<task type="auto">
  <name>Task 2: Mount ThemeEditor inside AdminPanel under a new "themes" section</name>
  <files>src/client/components/AdminPanel.tsx</files>
  <read_first>
    - src/client/components/AdminPanel.tsx (current sections, navigation pattern at top of component, AdminSection union, how setSettings + onSettingsChanged interact)
    - src/client/components/themes/ThemeEditor.tsx (Task 1 output — import path and props)
    - src/client/theme/applyTheme.ts (used by parent App; AdminPanel itself should NOT call applyTheme — leave that to App via onSettingsChanged, which is the existing contract in src/main.tsx)
  </read_first>
  <action>
    Edit `src/client/components/AdminPanel.tsx`:

    1. Extend the local `type AdminSection = ...` union with `"themes"`.
    2. Extend the local `defaultSettings` literal with `activeThemeId: "default"`, `customThemes: []`, `activeBackgroundKey: null` so it matches the extended `AppSettings` type from plan 10-01.
    3. Add a nav entry for "Themes" in whichever section-selector UI AdminPanel currently renders (mirroring the existing `users`, `settings`, etc. entries — read the file to find the exact JSX).
    4. In the section-render switch, when `activeSection === "themes"`, render:
       ```tsx
       <ThemeEditor settings={settings} onSettingsChanged={(next) => {
         setSettings(next);
         onSettingsChanged(next); // bubble up so App re-runs applyTheme
       }} />
       ```
    5. Import `ThemeEditor` from `./themes/ThemeEditor`.
    6. Do NOT touch the existing `"settings"` section — legacy color pickers stay. (They mutate `themePrimaryColor` etc. which applyTheme still bridges to `--teal` et al.)
    7. Do NOT grow AdminPanel by more than ~40 lines — if heavier logic is needed, push it down into ThemeEditor.
  </action>
  <acceptance_criteria>
    - `rg -n "type AdminSection = .*\"themes\"" src/client/components/AdminPanel.tsx` returns 1 match.
    - `rg -n "import.*ThemeEditor.*from\s+['\\\"]\\./themes/ThemeEditor['\\\"]" src/client/components/AdminPanel.tsx` returns 1 match.
    - `rg -n "<ThemeEditor" src/client/components/AdminPanel.tsx` returns 1 match.
    - `rg -n "activeThemeId:\s*\"default\"" src/client/components/AdminPanel.tsx` returns 1 match.
    - `npx tsc --noEmit` exits 0.
    - `npm run build` succeeds.
  </acceptance_criteria>
  <verify>
    <automated>npx tsc --noEmit && npm run build >/tmp/admin-build.log 2>&1 && grep -Eq "error|Error" /tmp/admin-build.log && { echo 'build error'; exit 1; } || echo ok</automated>
  </verify>
  <done>
    AdminPanel exposes a Themes section backed by ThemeEditor; legacy settings section untouched; build and type-check are clean.
  </done>
</task>

<task type="auto">
  <name>Task 3: Add minimal layout styles and a vitest suite for ThemeEditor</name>
  <files>src/styles.css, src/client/components/themes/ThemeEditor.test.tsx</files>
  <read_first>
    - src/styles.css (existing admin-panel / card rules — keep spacing + radius consistent with the 8px convention)
    - src/client/components/ui-correctness.test.tsx (existing @testing-library/react + vitest pattern — mirror it)
  </read_first>
  <action>
    1. Append to `src/styles.css` a small block of layout-only styles — all colors come from `var(--hermes-*)`:
       - `.theme-editor` — two-column grid on ≥ 860px, stacked on narrower screens.
       - `.theme-preset-list` — flex column, gap 12px.
       - `.theme-preset-card` — padding, `border-radius: var(--hermes-radius-card)`, `background: var(--hermes-color-paper)`, border `1px solid var(--hermes-color-line)`, `box-shadow: var(--hermes-shadow-card)`.
       - `.theme-preset-card.is-active` — outlined with `--hermes-color-accent-admin`.
       - `.theme-preset-swatches` — inline flex row of 6 colored squares (20×20px).
       - `.theme-token-grid` — 2-column CSS grid of `<label>` + `<input type="text">` pairs; inputs use existing button/input styles for consistency.
       - `.theme-token-error` — small text in `var(--hermes-color-accent-login)` displayed under invalid inputs.

       No @imports, no new fonts, no keyframes — this phase ships no animations (confirmed by CONTEXT Claude's Discretion — not needed for THEME-01 and risks breaking accessibility preferences).

    2. Create `src/client/components/themes/ThemeEditor.test.tsx` with three vitest+@testing-library/react cases:

       - **Renders built-in presets and marks the active one**: mount `<ThemeEditor settings={fixtureSettings} onSettingsChanged={vi.fn()} />` where `fixtureSettings.activeThemeId === "neon-cyber"`; assert the Neon Cyber card has the `is-active` class (or `aria-current="true"`).

       - **Rejects unsafe token values before submitting**: mount the editor in "create new" mode, type a name, set one token value to `url(javascript:alert(1))`, click Save, assert (a) `window.fetch` was NOT called and (b) `.theme-token-error` text appears.

       - **Activate posts to /api/admin/themes/:id/activate and bubbles settings**: stub `window.fetch` to return `{ ok: true, json: async () => ({ settings: { ...fixtureSettings, activeThemeId: "neon-cyber" } }) }`; click Activate on the Neon Cyber card; assert the mock was called with the correct URL and that `onSettingsChanged` was invoked with the new settings.

       Use a spy on `document.documentElement.style.setProperty` to additionally verify that typing into a token input triggers `applyTheme` (i.e. live preview — THEME-01 success criterion 1).
  </action>
  <acceptance_criteria>
    - `rg -n "\.theme-editor\s*\{" src/styles.css` returns 1 match.
    - `rg -n "\.theme-preset-card\.is-active" src/styles.css` returns 1 match.
    - `rg -n "--hermes-" src/styles.css | rg -c "theme-"` returns ≥ 3 matches (the new rules consume only hermes tokens).
    - `rg -n "\"is-active\"|aria-current=\"true\"" src/client/components/themes/ThemeEditor.test.tsx` returns ≥ 1 match.
    - `rg -n "url\(javascript:alert" src/client/components/themes/ThemeEditor.test.tsx` returns 1 match (the malicious-input test case).
    - `npx vitest run src/client/components/themes/ThemeEditor.test.tsx --reporter=dot` exits 0.
  </acceptance_criteria>
  <verify>
    <automated>npx vitest run src/client/components/themes/ThemeEditor.test.tsx --reporter=dot</automated>
  </verify>
  <done>
    Editor has readable layout using only `--hermes-*` tokens, and the vitest suite pins the three invariants (active marker, client-side sanitization, activate bubbling).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Admin typing → applyTheme live preview | Token values flow into `document.documentElement.style` immediately on keystroke; must be sanitized before write. |
| Admin form → POST /api/admin/themes | Client request body; server (plan 10-02) re-validates, but client must reject obvious abuse for UX and to prevent accidental network exposure. |
| Error response → UI rendering | Server error codes could leak token bodies if rendered verbatim; UI must only render mapped human strings. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-14 | Tampering / Stored XSS via theme name | ThemeEditor name input rendered into DOM (preset card label) | mitigate | React 19 escapes text children; name never reaches `dangerouslySetInnerHTML`. Length capped at 80. Test asserts `<script>foo</script>` as a name renders as text, not as an element. |
| T-10-15 | Tampering / CSS injection via token value | Token input → applyTheme → `setProperty` | mitigate | `HERMES_TOKEN_VALUE_PATTERN` check before every `applyTheme` call AND before every network send. Invalid values disable the save button. Plan 10-01 applyTheme reapplies the same regex as defense in depth. |
| T-10-16 | Information Disclosure | Error responses rendered in the UI | mitigate | Errors mapped through `getErrorMessage(code)`; raw `error.message` never interpolated into JSX. Test stubs an error path to confirm. |
| T-10-17 | Elevation of Privilege | Non-admin reaching the Themes UI | accept | AdminPanel's `isAdmin` guard already blocks non-admins from the whole panel; server guards plan 10-02 block the network path regardless. |
</threat_model>

<verification_criteria>
- `npx vitest run src/client/components/themes/ThemeEditor.test.tsx` passes.
- `npx tsc --noEmit` is clean.
- `npm run build` succeeds.
- Manual: activating a built-in preset visibly re-themes the app without a reload; creating a custom theme persists through a full page refresh.
</verification_criteria>

<success_criteria>
- `ThemeEditor` component exists, is mounted under a new "themes" section of AdminPanel, and handles activate/create/edit/delete against the plan 10-02 endpoints.
- Live preview works (token edits mutate `--hermes-*` custom properties in real time).
- Client sanitization matches server regex; no invalid token value reaches the network.
- New error codes (`theme_*`, `background_nicht_gefunden`) have German human-readable mappings.
- `npm run build` and the vitest suite stay green.
</success_criteria>

<output>
After completion, create `.planning/phases/10-theme-system-and-copy-refresh/10-03-SUMMARY.md` noting:
- The exact AdminSection entries added (for plan 10-04 to mirror when adding "backgrounds")
- Where the ThemeEditor lives and its public props (for any future extraction)
- Any legacy `"settings"` section affordances that became redundant (if any — do NOT remove them in this plan; leave a note for THEME-03)
</output>
