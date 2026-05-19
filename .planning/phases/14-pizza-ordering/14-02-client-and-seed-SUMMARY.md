---
phase: 14-pizza-ordering
plan: 02
subsystem: pizza
tags: [client, react, seed-data, settings]
commit: ff1f74c
shipped: 2026-05-01
---

# 14-02: Full client UI, Da Rosario seed, settings keys

Guest-facing pizza UI mounted inside each event detail panel (later moved to start-page-global in 14-05). Idempotent seed of the Pizzeria da Rosario menu. Three settings keys added so the client can build paypal.me links and the Kassenliste PDF can name the cash recipient.

## Files created

- `src/client/pizza/api.ts` — typed REST client for `/api/events/:eventId/pizza/*`
- `src/client/pizza/types.ts` — shared TypeScript types for menu, session, order, line
- `src/client/pizza/PizzaPanel.tsx` (587 lines) — menu browser, line editor, "Mein Anteil" post-lock view, manager overview with payment marking + PDF download
- `src/server/db/migrations/0017_seed_pizza_menu_da_rosario.sql` (189 lines) — deterministic seed (numbered pizzas 01-411, specialty pizzas, pasta, baked Aufläufe, Cannelloni, La Pladina) using fixed item IDs for idempotency

## Files modified

- `src/client/components/EventBoard.tsx` — mounts `<PizzaPanel>` inside the event-detail expansion
- `src/client/components/AdminPanel.tsx` — adds the three pizza settings inputs to the Betrieb section
- `src/client/types/core.ts` — extends `AppSettings` / `PublicAppSettings` with `pizzaPaypalHandle`, `pizzaPaypalName`, `pizzaCashRecipient`
- `src/main.tsx` — wires pizza settings through the runtime config
- `src/styles.css` — pizza panel styling
- Three test fixtures (`admin-panel.test.tsx`, `login-panel.test.tsx`, `ui-correctness.test.tsx`) — extended `AppSettings` test data with the three new keys

## Settings keys added

| Key | Purpose | Default |
|-----|---------|---------|
| `pizzaPaypalHandle` | paypal.me/<handle> for the kassenliste deep link | `""` |
| `pizzaPaypalName` | Display name in the kassenliste PDF | `""` |
| `pizzaCashRecipient` | Cash collector named in the kassenliste PDF | `""` |

All three default to empty so the feature is dormant until configured.

## UX flow shipped

1. While `session.status === "open"`: guest browses menu grouped by `pizza` / `pasta` category, expands an item to choose a size variant, sets qty 1-3, optional 200-char note, saves a line. Up to 3 lines per guest enforced server-side.
2. While `session.status === "locked"`: guest sees "Mein Anteil" — their own lines, total in EUR, paypal.me deep link if `pizzaPaypalHandle` is set, payment status badge.
3. Manager view (visible to anyone with `canManageEvent`): per-guest payment status, mark-paid controls, two PDF download buttons.

## Notable implementation details

- Seed uses fixed item IDs so re-running the migration is safe — items keep their IDs across reseeds.
- Prices stored as integer cents in the SQL seed.
- `PizzaPanel.tsx` was the largest single file added in this commit (587 lines); some of that was refactored away in 14-05 when the menu CRUD moved out.

## Deferred

- Admin menu editing (no path to add/edit/remove items yet — lands in 14-04 as an inline form, then in 14-05 as a JSON editor).
