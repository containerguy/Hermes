# Phase 5: Frontend And Admin UI Modularization - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 is a **behavior-preserving** refactor of the React UI to reduce regression risk:

- Extract shared client API helpers, DTO/types, and error mapping out of `src/main.tsx` (UI-01).
- Extract major UI areas into focused modules: Event board + creation, Auth/Profile/Devices/Push, and Admin panels (UI-02..UI-04).
- Keep responsive behavior intact (UI-04), especially mobile event action buttons and compact header layout.

No backend behavior changes are intended in this phase.

</domain>

<decisions>
## Implementation Decisions

- **D-01:** Keep `src/main.tsx` as the entry point only (bootstrapping + high-level `App` composition).
- **D-02:** New UI modules live under `src/client/` with clear separation:
  - `src/client/api/` for HTTP helpers (CSRF, request wrapper)
  - `src/client/errors/` for stable error code → message mapping
  - `src/client/types/` for shared types used across modules
  - `src/client/components/` for extracted UI components/pages
- **D-03:** Extraction must not change request semantics (credentials, CSRF header rules, stable error codes) or existing user flows.
- **D-04:** Verification relies on `npm test` + `npm run build` (Playwright may be host-blocked per prior state note).

</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` — Phase 5 goal, success criteria, plan breakdown
- `.planning/REQUIREMENTS.md` — UI-01..UI-08
- `src/main.tsx` — current monolithic UI implementation
- `src/styles.css` — responsive styles that must remain stable

</canonical_refs>

<constraints>
## Constraints

- Avoid behavioral drift: purely structural extraction unless a bug is discovered (deviation rules apply).
- Preserve stable error codes/messages and CSRF attachment rules.

</constraints>

---

*Phase: 05-frontend-and-admin-ui-modularization*
*Context gathered: 2026-04-16*

