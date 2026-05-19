# Project Research Summary

**Project:** Hermes v1.1 UX Polish  
**Domain:** LAN-party coordination web app (events + participation voting + manager/admin console)  
**Researched:** 2026-04-16  
**Confidence:** MEDIUM-HIGH  

## Executive Summary

Hermes v1.1 “UX Polish” is best delivered as **clarity + structure + accessibility**, not new domain behavior. Users need to instantly understand where they are (Events/Profile/Manager/Admin), what an event’s current state implies (open/ready/running/cancelled/archived), how close it is to viability (min/max + current participants), and what their next action is (vote, join, manage). The fastest path is to keep the stack lean and invest in consistent semantics, layout, and derived-state rendering.

The recommended approach is: **modularize the client by feature**, centralize HTTP/error normalization, and treat routing + derived state as “behavior contracts” that must not drift. Implement the polish as a sequence of small, testable slices: app-shell navigation and route guards first, then event-board scanability (status/capacity/voting/join-info), then responsive/a11y + theme/contrast hardening, and finally (only if time) manager/admin ergonomics improvements.

Primary risks are (1) **behavior drift** caused by navigation/state refactors (remounts resetting state, route/guard inconsistencies), (2) **a11y regressions** from visual cleanup, and (3) **realtime (SSE) flicker/staleness** from duplicating business rules across components. Mitigate with centralized route parsing + navigation helpers, a single derived-state mapping for status/capacity/action affordances, semantic HTML-first UI primitives, and a lightweight regression checklist (deep links, back/forward, role matrix, two-browser SSE sanity).

## Key Findings

### Recommended Stack

Hermes already has a minimal client dependency footprint (React/Vite/TypeScript). For v1.1 UX polish, **do not introduce a UI framework**; prefer semantic HTML + CSS + a small set of shared primitives. Optional dependencies are justified only when they directly unblock a v1.1 deliverable (e.g., robust accessible dialogs) and can be introduced without routing churn or wide refactors.

**Core technologies:**
- **React 19.2.3**: UI rendering — already in use; polish is mostly componentization and layout/semantics.
- **Vite 7.3.0**: build/dev server — stable; no UX value in changing.
- **TypeScript 5.9.3**: type safety — reduces refactor risk when extracting features + shared primitives.

**Optional deps (only if strictly needed):**
- **`react-router-dom`**: URL-driven navigation — only if current hash/state routing cannot deliver correct deep links + back/forward without churn.
- **Radix primitives (e.g. `@radix-ui/react-dialog`)**: accessible dialogs/menus — justified if you need modals/popovers and want reliable focus/ARIA patterns quickly.
- **`recharts`**: charts — only if you truly need axes/tooltips; otherwise use CSS/SVG status/capacity meters.
- **`@tanstack/react-table`**: headless tables — only if admin lists require real sorting/filtering/pagination at scale; otherwise plain `<table>` + minimal sorting.

### Expected Features

v1.1 table stakes are **information architecture + scannability + correctness** under LAN time pressure, especially on phones. The event board should answer “what’s happening?” and “what should I do?” with minimal taps, while Manager/Admin screens should reduce operator friction without becoming complex dashboards.

**Must have (table stakes):**
- **Clear primary navigation (Events / Profile / Manager / Admin)** — role-aware gating; consistent across mobile/desktop.
- **“Where am I?” cues** — active nav state + page titles; avoid deep nesting.
- **Scannable event board** — status, time, game, quorum/viability, and “you’re in/out” visible.
- **Strong status visualization** — label + icon + color (never color alone); status drives enabled actions.
- **Capacity visualization** — current count, progress-to-min, and “full” state; consistent with capacity rules.
- **Obvious voting affordances** — “dabei / nicht dabei” is fast, unambiguous, and shows current state.
- **Join details discoverability** — one-tap “copy join info”, especially on mobile.
- **Session context (“My participation”)** — current user + quick logout; notification/push status.
- **Mobile-first responsiveness + a11y baseline** — tap targets, focus rings, contrast, keyboard nav, reduced motion.
- **Good empty/error states** — always show the next step (retry, re-auth, ask manager).

**Should have (differentiators):**
- **Viability at-a-glance “verdict” area** — status + progress-to-min + start time/mode combined compactly.
- **Subtle live update affordance** — highlight-on-change without toast spam; respects reduced motion.
- **Per-event “your next action” cues** — “Vote now”, “Ready—copy join info”, “Running—join server”.
- **Theme + contrast presets** — “Default” + “High contrast” guardrails even if custom colors exist.
- **Single-tap copy actions** — reliable clipboard UX with confirmation.

**Defer (v2+):**
- Waitlists / “maybe” participation states.
- New domain flows (chat, matchmaking, deep analytics dashboards).
- Over-nested navigation/settings sprawl.

### Architecture Approach

Keep the current model (server as source of truth; SSE as invalidation), but make the client **modular**: a thin composition root, an app shell for route selection + navigation chrome, feature modules for Events/Auth/Manager/Admin, and a shared layer for API wrappers, error normalization, UI primitives, and small hooks. Avoid Redux/React Query for v1.1; per-feature “resource hooks” with explicit `reload()` provide consistent spinners/errors without introducing cache correctness risks.

**Major components:**
1. **`src/app/*` app shell** — route parsing, navigation, global UX surfaces (error boundary/toasts), role-aware guards.
2. **`src/features/*` feature modules** — pages, feature-specific API wrappers, resource hooks, and internal components.
3. **`src/shared/*` shared layer** — HTTP wrapper + normalized errors, realtime helper, UI primitives (Button/Dialog/Banners/Toasts), theme application utilities.

### Critical Pitfalls

1. **Behavior drift from route/state coupling** — centralize route contracts and navigation; avoid refactors that change defaults, permission checks, or persistence semantics.
2. **A11y regressions from visual cleanup** — semantic controls first, keep visible focus, ensure accessible names/states (`aria-*` where needed), validate keyboard flow.
3. **Realtime (SSE) flicker/stale derived UI** — keep canonical event state from server; derive status/capacity/actions in one place; avoid “optimistic UI” desync.
4. **Hash routing edge cases** — deep links, back/forward, anchor collisions, scroll restoration; centralize route generation and pick a consistent scroll policy.
5. **Mobile Safari/PWA quirks** — avoid naive `100vh`; prefer `dvh/svh` tolerant layouts; beware fixed headers; test login and event-board flows on iOS Safari.

> Note: `PITFALLS.md` also contains a large, security-focused pitfall matrix that appears to be from a different milestone scope (auth/invite/restore/deploy hardening). It should not drive v1.1 UX Polish scope, but it’s a useful input if/when Hermes plans security hardening work.

## Implications for Roadmap

Suggested phase structure (implementation-oriented slices). Each phase is designed to be **behavior-preserving** with explicit guardrails.

### Phase 1: App shell navigation + contracts (behavior-preserving refactor)
**Rationale:** Most “polish regressions” start with routing/nav changes. Lock down route/role contracts and modular boundaries before touching the event board UI deeply.  
**Delivers:**
- Thin `main.tsx` + `src/app/App.tsx` shell with landmarks (`header/nav/main`) and consistent layout.
- Central hash route parsing + `navigate()` helper + route table.
- Role-aware route guards (UX only; server remains authority) with clear redirect explanations.
- Central HTTP wrapper + error normalization (401/403/offline) and a top-level error boundary.
**Addresses:** Clear navigation, “where am I?” cues, role separation, consistent errors.  
**Avoids:** Behavior drift via route remounts; auth/session confusion; inconsistent 401/403 handling.
**Guardrails against drift:**
- Define “public route contract” (Events/Profile/Manager/Admin) and keep hash shapes stable.
- Back/forward + deep-link matrix on all major routes (normal/manager/admin roles).
- No changes to permission logic beyond UI gating; all APIs must still enforce roles.
**Optional deps justified:** none.

### Phase 2: Event board scanability (status/capacity/voting/join info)
**Rationale:** This is the primary user surface; polish should make it instantly scannable and action-driven without changing underlying semantics.  
**Delivers:**
- Unified derived-state mapping for event status + capacity + allowed actions (one module, reused everywhere).
- Event card/row layout optimized for scan: status badge, start time/mode, capacity meter (progress-to-min + full), “your vote” state.
- Voting controls that are tap-safe, clearly indicate current state, and disable invalid actions (based on derived state).
- Join info in a one-tap “copy join info” affordance with confirmation.
- Subtle “updated” highlight that respects `prefers-reduced-motion` (optional, keep minimal).
**Addresses:** Event board scannability; strong status + capacity visualization; obvious voting; join details discoverability.  
**Avoids:** SSE flicker/inconsistent derived rules; mis-taps due to layout shift; accidental behavior change.
**Guardrails against drift:**
- Keep server as source of truth; after mutations refetch/reload; treat SSE as invalidation.
- Two-browser sanity (vote quickly in both) to verify capacity/status remains consistent.
- Reserve stable space for primary controls to prevent layout shift on load/update.
**Optional deps justified:** `recharts` is **not** justified for v1.1 unless a real chart is required; prefer CSS/SVG meters.

### Phase 3: Responsive + a11y + theme/contrast hardening
**Rationale:** Mobile-first + a11y is a release-quality requirement for LAN-night usability and prevents “polish” from making the app harder to operate.  
**Delivers:**
- Tap target sizing, spacing, and responsive typography across key screens.
- Keyboard-only pass fixes (focus rings, tab order, skip links if needed).
- Accessible names/states for icon controls and toggles; avoid div-as-button patterns.
- Theme guardrails: at least a “Default” and “High contrast” preset; verify status colors are never color-only.
- iOS Safari pass on login + events + key forms; avoid `100vh` traps (prefer `dvh/svh` tolerant layouts).
**Addresses:** Mobile responsiveness; accessibility baseline; theme/contrast regressions.  
**Avoids:** A11y regressions; mobile Safari keyboard/viewport issues; action discoverability loss.
**Guardrails against drift:**
- No copy changes that alter meaning; keep labels mapped 1:1 to existing states.
- Reduced-motion compliance for any animations.
**Optional deps justified:** consider Radix `Dialog` **only** if you add modals/popovers and can’t meet a11y reliably with inline panels.

### Phase 4 (optional): Manager/Admin ergonomics (time-boxed)
**Rationale:** Improves operator throughput if current flows are painful, but should not destabilize the participant experience.  
**Delivers:** Small workflow components (dialogs/confirmations), consistent busy/disabled states, clearer empty/error states, minimal sorting/filtering where needed.  
**Addresses:** Faster create/edit flows; operator usability under pressure.  
**Avoids:** Over-nested navigation; dashboard scope creep; coupling to Events feature.
**Optional deps justified:** `@tanstack/react-table` only if you hit real table complexity; otherwise keep native tables.

### Phase Ordering Rationale

- App-shell contracts first prevents later UI work from “discovering” routing/guard inconsistencies mid-stream.
- Event-board scanability second delivers the primary v1.1 value quickly and keeps SSE/derived-state correctness centralized.
- Responsive/a11y hardening third ensures polish doesn’t regress usability and catches mobile Safari issues before release.
- Manager/Admin ergonomics last, time-boxed, to avoid destabilizing the core participant flow.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Mobile Safari/PWA edge cases):** validate viewport/keyboard behavior and any PWA “standalone” differences on target devices/browsers.
- **Phase 4 (Admin workflows):** depends on actual pain points; confirm which flows are used most during LAN operations.

Phases with standard patterns (skip research-phase):
- **Phase 1 (modularization + hash routing contracts):** well-known SPA patterns; align with current repo constraints.
- **Phase 2 (status/capacity/voting UI):** standard derived-state mapping and scanability patterns; main risk is duplication, not novelty.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Clear recommendation: keep deps minimal; optional deps are conditional and specific. |
| Features | MEDIUM-HIGH | Strong consensus on table stakes for an event board + role-based nav; some differentiators are “nice-to-have” and should be time-boxed. |
| Architecture | HIGH | Proposed boundaries and patterns are conventional and fit Hermes’ current hash-routing + server-truth model. |
| Pitfalls | MEDIUM | UX pitfalls are strong and actionable; document includes additional unrelated security pitfall matrix (scope mixed). |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Current UI pain points validation:** confirm which Manager/Admin flows are actually used most during a LAN to scope Phase 4.
- **Device/browser coverage:** confirm target devices (iOS Safari versions, Android Chrome) for the mobile QA pass.
- **Hash routing + anchors policy:** decide explicitly whether hash is routing-only (recommended) to avoid fragment collisions.

## Sources

### Primary (HIGH confidence)
- `.planning/research/STACK.md` — dependency recommendations and “stay lean” rationale
- `.planning/research/FEATURES.md` — table stakes, differentiators, anti-features for UX polish
- `.planning/research/ARCHITECTURE.md` — client modularization + routing/error patterns
- `.planning/research/PITFALLS.md` — UX/a11y/realtime/hash routing/mobile Safari pitfalls (plus an additional security matrix noted above)

---
*Research completed: 2026-04-16*  
*Ready for roadmap: yes*

# Research Summary

## Executive Recommendation

Keep Hermes on the current single-instance stack: React/Vite frontend, Express API, SQLite with Drizzle migrations, Web Push, Docker packaging, and Wasabi/S3-compatible snapshot storage. The next milestone should not replace core technology. It should make the existing LAN-party workflow safer and more reliable under real use.

The release-critical work is hardening, not feature expansion: reduce auth and invite abuse, make event capacity and invite limits transactionally correct, make backup/restore safe enough for operators, improve PWA notification expectations, split the frontend monolith, and document production deployment assumptions clearly.

## Top Priorities

1. Harden auth and invite registration with rate limits, generic login-code responses, challenge cleanup, safer invite handling, and tests for negative paths.
2. Prevent data-loss in backup/restore with pre-restore backup, schema/table validation, real foreign-key check failure handling, explicit restore column mapping, and operator recovery output.
3. Enforce data consistency for concurrent invite use and event participation so `maxUses` and `maxPlayers` cannot be oversubscribed.
4. Improve mobile/PWA notification reliability by surfacing secure-context/browser limitations in the UI and making the service worker defensive against malformed payloads.
5. Extract `src/main.tsx` into focused frontend modules before adding more admin, profile, or notification UI.
6. Expand focused verification coverage around auth abuse controls, invite limits, concurrent joins, restore, session/device revocation, push payload handling, and admin destructive actions.

## Key Risks

- Auth endpoints can leak user existence or be abused if OTP request/verification and public invite registration are not throttled.
- Session tokens stored in snapshots are sensitive; raw tokens at rest and weak production cookie settings raise operational risk.
- Invite `maxUses` and event `maxPlayers` can be violated if checks remain read-then-write instead of transaction-backed.
- S3 snapshots can create false confidence: upload failures, stale snapshots, unsafe restore mechanics, and multiple active writers can lose or overwrite data.
- Restore currently needs stricter validation because column-order assumptions, disabled foreign keys, and incomplete failure checks can corrupt live state.
- Browser push behavior depends on HTTPS, browser support, OS settings, and PWA installation state; custom sounds cannot be promised reliably.
- The frontend is too concentrated in `src/main.tsx`, increasing regression risk for future admin and profile work.
- Local-friendly deployment defaults can be unsafe in production unless the docs and sample env make TLS, secure cookies, SMTP, VAPID, S3 credentials, and single-instance operation explicit.

## Architecture And Stack Decisions

- Keep SQLite as the source of truth for a single active Hermes instance. Do not introduce Postgres, Redis, queues, or multi-instance realtime for the next milestone.
- Keep S3 as snapshot backup/restore storage only. It must not become a distributed database, lock service, or active/active coordination layer.
- Keep SSE for realtime updates and Web Push for notifications. Add resilience and clearer operator guidance instead of replacing them with WebSockets or native apps.
- Keep Express route modules as server feature boundaries. Add narrow helpers for rate limiting, invite consumption, restore validation, and audit redaction when route logic becomes hard to test.
- Keep manual SQL migrations aligned with Drizzle schema. Add validation and tests rather than introducing broad migration tooling.
- Split the frontend by existing conceptual panels: API helpers/types, app shell/routing, event board, auth/profile, push setup, and admin panels.
- Treat backend authorization, transactions, restore validation, and audit redaction as the real safety boundaries. UI role checks and confirmations are useful but not sufficient.

## Suggested Roadmap Themes

1. Security hardening: auth throttling, invite throttling, generic responses, session-token hashing, cookie/CSRF decisions, and redacted audit metadata.
2. Data consistency: transaction-backed invite consumption and participation capacity enforcement with concurrent API tests.
3. Backup and restore safety: validation, pre-restore backup, operator recovery path, backup status visibility, and restore tests.
4. PWA and realtime reliability: service worker hardening, failed-subscription cleanup, SSE heartbeat/reconnect behavior, and in-product secure-context guidance.
5. Frontend maintainability: behavior-preserving extraction from `src/main.tsx` and shared client API/error handling.
6. Operational readiness: Docker non-root runtime, production checklist, env/docs updates, single-writer S3 warnings, and release validation commands.
