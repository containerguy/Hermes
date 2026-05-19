---
phase: 14-pizza-ordering
plan: 01
subsystem: pizza
tags: [server, sqlite, drizzle, pdfkit, domain-modules]
commit: 170f750
shipped: 2026-05-01
---

# 14-01: Server-side order system

Initial cut of the pizza ordering server: schema, domain modules, HTTP routes, and PDF generation. At this point the session was still tied to an event (`event_id` FK on `pizza_sessions`). The dabei-gate was enforced so only joined participants could place lines.

## Files created

- `src/server/db/migrations/0016_pizza_order_system.sql` — `pizza_sessions`, `pizza_menu_items`, `pizza_menu_variants`, `pizza_orders`, `pizza_order_lines`
- `src/server/db/schema.ts` — Drizzle schema additions
- `src/server/domain/pizza/lifecycle.ts` — session state transitions (draft → open → locked → delivered) + `PizzaLifecycleError`
- `src/server/domain/pizza/menu.ts` — menu queries, item/variant lookups
- `src/server/domain/pizza/order-limits.ts` — `PIZZA_MAX_LINES_PER_ORDER = 3`, `normalizeNote` (200-char cap), `PizzaOrderLimitError`
- `src/server/domain/pizza/orders.ts` — order/line CRUD, price-snapshot at write time, `PizzaOrderError`
- `src/server/domain/pizza/sessions.ts` — session CRUD + status queries
- `src/server/domain/pizza/totals.ts` — per-order and per-session totals
- `src/server/http/pizza-routes.ts` — REST surface for guests and managers
- `src/server/pdf/pizza-print.ts` — `buildPizzeriaPdf` (aggregated call sheet), `buildKassenlistePdf` (per-guest payment list)

## Tests added

- `src/server/domain/pizza/lifecycle.test.ts` — state machine + invalid-transition rejection
- `src/server/domain/pizza/order-limits.test.ts` — line cap + note normalization
- `src/server/domain/pizza/totals.test.ts` — cents-only arithmetic, per-guest aggregation

25 unit tests total.

## Architecture decisions captured

- **Cents-only money.** Every price column is `integer NOT NULL` cents. Formatting to `EUR x,xx` happens at PDF render time only.
- **Price snapshot at order time.** `pizza_order_lines.price_cents` is captured from the variant at write, so menu edits don't retroactively change historical totals.
- **Authorization via `canManageEvent`.** Manager actions (open/close session, mark paid, generate PDF) reuse the existing event-permission helper. Guest actions check session state + dabei-gate (this gate was later removed in 14-05).

## Dependencies added

- `pdfkit@^0.18.0` — runtime PDF generation
- `@types/pdfkit@^0.17.6` — devDep

## Endpoint surface (as shipped in this commit)

| Method | Path | Audience |
|--------|------|----------|
| GET | `/api/events/:eventId/pizza/session` | guest + manager |
| POST | `/api/events/:eventId/pizza/session` | manager (create/open) |
| PATCH | `/api/events/:eventId/pizza/session` | manager (status transitions) |
| GET | `/api/events/:eventId/pizza/menu` | guest |
| POST | `/api/events/:eventId/pizza/orders` | guest (joined only) |
| PATCH | `/api/events/:eventId/pizza/orders/:orderId` | order owner |
| DELETE | `/api/events/:eventId/pizza/orders/:orderId` | order owner or manager |
| GET | `/api/events/:eventId/pizza/print/pizzeria` | manager |
| GET | `/api/events/:eventId/pizza/print/kassenliste` | manager |

(Path structure changed in 14-05 — see that summary.)

## Deferred from this cut

- Client UI (lands in 14-02).
- Seeded menu (lands in 14-02).
- Admin menu CRUD (lands in 14-04).
