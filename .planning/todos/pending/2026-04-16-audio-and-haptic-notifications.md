---
created: 2026-04-16T18:13:09.378Z
title: Audio and haptic notifications
area: ui
files:
  - src/main.tsx
  - public/sw.js
  - src/server/push/push-service.ts
  - src/server/http/push-routes.ts
---

## Problem

Benachrichtigungen sollen – wo technisch möglich – akustisch (Sound) oder haptisch (Vibration) auf den Geräten wahrnehmbar sein. Aktuell sind Push/Notifications vorhanden, aber es fehlt eine gezielte UX für “hörbar/spürbar” und die technischen Fallbacks je Plattform.

## Solution

Benachrichtigungs-Erlebnis verbessern mit Plattform-angepassten Optionen:
- Web Push/Notifications:
  - Payload/notification options so erweitern, dass OS/Browser Sound/Haptik nutzen können (wo verfügbar).
  - In-App Hinweise/Settings, welche Möglichkeiten auf dem Gerät existieren (Permission/OS restrictions).
- In-App Haptik (wo erlaubt):
  - Für direkte UI-Aktionen/Realtime Events optional `navigator.vibrate(...)` nutzen (nur bei User-Interaktion / wenn API verfügbar).
- UX/Settings:
  - Toggle in Profil/Settings: “Haptik aktiv” / “Akustische Hinweise” (mit Erklärung, dass OS es ggf. überschreibt).
  - Gute Defaults + klare Fallbacks (keine Errors, wenn nicht unterstützt).
- Tests:
  - Unit/UI tests: Feature-Detection und dass Calls nur stattfinden, wenn APIs vorhanden sind.
  - Push tests (server): payload enthält erwartete Felder (ohne Annahmen über client OS).
