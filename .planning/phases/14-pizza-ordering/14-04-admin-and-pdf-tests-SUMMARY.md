---
phase: 14-pizza-ordering
plan: 04
subsystem: pizza
tags: [admin-ui, settings, pdf, tests]
commit: d3df6de
shipped: 2026-05-01
status: partially-superseded-in-14-05
---

# 14-04: Admin menu CRUD form, settings inputs, PDF render tests

Adds an inline pizza menu CRUD form to the Betrieb admin section, surfaces the three pizza settings as form inputs, and adds smoke tests for the two PDF builders. The inline CRUD form was later replaced by a JSON editor in 14-05.

## Files created

- `src/client/pizza/PizzaMenuAdmin.tsx` (359 lines) — inline menu editor: list items with editable number/name/category/sort-order/ingredients/allergens, toggle active state, manage size variants with cents-input, create new items inline. Calls `/api/pizza/admin/*` and refetches after each mutation. **Removed in 14-05** in favor of the JSON editor.
- `src/server/pdf/pizza-print.test.ts` — smoke tests for `buildPizzeriaPdf` and `buildKassenlistePdf`: header bytes are valid PDF (`%PDF-`), output buffer is non-empty, empty-input does not throw

## Files modified

- `src/client/components/AdminPanel.tsx` — mounts `<PizzaMenuAdmin>` and adds the three settings inputs (PayPal handle, PayPal name, cash recipient) to the Betrieb form
- `src/styles.css` — admin form styling

## Tests added

- `src/server/pdf/pizza-print.test.ts` — two smoke tests covering both PDF builders (header bytes + non-empty buffer + empty-input safety)

## Why the inline CRUD form was replaced

The inline form's variant editor was clumsy for menus on the order of ~85 items: each item required multiple expand/save round-trips, and bulk operations (e.g., updating prices after a price change at the pizzeria) were impractical. 14-05 replaced it with a JSON import/export editor that handles the whole menu in one upsert.

## Retained from this commit

- The three settings inputs in AdminPanel remain.
- The PDF tests remain — they are the only test coverage of the print pipeline.

## Removed in 14-05

- `PizzaMenuAdmin.tsx` deleted (359 lines)
- Mount point in `AdminPanel.tsx` replaced with `<PizzaMenuJsonAdmin>`
