# Phase 10: Admin Theme System, Backgrounds, and Copy Refresh - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning
**Source:** Promoted from todo `2026-04-16-gaming-themes-and-modern-copy.md`

<domain>
## Phase Boundary

This phase delivers a centrally-administered visual layer for Hermes:
1. A theme system (built-in gaming presets + admin-editable custom themes via CSS tokens), persisted in app settings.
2. A background-image picker, sourcing presets from the existing S3 snapshot bucket under a Hermes-specific prefix.
3. A project-wide copy refresh to a "modern, concise, clear" voice across Events, Login/Profile, Manager, and Admin views.

Out of scope (deferred): an AI image **generation** pipeline (THEME-03 — v1.2 only consumes presets that already exist in S3).
</domain>

<decisions>
## Implementation Decisions

### Theme System (THEME-01) — locked

- D-01: Themes are CSS custom property bundles (CSS variables) applied at the `<html>` or `<body>` level. No new UI framework (Tailwind/MUI/etc.) is introduced.
- D-02: Built-in presets ship as data in code (TypeScript object exported from a `themes/` module). Each preset has: `id`, `name`, `tokens` (color/contrast/button/card/pill variables).
- D-03: At least **3 built-in presets** ship: a "Default" (current look, slightly polished), and two distinct "gaming" presets (e.g. neon-cyber, retro-arcade). Exact names finalized during planning.
- D-04: Custom themes are stored in app settings (DB-backed `settings` row). Schema: `customThemes: ThemeRecord[]` and `activeThemeId: string`. The active theme can be either a built-in id or a custom id.
- D-05: Admin theme editor lives in `AdminPanel.tsx` and exposes the token editor with a live preview applied to a sandboxed area before commit.
- D-06: Theme switch is **client-side**, applied without a page reload (CSS variable swap on `<html>`); persistence is via the same settings POST endpoint pattern already in use.
- D-07: Audit log: `settings_theme_updated` (created/updated/deleted/active-changed). Token bodies are not logged in full — only the changed theme id and operation.

### Background Image (THEME-02) — locked

- D-08: Background presets live in the existing S3 snapshot bucket under a **Hermes-specific prefix** (e.g. `themes/backgrounds/`). The list is read-only from the app's perspective.
- D-09: Admin endpoint lists available backgrounds (just keys + signed/served URLs as appropriate). Selection is stored in settings (`activeBackgroundKey: string | null`).
- D-10: Custom upload of background images is **deferred** for this phase to avoid expanding S3-write scope; only preset selection ships in v1.2.
- D-11: Client renders the background as a fixed full-viewport layer behind the app shell, with a CSS overlay/blur to preserve text readability across themes.
- D-12: If S3 is unavailable or the prefix is empty, the background picker shows an empty state and the app falls back to the current solid-color background — no errors surfaced to end users.

### Copy Refresh (COPY-01) — locked

- D-13: Voice: "modern, concise, clear" — short verbs over noun phrases, no jargon-without-payoff, action-oriented button labels.
- D-14: Scope: every user-facing string in `src/client/components/*` and shared modules — titles, descriptions, button labels, hint text, error messages, empty states.
- D-15: **No new i18n framework** is introduced. Copy stays in the language(s) currently shipped. (German strings remain German; English strings remain English; tone updates only.)
- D-16: Existing tests must continue to pass; copy changes that break a test string must update both the source and the test in the same change.
- D-17: Error message rule: keep stable error **codes** unchanged (downstream depends on them); only change the human-readable text.

### Cross-Cutting (locked)

- D-18: All admin endpoints stay admin-only and follow the existing CSRF + session-cookie conventions.
- D-19: Settings schema extension follows the explicit-migration convention (no implicit Drizzle push).
- D-20: Theme + background features must degrade gracefully on browsers that lack CSS variable support (we accept the legacy default look) — no JS errors.

### Claude's Discretion

- Exact preset visual designs (colors, contrasts).
- Whether to expose a "preview-only / commit" two-step in the editor or commit-on-blur.
- Choice between `<style>` injection vs. inline `style` for live-preview.
- Whether to add an "import/export theme JSON" affordance (nice-to-have, not required by THEME-01).
- The precise S3 prefix name and whether the listing endpoint caches results.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Client
- `src/client/components/AdminPanel.tsx` — host for the theme editor + background picker
- `src/styles.css` — current global styles (defines the variables the new themes will set)
- `src/main.tsx` — app shell where the active theme/background is applied

### Server
- `src/server/http/admin-routes.ts` — admin endpoints follow this shape
- `src/server/settings.ts` — settings persistence layer (extend here)
- `src/server/storage/s3-storage.ts` — S3 client used for snapshots; the background-listing logic should reuse this client
- `src/server/db/schema.ts` — settings table (any schema extension needs a migration)

### Project Convention
- `.planning/codebase/CONVENTIONS.md` — naming, test layout, import organization
- `.planning/codebase/STACK.md` — confirms "no new UI framework"
- `.planning/codebase/CONCERNS.md` — `src/main.tsx` is large; avoid bloating it

</canonical_refs>

<specifics>
## Specific Ideas

- Token namespace: `--hermes-color-*`, `--hermes-radius-*`, `--hermes-shadow-*`, `--hermes-button-*`, `--hermes-pill-*`.
- Built-in preset ids: `default`, `neon-cyber`, `retro-arcade` (exact names TBD in planning).
- S3 prefix candidate: `themes/backgrounds/`.
- Audit codes: `settings_theme_updated`, `settings_background_updated`.
- Settings additions: `customThemes`, `activeThemeId`, `activeBackgroundKey`.

</specifics>

<deferred>
## Deferred Ideas

- **THEME-03**: AI-generated background image pipeline (server-side job that produces curated S3 presets). v1.2 only consumes presets that are already in S3.
- Custom background upload from the admin UI.
- Per-user theme overrides (themes are global in v1.2).
- Theme import/export as portable JSON files.

</deferred>

---

*Phase: 10-theme-system-and-copy-refresh*
*Context gathered: 2026-04-16 from todos promotion*
