---
created: 2026-04-16T18:01:44.710Z
title: Bulk import of users
area: ui
files:
  - src/client/components/AdminPanel.tsx
  - src/server/http/admin-routes.ts
  - src/server/db/schema.ts
  - src/main.tsx
---

## Problem

User-Anlage ist aktuell auf einzelne Einträge über das Admin-UI/API ausgelegt. Für bestehende LAN-Listen (z.B. aus Excel/CSV) ist das zu langsam und fehleranfällig.

## Solution

Bulk-Import für User (z.B. CSV/JSON) im Admin-Bereich:
- UI im Adminbereich zum Upload/Paste (Preview + Validierung + Duplikat-Check).
- Server-Endpoint (admin-only) für Import mit Zod-Validation, dry-run/preview Option und transaktionalem Write.
- Regeln: eindeutige Username/Email, optionales Setzen von Role, Defaultwerte (notificationsEnabled), sauberes Audit-Logging pro Import (aggregiert + ggf. pro User).
