# Hermes

## What This Is

Hermes is a responsive LAN-party coordination WebApp for roughly 25 people. It lets players log in with username and email one-time code, see proposed game rounds, vote `dabei` or `nicht dabei`, find start/server details, and receive notifications across smartphone and PC.

The current product is a brownfield TypeScript/React/Express app with SQLite as the active database and optional Wasabi/S3 snapshot storage. Admins manage users, managers, settings, invite codes, audit logs, backups, restore, and visual theme colors.

## Core Value

During the LAN party, everyone can quickly see which game round is viable, when it starts, who is in, and how to join it.

## Current Milestone: v2.0 COD4 Key Generator

**Goal:** Generate a COD4-compatible CD key directly inside the COD4 game card so planners do not have to switch to an external tool during setup.

**Target features:**
- Show a "Generate COD4 Key" affordance on the game card when the planned game is COD4
- Generate a COD4-compatible key client-side (no server, no persistence)
- Display the generated key in the card with a copy-to-clipboard button
- Allow regeneration of the key in place

## Requirements

### Validated

- ✓ User can log in with username and email one-time code — existing
- ✓ User can stay logged in on multiple devices and manage active sessions — existing
- ✓ User can enable/disable notifications and register Web Push subscriptions per device — existing
- ✓ User can view events and vote `dabei` or `nicht dabei` — existing
- ✓ Manager/admin can create events with game, start mode/time, min/max players, server host, and connection details — existing
- ✓ Manager/admin/event creator can update start time and archive or cancel events — existing
- ✓ Events transition through open, ready, running, cancelled, and archived states, including automatic archive after the configured window — existing
- ✓ Admin can create, role-change, soft-delete users, and define managers — existing
- ✓ Admin can configure app settings, default notifications, public registration, theme colors, and auto-archive hours — existing
- ✓ Admin can create/revoke invite codes for public registration — existing
- ✓ Admin can view audit logs for auth, participation, user, settings, invite, event, backup, and restore actions — existing
- ✓ App can run as a Dockerized single-instance Node/Express app with local SQLite — existing
- ✓ App can persist/restore SQLite snapshots with S3-compatible Wasabi storage — existing
- ✓ GitHub Actions builds/tests/audits and builds/publishes Docker images to GHCR — existing
- ✓ Auth + invite registration hardening (throttling, non-enumerating responses, safer invite lifecycle) — Validated in Phase 1
- ✓ Concurrent invite usage + event participation capacity consistency — Validated in Phase 2
- ✓ Backup/restore safety (status visibility, validation-first restore, pre-restore recovery snapshots, safe diagnostics) — v1.0 (Phases 3, 6)
- ✓ PWA/push reliability (in-product limitations, SW hardening, failing subscription cleanup) — v1.0 (Phases 4, 6)
- ✓ Frontend modularization (split modules for events/login/admin) — v1.0 (Phase 5)
- ✓ Release verification + deployment contract docs — v1.0 (Phase 6)

### Active (v2.0)

- [ ] **COD4-01**: Show "Generate COD4 Key" button on the COD4 game card when the planned game is COD4. — Phase 14
- [ ] **COD4-02**: Generate a COD4-compatible CD key client-side without server roundtrip or persistence. — Phase 14
- [ ] **COD4-03**: Display the generated key in the card with a copy-to-clipboard control and a regenerate control. — Phase 14

### Out of Scope

- Native mobile apps — Hermes remains a web/PWA app for this LAN-party release.
- Built-in TLS, reverse proxy, DNS, and certificate management — deployment infrastructure owns this.
- Multi-instance active/active deployment — S3 is snapshot storage, not a locking database backend.
- Waitlists for full events — product decision is only `dabei` and `nicht dabei`.
- Paid SMS login — email one-time code is used to keep operation free.
- Public SaaS/multi-tenant operation — scope is a self-hosted LAN-party tool.
- Device recognition on re-login + session-bound device pairing — abandoned from v1.2 (Phase 9 partially shipped, remaining work deprioritized).
- Admin theme presets, custom theme editor, background image picker — abandoned from v1.2.
- Project-wide UI copy refresh — abandoned from v1.2.
- Bulk user import (CSV/JSON) in AdminPanel — abandoned from v1.2.
- Audio/haptic notification UX — abandoned from v1.2.
- GitHub Actions Node 24 readiness as a planned milestone item — abandoned from v1.2 (will track ad-hoc).
- Server-side persistence of generated COD4 keys — keys are ephemeral; no DB row, no audit log entry.
- Generators for other games (CS, Quake, etc.) — only COD4 in scope; other generators can be added later milestones.

## Context

Hermes started as a fast planning and implementation effort for an upcoming LAN party. The codebase already contains the core release surface: React/Vite client, Express API, SQLite persistence, Drizzle schema, explicit SQL migrations, mail OTP, session cookies, SSE realtime updates, Web Push, Docker packaging, Wasabi S3 snapshot storage, admin settings, invite registration, audit logs, and a GitHub image pipeline.

The current codebase map is in `.planning/codebase/`. Important reference docs:

- `.planning/codebase/ARCHITECTURE.md` — runtime architecture, API layers, data flow.
- `.planning/codebase/STACK.md` — TypeScript, React, Express, SQLite, Drizzle, Vite, Docker, CI.
- `.planning/codebase/CONCERNS.md` — auth abuse controls, restore risks, concurrency, frontend monolith, deployment gaps.
- `ideas.md` — original product planning history and work package checks.
- `README.md` and `building.md` — current operator and build documentation.

Known current constraints and risks:

- Browser push on smartphones requires HTTPS or localhost; Hermes intentionally does not ship TLS.
- Web Push can request vibration/OS notification behavior but cannot force custom notification sounds reliably on iOS/Android.
- SQLite plus S3 snapshots assumes one running Hermes writer instance.
- Playwright browser execution is blocked in the current environment by missing `libnspr4.so`, though tests are present.
- `src/main.tsx` is large and should not absorb unlimited new UI scope without extraction.

## Constraints

- **Tech stack**: TypeScript, React/Vite, Express, SQLite, Drizzle, Web Push, Docker — already implemented and should be preserved unless a concrete risk demands change.
- **Deployment**: Single Dockerized app is the target; SSL/TLS and reverse proxy remain out of scope for Hermes itself.
- **Storage**: Local SQLite is the active database; Wasabi/S3 is snapshot backup/restore, not multi-writer storage.
- **Scale**: Optimize for about 25 LAN-party participants, not public SaaS scale.
- **Login cost**: Login codes are sent by email, not SMS.
- **Participation model**: Only `dabei` and `nicht dabei`; no waitlist.
- **Compatibility**: Smartphone and PC browsers must both be usable; push quality depends on PWA/secure-context limitations.
- **Security**: Credentials and secrets must remain in env vars or local ignored files, never planning docs.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use username + email one-time code login | Free to operate and simple for LAN users | ✓ Good |
| Keep phone number out of login | User requested username-only login and phone is not relevant | ✓ Good |
| Use SQLite as active database | Small single-instance LAN app does not need external DB complexity | ✓ Good |
| Use Wasabi/S3 as snapshot backend | User requested S3 storage; snapshot model keeps app simple | ⚠️ Revisit if multi-instance needed |
| Keep SSL/TLS out of scope | User explicitly excluded SSL handling | ✓ Good |
| Use Web Push for notifications | Works across devices when secure-context requirements are met | ⚠️ Revisit for LAN HTTPS setup |
| Use invite codes for public registration | Admin can prepare LAN parties without manually creating every user | — Pending |
| Use soft-delete for users | Preserves historical events/audit while removing active access | — Pending |
| Track admin operations in audit logs | Needed for diagnosing participation and operational actions | — Pending |
| Keep current app as a single image | Simplest deployable artifact for the event | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-01 — abandoned v1.2 remaining phases; opened milestone v2.0 (COD4 Key Generator)*
