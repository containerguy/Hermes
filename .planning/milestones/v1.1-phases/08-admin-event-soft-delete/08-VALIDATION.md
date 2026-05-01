# Phase 08: Validation (EVT-04)

## Automated

- `npm test`
- `npm run build`

## Functional Checks (manual spot-check if needed)

- As **admin**, an `archived` or `cancelled` event shows a **Delete** action and deletion removes it from the board after refresh.
- As **manager/user/admin**, soft-deleted events are not visible on the event board.
- Admin audit log shows an entry for the deletion with action `event.soft_delete`.

