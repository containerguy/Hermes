---
created: 2026-04-16T18:02:53.264Z
title: Recognize device on re-login
area: auth
files:
  - src/client/components/LoginPanel.tsx
  - src/server/http/auth-routes.ts
  - src/server/auth/sessions.ts
  - src/server/db/schema.ts
---

## Problem

Wenn sich ein User vom gleichen Gerät erneut einloggt, wird das Gerät aktuell nicht zuverlässig wiedererkannt. Das führt zu doppelten/unnötigen Sessions und macht die Geräteübersicht unübersichtlich.

## Solution

Geräte-Wiedererkennung beim Login durch gerätetypische Merkmale, ohne invasive Fingerprinting-Methoden:
- Client sendet bei Login/Verify zusätzlich stabile, “low entropy” Merkmale (z.B. Plattform/OS, Browser-Familie, grobe Device-Klasse mobile/desktop, PWA yes/no) und/oder einen lokalen Device-Token (localStorage) als “device key”.
- Server mappt auf bestehende Session/Device-Eintrag: wenn gleicher User + gleiche Device-Key/Fingerprint, dann Session-Namen/Eintrag aktualisieren statt neu anzulegen (oder alte Session revoken/ersetzen – TBD).
- Privacy/Security: keine hochentropischen Fingerprints (Canvas/WebGL), keine eindeutige cross-site Identifikation; Device-Key ist Hermes-spezifisch und rotierbar (z.B. bei Logout “Gerät vergessen”).
- Tests: Login-Flow (auth-routes) deckt Re-Login vom gleichen Device ab (Erwartung: 1 Device-Eintrag / konsistente Benennung).
