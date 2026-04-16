---
phase: 10-theme-system-and-copy-refresh
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/styles.css
  - src/client/theme/presets.ts
  - src/client/theme/applyTheme.ts
  - src/client/types/core.ts
  - src/main.tsx
autonomous: true
requirements: [THEME-01]
tags: [theme, css-variables, client-infra]

must_haves:
  truths:
    - "A `--hermes-*` CSS variable namespace exists in src/styles.css and renders the current look by default."
    - "At least 3 built-in presets (default, neon-cyber, retro-arcade) are exported from a dedicated module and are consumable by downstream code without pulling AdminPanel state."
    - "applyTheme is callable with either a built-in preset id or a custom ThemeRecord and swaps CSS variables on <html> without a page reload."
    - "src/main.tsx stays smaller or equal in size — theme logic lives in src/client/theme/ not main.tsx."
  artifacts:
    - path: "src/styles.css"
      provides: "--hermes-color-*, --hermes-radius-*, --hermes-shadow-*, --hermes-button-*, --hermes-pill-* token namespace with defaults"
      contains: "--hermes-color-"
    - path: "src/client/theme/presets.ts"
      provides: "HermesTheme type + BUILT_IN_THEMES array (length ≥ 3)"
      exports: ["BUILT_IN_THEMES", "HermesTheme", "HermesThemeTokens"]
    - path: "src/client/theme/applyTheme.ts"
      provides: "applyTheme(theme | settings) that writes CSS variables to document.documentElement"
      exports: ["applyTheme", "resolveActiveTheme"]
    - path: "src/client/types/core.ts"
      provides: "AppSettings extended with activeThemeId, customThemes, activeBackgroundKey (types only)"
  key_links:
    - from: "src/main.tsx"
      to: "src/client/theme/applyTheme.ts"
      via: "import + call on settings load"
      pattern: "from\\s+['\\\"]\\./client/theme/applyTheme['\\\"]"
    - from: "src/client/theme/applyTheme.ts"
      to: "src/client/theme/presets.ts"
      via: "import BUILT_IN_THEMES to resolve ids"
      pattern: "BUILT_IN_THEMES"
---

<objective>
Create the client-side theme infrastructure that every later plan in Phase 10 builds on: a stable `--hermes-*` CSS variable namespace, a data module of built-in gaming presets, and an extracted `applyTheme` helper so `src/main.tsx` stops growing.

Purpose: D-01/D-02/D-03/D-06 (locked) require that theme switches are CSS-variable swaps with no page reload and that built-in presets ship as TypeScript data. CONCERNS.md flags `src/main.tsx` as already large; this plan extracts the theme logic before any new admin UI lands.

Output: token namespace in `src/styles.css`, presets module, applyTheme helper, and main.tsx wired to call them. No server/UI work yet.
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
@src/styles.css
@src/main.tsx
@src/client/types/core.ts

<interfaces>
<!-- Current applyTheme in src/main.tsx (lines 87-94) maps legacy color settings to --teal/--rose/--amber/--blue/--surface. -->
<!-- This plan extends the namespace without dropping those legacy aliases — backward compatibility preserved. -->

Legacy contract (must keep working):
```typescript
function applyTheme(settings: AppSettings): void // sets --teal, --rose, --amber, --blue, --surface
```

New contract (to introduce):
```typescript
export type HermesThemeTokens = Record<string, string>; // keys match /^--hermes-[a-z0-9-]+$/, values are sanitized CSS token values
export type HermesTheme = { id: string; name: string; builtIn: boolean; tokens: HermesThemeTokens };
export const BUILT_IN_THEMES: readonly HermesTheme[];
export function applyTheme(input: { settings: AppSettings; theme?: HermesTheme }): void;
export function resolveActiveTheme(settings: AppSettings): HermesTheme;
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Introduce the --hermes-* token namespace in styles.css</name>
  <files>src/styles.css</files>
  <read_first>
    - src/styles.css (top :root block, buttons/cards/.topbar/.page-hero sections)
    - AGENTS.md (no new UI framework — plain CSS only)
    - .planning/codebase/CONVENTIONS.md (CSS Conventions section: design tokens live on :root, radius is 8px, min-height 44px for controls)
  </read_first>
  <action>
    Add a new `--hermes-*` CSS variable namespace on `:root` directly below the existing `:root` variables in `src/styles.css`. Namespace groups (all values default to the CURRENT visual appearance so nothing changes visually):

    - `--hermes-color-ink`, `--hermes-color-text`, `--hermes-color-muted`, `--hermes-color-line`, `--hermes-color-paper`, `--hermes-color-surface`, `--hermes-color-surface-strong`, `--hermes-color-accent-primary` (teal), `--hermes-color-accent-login` (rose), `--hermes-color-accent-manager` (amber), `--hermes-color-accent-admin` (blue), `--hermes-color-success` (green).
    - `--hermes-radius-control` (8px), `--hermes-radius-card` (8px), `--hermes-radius-pill` (999px).
    - `--hermes-shadow-card` (current `--shadow` value).
    - `--hermes-button-bg` (teal), `--hermes-button-fg` (#ffffff), `--hermes-button-weight` (800), `--hermes-button-min-height` (44px).
    - `--hermes-pill-bg`, `--hermes-pill-fg`, `--hermes-pill-border`.

    Keep the legacy tokens (`--teal`, `--rose`, `--amber`, `--blue`, `--surface`, `--ink`, `--text`, `--muted`, `--line`, `--paper`, `--surface-strong`, `--green`, `--shadow`) as backward-compatible aliases pointing to the `--hermes-*` equivalents via `var(--hermes-...)`. Do NOT rewrite existing selectors — only the `:root` block changes. This is what makes D-20 (graceful degradation) work: legacy selectors keep rendering even if JS fails to set `--hermes-*`.

    Do not remove any existing rule. Do not introduce new dependencies. Do not change `min-height: 44px`, `border-radius: 8px`, or any layout.
  </action>
  <acceptance_criteria>
    - `rg -n "^\s*--hermes-color-" src/styles.css` returns ≥ 10 lines.
    - `rg -n "^\s*--hermes-radius-" src/styles.css` returns ≥ 3 lines.
    - `rg -n "^\s*--hermes-button-" src/styles.css` returns ≥ 3 lines.
    - `rg -n "^\s*--hermes-pill-" src/styles.css` returns ≥ 2 lines.
    - `rg -n "^\s*--teal:\s*var\(--hermes-color-accent-primary" src/styles.css` returns 1 line (legacy alias preserved via var()).
    - `git diff src/styles.css` shows no deleted selectors outside the :root block.
  </acceptance_criteria>
  <verify>
    <automated>npm run build -- --mode=production >/tmp/styles-build.log 2>&1 ; grep -E "error" /tmp/styles-build.log | grep -v "no errors" ; test $? -eq 1</automated>
  </verify>
  <done>
    `src/styles.css` defines the full `--hermes-*` namespace with current-look defaults; legacy variables alias through `var(...)`; app renders identically at build time.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create the built-in presets module</name>
  <files>src/client/theme/presets.ts</files>
  <read_first>
    - src/styles.css (the new --hermes-* defaults — the "default" preset must match these values exactly)
    - .planning/phases/10-theme-system-and-copy-refresh/10-CONTEXT.md (D-02, D-03 — at least 3 presets; ids `default`, `neon-cyber`, `retro-arcade`)
  </read_first>
  <action>
    Create `src/client/theme/presets.ts`. Export:

    ```typescript
    export type HermesThemeTokens = Record<string, string>;
    export type HermesTheme = {
      id: string;        // stable machine id (e.g. "default", "neon-cyber")
      name: string;      // human-readable label shown in AdminPanel
      builtIn: true;     // always true for this module
      tokens: HermesThemeTokens;
    };

    export const HERMES_TOKEN_KEY_PATTERN = /^--hermes-[a-z0-9-]+$/;
    // Reject javascript:, url(, expression(, <, >, quotes, semicolons, comment markers.
    export const HERMES_TOKEN_VALUE_PATTERN = /^(?!.*(?:url\(|expression\(|javascript:|\/\*|\*\/|<|>|"|'|;|\\)).{1,200}$/i;

    export const BUILT_IN_THEMES: readonly HermesTheme[] = [
      { id: "default",      name: "Hermes Default", builtIn: true, tokens: {/* matches current --hermes-* defaults from styles.css */} },
      { id: "neon-cyber",   name: "Neon Cyber",     builtIn: true, tokens: {/* darker surface, cyan/magenta accents */} },
      { id: "retro-arcade", name: "Retro Arcade",   builtIn: true, tokens: {/* warm cream surface, amber/red accents */} },
    ];

    export function isBuiltInThemeId(id: string): boolean {
      return BUILT_IN_THEMES.some((theme) => theme.id === id);
    }
    ```

    Exact palettes are Claude's discretion (per CONTEXT Claude's Discretion), but all three MUST provide the SAME KEY SET (every token present in the "default" theme must be present in the other two — the applyTheme helper depends on that invariant). Choose accessible contrasts (WCAG AA for body text on surface — rough check is enough; full audit is deferred).

    Do NOT import React, styles.css, or anything from src/server. This file must be safe to import from server-side Zod schemas in plan 10-02.
  </action>
  <acceptance_criteria>
    - `rg -n "export const BUILT_IN_THEMES" src/client/theme/presets.ts` returns 1 line.
    - `node -e "import('./src/client/theme/presets.ts').then(m => { if (m.BUILT_IN_THEMES.length < 3) process.exit(1); })"` OR equivalent vitest import returns length ≥ 3. (Use the vitest verify below.)
    - `rg -n "\"default\"|\"neon-cyber\"|\"retro-arcade\"" src/client/theme/presets.ts` returns all three ids.
    - `rg -n "from\s+['\\\"]react['\\\"]|from\s+['\\\"]\\.\\./server" src/client/theme/presets.ts` returns 0 matches.
    - Every preset's `tokens` keyset is identical (checked by the vitest unit test below).
  </acceptance_criteria>
  <verify>
    <automated>MISSING — Wave 0 test scaffold: create src/client/theme/presets.test.ts with vitest cases asserting (a) BUILT_IN_THEMES.length >= 3, (b) all presets share the same token keyset as the "default" preset, (c) every token key matches HERMES_TOKEN_KEY_PATTERN, (d) every token value matches HERMES_TOKEN_VALUE_PATTERN. Run: npx vitest run src/client/theme/presets.test.ts --reporter=dot</automated>
  </verify>
  <done>
    Module exports BUILT_IN_THEMES (≥3), HermesTheme types, and the shared key/value regex constants. Passing vitest proves all presets share a consistent token surface.
  </done>
</task>

<task type="auto">
  <name>Task 3: Extract applyTheme into src/client/theme/applyTheme.ts and wire src/main.tsx + AppSettings types</name>
  <files>src/client/theme/applyTheme.ts, src/main.tsx, src/client/types/core.ts</files>
  <read_first>
    - src/main.tsx (existing applyTheme lines 87–94, useEffect at lines 141–148)
    - src/client/theme/presets.ts (created in Task 2 — import BUILT_IN_THEMES)
    - src/client/types/core.ts (current AppSettings shape, lines 12–22)
    - .planning/codebase/CONCERNS.md ("src/main.tsx is large" — this task must NOT grow main.tsx net line count)
  </read_first>
  <action>
    1. Extend `src/client/types/core.ts` `AppSettings` with the Phase-10 settings keys (types only, no runtime):
       - `activeThemeId: string;` (defaults to `"default"` on the server side)
       - `customThemes: Array<{ id: string; name: string; builtIn: false; tokens: Record<string, string> }>;`
       - `activeBackgroundKey: string | null;`

       Leave the existing legacy fields (`themePrimaryColor` etc.) in place — they remain part of the settings shape for Phase-10 to stay backward compatible; the server plan (10-02) will also keep returning them.

    2. Create `src/client/theme/applyTheme.ts`:

       ```typescript
       import type { AppSettings } from "../types/core";
       import {
         BUILT_IN_THEMES,
         HERMES_TOKEN_KEY_PATTERN,
         HERMES_TOKEN_VALUE_PATTERN,
         type HermesTheme,
       } from "./presets";

       export function resolveActiveTheme(settings: AppSettings): HermesTheme {
         const fromBuiltIn = BUILT_IN_THEMES.find((t) => t.id === settings.activeThemeId);
         if (fromBuiltIn) return fromBuiltIn;
         const fromCustom = settings.customThemes.find((t) => t.id === settings.activeThemeId);
         if (fromCustom) return { ...fromCustom, builtIn: false };
         return BUILT_IN_THEMES[0]; // "default" fallback — required by D-20
       }

       export function applyTheme(input: { settings: AppSettings; theme?: HermesTheme }): void {
         const root = document.documentElement;
         const theme = input.theme ?? resolveActiveTheme(input.settings);
         for (const [key, value] of Object.entries(theme.tokens)) {
           if (!HERMES_TOKEN_KEY_PATTERN.test(key)) continue;   // defense-in-depth sanitization
           if (!HERMES_TOKEN_VALUE_PATTERN.test(value)) continue;
           root.style.setProperty(key, value);
         }
         // Legacy bridge: keep writing the pre-Phase-10 variables from the settings colors,
         // so any code not yet migrated still renders with admin-picked colors.
         root.style.setProperty("--teal", input.settings.themePrimaryColor);
         root.style.setProperty("--rose", input.settings.themeLoginColor);
         root.style.setProperty("--amber", input.settings.themeManagerColor);
         root.style.setProperty("--blue", input.settings.themeAdminColor);
         root.style.setProperty("--surface", input.settings.themeSurfaceColor);
       }
       ```

       Exports: `applyTheme`, `resolveActiveTheme`.

    3. Update `src/main.tsx`:
       - Delete the local `applyTheme` function (lines 87–94).
       - Add `import { applyTheme } from "./client/theme/applyTheme";` near the other client imports.
       - Replace both existing call sites with `applyTheme({ settings: result.settings })` / `applyTheme({ settings: defaultSettings })` / `applyTheme({ settings })` as appropriate.
       - Extend the local `defaultSettings` literal to include `activeThemeId: "default"`, `customThemes: []`, `activeBackgroundKey: null` so it satisfies the extended `AppSettings` type.
       - Net line count of src/main.tsx must stay ≤ current (per CONCERNS.md — verify with `wc -l`).
  </action>
  <acceptance_criteria>
    - `rg -n "^function applyTheme\(" src/main.tsx` returns 0 matches (local copy removed).
    - `rg -n "from\s+['\\\"]\\./client/theme/applyTheme['\\\"]" src/main.tsx` returns 1 match.
    - `rg -n "activeThemeId|customThemes|activeBackgroundKey" src/client/types/core.ts` returns ≥ 3 matches.
    - `rg -n "defaultSettings\s*:" src/main.tsx` context includes `activeThemeId: "default"`.
    - `wc -l src/main.tsx` reports a line count ≤ the pre-task line count.
    - `npx tsc --noEmit` exits 0 (no type errors).
    - The vitest test from Task 2 still passes.
  </acceptance_criteria>
  <verify>
    <automated>npx tsc --noEmit && npx vitest run src/client/theme/presets.test.ts --reporter=dot</automated>
  </verify>
  <done>
    applyTheme lives in src/client/theme/applyTheme.ts, src/main.tsx is no larger, AppSettings type carries the Phase-10 fields, and `npx tsc --noEmit` is clean.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| settings → DOM | Server-provided `customThemes[].tokens` values are written into `document.documentElement.style`; malicious values could inject CSS expressions or exfiltrate via `url(...)`. |
| client ↔ applyTheme | Any caller can hand applyTheme an arbitrary token map; defense-in-depth sanitization must live here, not only in the editor. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-01 | Tampering / XSS-via-CSS | `applyTheme` writing token values into inline styles | mitigate | Reject any token key that doesn't match `/^--hermes-[a-z0-9-]+$/`; reject values matching `url(`, `expression(`, `javascript:`, `<`, `>`, quotes, `;`, `\`, `/*`, `*/`, or length > 200. Server plan (10-02) enforces the same regex before persisting. |
| T-10-02 | Denial of Service | Oversized customThemes blob | accept | customThemes count is bounded by admin-only endpoint in 10-02 (N ≤ 20 themes, ≤ 50 tokens each); no client-side amplification possible. |
| T-10-03 | Information Disclosure | Legacy `--teal/--rose/...` still set from settings | accept | Values are colors (`#RRGGBB`) already validated by `settingsSchema`; no PII. |
| T-10-04 | Elevation of Privilege | Any client can call applyTheme with arbitrary input | accept | applyTheme only mutates CSS custom properties; no privilege boundary crossed. Sanitization blocks the only escalation path (CSS expression attacks in legacy IE — not a threat on modern React 19 target). |
</threat_model>

<verification_criteria>
- `npx tsc --noEmit` is clean.
- `npx vitest run src/client/theme/presets.test.ts` passes.
- `npm run build` succeeds (Vite produces a bundle that imports from `src/client/theme/`).
- Opening the app with no changes to persisted settings renders visually identical to pre-change (default preset matches current look).
</verification_criteria>

<success_criteria>
- `--hermes-*` token namespace exists with current-look defaults and legacy aliases intact.
- `BUILT_IN_THEMES` has ≥ 3 presets with a consistent token keyset.
- `applyTheme`/`resolveActiveTheme` are importable from `src/client/theme/applyTheme.ts`.
- `src/main.tsx` imports from the new module and does not grow in line count.
- Type-check and vitest-presets test both pass.
</success_criteria>

<output>
After completion, create `.planning/phases/10-theme-system-and-copy-refresh/10-01-SUMMARY.md` recording:
- Final token namespace (full list of `--hermes-*` keys)
- Exact palettes of the 3 built-in presets (so 10-03 can render preview swatches)
- Any CSS selectors that were rewritten to consume `--hermes-*` directly (expected: none in this plan)
</output>
