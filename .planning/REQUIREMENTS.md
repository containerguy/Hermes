# Requirements: Hermes (v1.1)

**Defined:** 2026-04-16  
**Milestone:** v1.1 — UX Polish  
**Core Value:** During the LAN party, everyone can quickly see which game round is viable, when it starts, who is in, and how to join it.

## v1.1 Requirements

These requirements focus on UI/UX correctness and polish without changing core domain behavior, except where explicitly stated (event deletion after archive/cancel).

### UI/UX Correctness

- [x] **UI-09**: Action buttons are consistently rendered (no overflow/overlap/partial “frame bleed”) across Events, Manager, and Admin views on desktop and mobile.
- [x] **UI-10**: The Admin audit log list is scrollable within its panel and remains usable on narrow screens (header/actions remain accessible while scrolling).

### Event Lifecycle (Operator UX)

- [x] **EVT-04**: Admins can soft-delete events **only after** they are cancelled or archived; deletion removes the event from the board and is captured in the audit log.

## Future Requirements (deferred)

- [ ] **UX-01**: Deeper event visualization (progress-to-min, status timeline) beyond simple badges/meters.
- [ ] **ADM-01**: Advanced admin audit filtering (by user/action/time range) and export.

## Out of Scope (this milestone)

| Item | Reason |
|------|--------|
| Waitlists / new participation states | v1.1 is polish; participation model stays `dabei` / `nicht dabei`. |
| New realtime transport (WebSockets) | SSE is sufficient; focus is UX correctness and stability. |
| Major design-system/UI framework adoption | Keep dependency footprint small; prefer semantic HTML + CSS. |

## Traceability

Every v1.1 requirement maps to exactly one roadmap phase and remains pending until that phase is completed.

| Requirement | Phase | Status |
|-------------|-------|--------|
| UI-09 | Phase 7 | Complete |
| UI-10 | Phase 7 | Complete |
| EVT-04 | Phase 8 | Complete |

