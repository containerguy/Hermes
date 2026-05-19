---
created: 2026-04-16T18:04:39.353Z
title: Add device via session QR/link
area: auth
files:
  - src/client/components/LoginPanel.tsx
  - src/main.tsx
  - src/server/http/auth-routes.ts
  - src/server/auth/current-user.ts
  - src/server/auth/sessions.ts
  - src/server/db/schema.ts
---

## Problem

User sollen ein zusätzliches Gerät (z.B. Smartphone/PC) hinzufügen können, ohne erneut einen One-Time Mailcode anzufordern. Das ist besonders während der LAN praktisch, wenn man bereits auf einem Gerät eingeloggt ist und “ein zweites Gerät koppeln” möchte.

## Solution

Session-basiertes Device-Pairing via Link/QR, generiert aus einer gültigen, noch aktiven Session:
- UI in Profil/Login-Seite: “Neues Gerät hinzufügen” → erzeugt kurzlebigen Pairing-Link + QR (z.B. `/#login?pair=...`).
- Server: Admin-frei, aber **auth-required** Endpoint, der ein Pairing-Token generiert, das an die aktuelle Session + User gebunden ist (TTL, one-time use, rate-limited).
- Neues Gerät öffnet Link/scannt QR → submit “Pairing token” (+ optional device name) → Server validiert Token, erstellt neue Session (oder transferiert Login) und markiert Token als verbraucht.
- Sicherheitsanforderungen:
  - Token ist **kurzlebig** (z.B. 5–10 Minuten) und **one-time**.
  - Token ist **an User + Session** gebunden und nur gültig, solange die Ursprungssession aktiv ist.
  - Keine PII im QR/Link (nur opaque Token).
  - Audit-Log für “device_paired” (aggregiert, ohne Token/Secrets).
- Tests:
  - Auth-HTTP Test: aktive Session → generate token → redeem token → zweite Session existiert (und Ursprungssession bleibt aktiv).
  - Negative: abgelaufen/benutzt/Session revoked → 400/401 mit stabilen error codes.
