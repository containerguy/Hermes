# Technology Stack (UX Polish) — Hermes v1.1

**Project:** Hermes  
**Researched:** 2026-04-16  
**Scope:** minimal stack additions for UI/UX polish (navigation, visualization, accessibility)

Hermes is intentionally lean on frontend deps (`react`/`react-dom` only in `package.json`). For v1.1, the highest leverage is **structure + semantic HTML + CSS + small primitives**, not adopting a full UI framework.

## Recommended stack (v1.1 UX polish)

### Core (keep as-is)

| Technology | Current (repo) | Purpose | Why |
|---|---:|---|---|
| React | 19.2.3 | UI rendering | Already in use; best place to invest is component and layout cleanup |
| Vite | 7.3.0 | Build/dev server | Already in use; no UX value in replacing it |
| TypeScript | 5.9.3 | Type safety | Helps safe UI refactors (nav splits, component extraction) |

### Optional additions (only if they unlock v1.1 goals)

| Library | Current (ecosystem) | Purpose | Add when | Avoid when |
|---|---:|---|---|---|
| `react-router-dom` (re-exports `react-router`) | 7.14.1 | URL-driven navigation, deep links, back/forward correctness | You want explicit routes for Events/Login(Profile)/Manager/Admin and predictable browser navigation | Your current hash/state navigation is sufficient; don’t add routing churn late |
| Radix primitives (`@radix-ui/react-*` or the `radix-ui` bundle) | `@radix-ui/react-dialog` 1.1.15 | Accessible primitives (dialogs, menus, tabs) with correct focus + ARIA patterns | You need modals/menus/popovers and want robust keyboard + screen reader behavior | You can implement the UX with inline panels and semantic HTML (often simpler and lighter) |
| `recharts` | 3.8.1 | Lightweight-ish React charts for quick status visualizations | You truly need chart affordances (tooltips/legends/axes), not just capacity bars | You can express capacity/status with CSS/SVG (progress bars, badges, stacked bars) |
| `@tanstack/react-table` | 8.21.3 | Headless tables (sorting/filtering/pagination) for admin/manager screens | Lists grow and users need sorting/filtering beyond a couple columns | Data stays small (\(\approx\) 25 users); plain `<table>` + simple sorting is enough |

## Default: UX polish without adding deps

- **Navigation clarity**: consistent landmarks (`<header>`, `<nav>`, `<main>`), visible “current section”, keyboard focus styles.
- **Accessibility**: semantic controls first (real `<button>`, `<a>`, `<label>`), then ARIA only where needed.
- **Visualization**: prefer CSS/SVG components (capacity meters, state chips) before reaching for charting libraries.

## Installation (only if needed)

```bash
npm install react-router-dom
npm install @radix-ui/react-dialog
npm install recharts
npm install @tanstack/react-table
```

## Sources

- Hermes repo `package.json`: current baseline dependencies
- npm (`react-router-dom`): `7.14.1` published 2026-04-13 (`https://www.npmjs.com/package/react-router-dom`)
- npm (`recharts`): `3.8.1` published 2026-03-25 (`https://www.npmjs.com/package/recharts`)
- npm (`@radix-ui/react-dialog`): version reference `https://www.npmjs.com/package/@radix-ui/react-dialog` (fetch timed out here; version cross-checked via search results)
- npm (`@tanstack/react-table`): version reference `https://www.npmjs.com/package/@tanstack/react-table` (fetch timed out here; version cross-checked via search results)
