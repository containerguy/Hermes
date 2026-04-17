# Hermes

## What This Is

Hermes is a responsive LAN-party coordination WebApp for roughly 25 people. It lets players log in with username and email one-time code, see proposed game rounds, vote `dabei` or `nicht dabei`, find start/server details, and receive notifications across smartphone and PC.

The current product is a brownfield TypeScript/React/Express app with SQLite as the active database and optional Wasabi/S3 snapshot storage. Admins manage users, managers, settings, invite codes, audit logs, backups, restore, and visual theme colors.

## Core Value

During the LAN party, everyone can quickly see which game round is viable, when it starts, who is in, and how to join it.

## Current Milestone: v1.2 Post-LAN Quality of Life

**Goal:** Reduce login/device friction, refresh the look-and-feel for the LAN audience, make admin onboarding faster, ensure notifications are actually perceptible, and keep CI green for the Node 24 cutover.

**Target features:**
- Device recognition on re-login + session-bound device pairing without a second OTP
- Admin-selectable gaming theme presets, custom theme editor, and background image picker
- Project-wide UI copy refresh to a modern/concise/clear voice
- Bulk user import (CSV/JSON) in the AdminPanel with preview & dry-run
- Audio/haptic notification affordances with feature-detected fallbacks
- GitHub Actions pinned for Node.js 24 compatibility

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

### Active (v1.2)

- [ ] **AUTH-01**: Recognize same device on re-login (no duplicate sessions). — Phase 9
- [ ] **AUTH-02**: Session-bound QR/link pairing for additional devices (no extra email OTP). — Phase 9
- [ ] **THEME-01**: Admin theme presets + custom CSS-token themes. — Phase 10
- [ ] **THEME-02**: Admin background image picker from S3 presets. — Phase 10
- [ ] **COPY-01**: UI copy refresh to modern/concise/clear voice. — Phase 10
- [ ] **ADM-02**: Bulk user import (CSV/JSON) in AdminPanel. — Phase 11
- [ ] **NOTIF-01**: Audio/haptic notification UX with feature-detected fallback. — Phase 12
- [ ] **CI-01**: GitHub Actions Node 24 readiness. — Phase 13

### Out of Scope

- Native mobile apps — Hermes remains a web/PWA app for this LAN-party release.
- Built-in TLS, reverse proxy, DNS, and certificate management — deployment infrastructure owns this.
- Multi-instance active/active deployment — S3 is snapshot storage, not a locking database backend.
- Waitlists for full events — product decision is only `dabei` and `nicht dabei`.
- Paid SMS login — email one-time code is used to keep operation free.
- Public SaaS/multi-tenant operation — scope is a self-hosted LAN-party tool.

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
*Last updated: 2026-04-16 — opened milestone v1.2 (Post-LAN Quality of Life)*
