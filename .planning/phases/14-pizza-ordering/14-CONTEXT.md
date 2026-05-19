---
phase: 14-pizza-ordering
status: shipped-out-of-band
opened: 2026-05-01
closed: 2026-05-16
requirements: []
---

# Phase 14: Pizza Ordering — Context

## Why this phase has no PLAN files

The pizza ordering system shipped directly to `main` between 2026-05-01 and 2026-05-16 without a v1.2 phase track. It does not map to any v1.2 milestone requirement (AUTH-01/02, THEME-01/02, COPY-01, ADM-02, NOTIF-01, CI-01) and was not scoped before implementation. This folder exists to backfill retrospective documentation so the planning tree reflects what actually shipped.

## Scope as actually shipped

A LAN-party-wide pizza ordering flow, layered on top of the existing event/auth model:

- One global pizza session (admins/managers open → orders flow → lock → mark paid → delivered).
- Menu items with size variants, prices stored in cents.
- Per-user orders capped at 3 lines, each 1-3 qty + optional 200-char custom note.
- Two PDF outputs: pizzeria call sheet (aggregated by item, no guest names) and Kassenliste (per guest with payment markers, paypal.me/cash recipient).
- Admin: JSON import/export menu editor + three settings keys (`pizzaPaypalHandle`, `pizzaPaypalName`, `pizzaCashRecipient`).
- Da Rosario menu seeded (~85 items) — currently the only seeded menu.

## Out-of-scope

- No CSRF/audit-log decisions beyond reusing the existing `hermes-auth` + `audit-log.ts` patterns.
- No new auth surface.
- No new realtime channel; client polls.
- No requirements-traceability matrix (this phase did not derive from a requirement).

## Architecture decisions worth preserving

- **Single global session, not per-event.** The first cut (commit `170f750`) tied a session to an event; the May-16 refactor (commit `3d1dadd`) removed `event_id` from `pizza_sessions` because a LAN party orders pizza for the whole evening, not per game round. Migration `0018` is the carrier of that decision.
- **Prices in cents, never floats.** All price columns and computations use integer cents; PDF rendering formats at the boundary.
- **Pizza is gated only by login, not by event participation.** Anyone with a session can order while the pizza session is `open`. This intentionally relaxes the original "must be `dabei`" rule that briefly existed (commit `1248546`, reverted in `3d1dadd`) because per-event participation does not map to LAN-wide pizza demand.
- **Menu CRUD via JSON import/export, not inline form.** Commit `d3df6de` shipped an inline CRUD form (`PizzaMenuAdmin.tsx`); commit `3d1dadd` replaced it with `PizzaMenuJsonAdmin.tsx` because the inline form's variant editor was clumsy for ~85 items. The JSON editor upserts items + variants, deactivates missing items, and removes orphan variants not referenced by any order line.

## Migrations introduced

| Migration | Purpose |
|-----------|---------|
| `0016_pizza_order_system.sql` | Initial schema: `pizza_sessions`, `pizza_menu_items`, `pizza_menu_variants`, `pizza_orders`, `pizza_order_lines` |
| `0017_seed_pizza_menu_da_rosario.sql` | Idempotent seed of ~85 Da Rosario items + variants |
| `0018_pizza_session_global.sql` | Drop `event_id` from `pizza_sessions`; LAN-wide model |

These numbers were assigned to pizza, displacing the migration numbers originally reserved by v1.2 phases 10 and 12 (see `ROADMAP.md`). When phases 10/12 resume, their migrations renumber to `0019+`.

## Deferred / known-open items

- No e2e Playwright coverage for the pizza flow.
- PDF print tests are smoke-level (header bytes + non-empty buffer) — no visual regression coverage.
- No payment integration beyond marking `paypal` / `cash` / `unpaid`.
- Only one seeded menu (Da Rosario); the JSON editor is the only path to a different pizzeria.

## Retrospective summary index

| File | Commit | Topic |
|------|--------|-------|
| `14-01-server-system-SUMMARY.md` | `170f750` | Initial server-side ordering + PDF |
| `14-02-client-and-seed-SUMMARY.md` | `ff1f74c` | Client UI + Da Rosario seed + settings keys |
| `14-03-revoke-cancels-order-SUMMARY.md` | `1248546` | Auto-cancel on dabei-revoke (later reverted) |
| `14-04-admin-and-pdf-tests-SUMMARY.md` | `d3df6de` | Inline admin CRUD + settings inputs + PDF tests |
| `14-05-session-global-refactor-SUMMARY.md` | `3d1dadd` | LAN-wide session, JSON menu editor, dabei-gate removal |
