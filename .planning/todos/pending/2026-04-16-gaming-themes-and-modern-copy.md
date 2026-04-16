---
created: 2026-04-16T18:12:00.323Z
title: Gaming themes and modern copy
area: ui
files:
  - src/styles.css
  - src/main.tsx
  - src/client/components/AdminPanel.tsx
  - src/server/http/admin-routes.ts
  - src/server/settings.ts
  - src/server/storage/s3-storage.ts
---

## Problem

Die aktuellen Texte wirken nicht modern/knapp/klar, und das Design ist insgesamt zu schlicht. Für ein Gaming/LAN-Setting soll die UI “knalliger” wirken und mehrere Designs anbieten, die zentral vom Admin auswählbar sind.

Zusätzlich sollen Admins:
- vorgefertigte Designs auswählen können,
- eigene Designs erstellen/ändern können,
- Hintergrundbilder zentral ändern können,
- und eine Auswahl an Hintergrundbildern aus KI-generierten Presets nutzen können, die im S3 Snapshot Storage abgelegt sind.

## Solution

UI/Theme-System + Copywriting-Überarbeitung als zusammenhängendes Feature:
- Copy Refresh: alle UI-Texte auf Stil “modern, knapp, klar” überarbeiten (Titel, Beschreibungen, Buttons, Hinweise, Fehlertexte – ohne technische Details zu verlieren).
- Theme presets: mehrere “Gaming” Presets (Farben, Kontrast, Buttons, Cards, Pills) definieren und im Admin-Bereich auswählbar machen.
- Custom themes: Admin-Editor für eigene Theme-Variablen (CSS Tokens) + Speichern in Settings/DB; aktive Theme-Auswahl wird clientseitig angewendet.
- Background images:
  - Admin kann Hintergrundbild auswählen (Preset oder Custom Upload/URL – TBD).
  - Client rendert Background so, dass Lesbarkeit erhalten bleibt (Overlay/Blur/Contrast).
- KI-generierte Preset-Bilder:
  - Pipeline/Job, der eine kuratierte Auswahl an Bildern generiert und im S3 speichert (Hermes-spezifischer Prefix).
  - Admin UI listet verfügbare Preset-Bilder aus S3 und erlaubt Auswahl als aktives Background.
  - Safety: keine Secrets/Prompts im Audit; klare Größen-/Format-Limits; Caching/Thumbnailing falls nötig.
- Tests:
  - UI: Snapshot/structure tests für Theme Anwendung (z.B. CSS variables gesetzt).
  - API: Admin endpoints für Theme/Background Update + Validierung.
