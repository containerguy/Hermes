# Feature Landscape — Hermes v1.1 UX Polish

**Domain:** LAN-party coordination webapp (events + participation voting + admin/manager console)
**Researched:** 2026-04-16
**Scope:** UI/UX polish and clarity only (no core behavior changes)

## Table Stakes

Features users expect. Missing = the app feels confusing or unreliable during the LAN.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Clear primary navigation (Events / Profile / Manager / Admin) | Users must instantly find the “thing they need” with minimal thinking | Med | Separate areas by role and intent; show/hide based on role; keep a consistent top-level IA on mobile + desktop |
| “Where am I?” cues (active section + page title) | Prevents getting lost when switching between phone and PC | Low | Active nav state, page header, breadcrumbs only if needed (avoid deep nesting) |
| Event board that is scannable at a glance | Core value: quickly see what’s viable, when it starts, who’s in | Med | Cards/rows optimized for fast scanning: status, start time, game, min/max, “you’re in/out” state |
| Strong status visualization (open/ready/running/cancelled/archived) | Users need to understand what actions are possible right now | Med | Color + icon + label (never color alone); status should drive available actions and disable invalid ones |
| Capacity visualization (min/max + current “dabei”) | The “is it happening?” question depends on quorum | Med | Show current count prominently; show progress-to-min; show “full” state; keep consistent with capacity rules |
| Obvious voting affordances (“dabei” / “nicht dabei”) | Primary participant action must be fast and unambiguous | Low/Med | Make the current choice visible; avoid accidental taps; provide immediate feedback (optimistic UI if realtime supports it) |
| Join details discoverability (server host + connection details) | Once a round is viable/running, users must know how to join | Med | Keep details one tap away; allow copy-to-clipboard; present differently on mobile (single “Copy join info”) |
| “My participation” and session context | Users need confidence the app reflects them (and that they’re logged in) | Low | Profile area shows username/email, notification status, device subscriptions; quick “Log out” |
| Manager/admin ergonomics: fast create/edit flows | Organizers operate under time pressure | Med | Use defaults, reduce form friction, keep edit actions near the event, avoid multi-screen wizard unless necessary |
| Mobile-first responsiveness | Most participants will check on smartphones during the LAN | Med | Large tap targets, sticky key actions, avoid dense tables; responsive typography and spacing |
| Accessibility baseline (WCAG-minded) | Prevents failure modes: unreadable contrast, unusable keyboard nav, screen-reader confusion | Med | Contrast-safe palette, focus rings, keyboard navigation, semantic headings, ARIA only where needed |
| Error and empty states that guide next action | Prevents stalls: “nothing here / what do I do?” | Low | Empty events state with “Ask a manager to create an event”; errors with recover actions (retry, re-auth) |

## Differentiators

Features that aren’t strictly required for v1.1, but meaningfully improve “LAN-night usability” and perceived polish.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Event viability “at-a-glance” tile | Instantly answers: “Will this run?” | Med | Combine status + progress-to-min + start mode/time into one compact “verdict” area |
| Live-updating board with subtle motion | Makes realtime feel reliable without being distracting | Med | Gentle highlight when an event changes; avoid toast spam; honor reduced-motion |
| “Your next action” cues per event | Reduces decision fatigue and missed steps | Med | Examples: “Vote now”, “Ready — check join info”, “Running — join server”, “Archived — view summary” |
| Compact + expanded views toggle | Works for both phone quick-check and PC planning | Med | Default to compact on mobile; allow “expand details” per event; keep state stable across navigation |
| Admin/Manager “operator modes” | Speeds up common admin flows | Med | Examples: bulk manage invite codes, quick toggle of settings, “recent audit events” skim view |
| Theme + contrast presets | Keeps brand/custom theme while staying accessible | Low/Med | Provide safe presets (High Contrast / Default) even if custom colors are supported |
| Single-tap copy actions | Reduces friction joining games | Low | Copy server host, password, full join string; show confirmation; works on mobile reliably |
| “What changed” indicator | Helps users trust the board | Med | “Updated 20s ago” or per-card “changed” badge; avoid heavy logging UI for participants |

## Anti-Features (Explicitly Not v1.1)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|--------------------|
| Waitlists / “maybe” participation | Out of scope by product decision; adds coordination ambiguity | Keep strict `dabei` / `nicht dabei` and clearer capacity + viability UI |
| Major new domain flows (chat, LFG, matchmaking) | High scope and behavior change | Improve the existing event board and voting clarity |
| Multi-instance / multi-tenant UI concepts | Conflicts with single-instance LAN goal | Keep UI optimized for one party and one server |
| Deep analytics dashboards | Doesn’t help during LAN time pressure; adds complexity | Lightweight admin “recent activity” and clear audit log entry points |
| Over-nested navigation or settings sprawl | Makes the app harder to operate under time pressure | Strong top-level IA + role-based grouping + search/filters where needed |

## Feature Dependencies

```
Clear navigation → Better separation of Manager/Admin → Faster admin ergonomics
Event status visualization → Action affordances → Reduced mis-clicks / invalid actions
Capacity visualization → Viability at-a-glance → Better event board scanning
Mobile responsiveness → Tap-safe voting + copy actions → Reliable “join” on phone
A11y baseline → Theme/contrast presets → Safer custom theme colors
```

## MVP Recommendation (v1.1 UX Polish)

Prioritize:
1. **Clear navigation & separation** (Events / Profile / Manager / Admin) with role-aware gating
2. **Event board scanning improvements** (status + capacity + your vote + join details discoverability)
3. **Responsive + a11y pass** (tap targets, contrast, focus, reduced-motion)

Defer:
- **Operator modes / bulk admin enhancements** unless the current flows are clearly painful in practice
- **View toggles and “what changed” indicators** if they risk destabilizing core screens late in the milestone

## Sources

- `.planning/PROJECT.md` (Hermes v1.1 UX Polish goals and constraints)
