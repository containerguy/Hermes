---
created: 2026-04-16T18:07:14.929Z
title: Update GitHub Actions for Node 24
area: tooling
files:
  - .github/workflows/docker-image.yml
  - .planning/codebase/INTEGRATIONS.md:67
---

## Problem

GitHub Actions warnt, dass JavaScript Actions auf Node.js 20 deprecated sind und ab Juni 2026 standardmäßig auf Node.js 24 laufen. Betroffene Actions im Projekt:
- `actions/checkout@v4`
- `docker/setup-buildx-action@v3`
- `docker/login-action@v3`
- `docker/metadata-action@v5`
- `docker/build-push-action@v6`

Wenn inkompatible Action-Versionen genutzt werden, kann CI ab dem Cutover brechen.

## Solution

CI-Workflow aktualisieren und Node.js 24 Kompatibilität sicherstellen:
- Prüfen, ob es für jede genannte Action aktualisierte Major/Minor Versionen mit Node24-Support gibt und Workflow entsprechend pinnen.
- Optional früh opt-in: `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` im Workflow setzen, um Probleme vorab zu finden.
- Sicherstellen, dass die CI weiterhin `npm ci`, `npm test`, `npm run build`, `npm audit --omit=dev` und Docker Build/Push erfolgreich durchläuft.
- Dokumentation/Notiz in `.planning/codebase/INTEGRATIONS.md` aktualisieren, falls Action-Versionen angepasst wurden.
