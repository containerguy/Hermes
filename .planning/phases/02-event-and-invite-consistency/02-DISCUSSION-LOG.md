# Phase 2: Event And Invite Consistency - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `02-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 02 — Event And Invite Consistency
**Areas discussed:** Invite maxUses, Event maxPlayers, Side-effects coherence

---

## Invite maxUses

| Option | Description | Selected |
|--------|-------------|----------|
| 403 `invite_ausgeschoepft` | Klar für Nutzer, entspricht aktuellem Verhalten | ✓ |
| 409 Conflict | Konflikt-Semantik | |
| 403 `invite_ungueltig` | Weniger Info, schlechtere UX | |

**User's choice:** 403 `invite_ausgeschoepft`
**Notes:** Rejected Registrierungen sollen audit-loggt werden.

---

| Option | Description | Selected |
|--------|-------------|----------|
| No audit | Nur Erfolg auditieren | |
| Audit redacted | inviteCodeId/Label ohne mehr Kontext | |
| Audit full context | inkl. IP/Username in metadata (sofern verfügbar) | ✓ |

**User's choice:** Audit full context

---

| Option | Description | Selected |
|--------|-------------|----------|
| Fail-fast | Keine Retries | |
| Single retry | 1 kurzer Retry bei DB contention/locking | ✓ |
| Few retries | 2-3 Retries mit Backoff | |

**User's choice:** Single retry

---

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal | `{ user, codeSent: true }` | |
| Include remainingUses | Zusätzliche Info bei Erfolg | ✓ |
| Let Claude decide | Claude entscheidet | |

**User's choice:** Include remainingUses

---

## Event maxPlayers

| Option | Description | Selected |
|--------|-------------|----------|
| 409 `event_voll` | Konflikt, klares Signal | ✓ (implizit) |
| 403 `event_voll` | „nicht erlaubt“ Semantik | |
| 200 OK w/ state | UI reloadt ohne Fehler | |

**User's choice:** 409 `event_voll`
**Notes:** UI soll verständlich kommunizieren „z.B. Spieler 9 von max 8“ und ggf. neues Event vorschlagen.

---

| Option | Description | Selected |
|--------|-------------|----------|
| No audit | Nur Erfolg auditieren | |
| Audit minimal | eventId + actor + reason | |
| Audit full | inkl. vorher/nachher + joinedCount/maxPlayers (sofern verfügbar) | ✓ |

**User's choice:** Audit full

---

| Option | Description | Selected |
|--------|-------------|----------|
| Single retry | 1 kurzer Retry | ✓ |
| Fail-fast | Ohne Retries | |
| Few retries | 2-3 Retries | |

**User's choice:** Single retry

---

| Option | Description | Selected |
|--------|-------------|----------|
| Error only | Nur Fehlercode, UI reloadt separat | |
| Include event on 409 | `{ error, event }` | |
| Let Claude decide | Claude entscheidet | ✓ |

**User's choice:** Let Claude decide

---

## Side-Effects coherence

| Option | Description | Selected |
|--------|-------------|----------|
| No | SSE nur bei erfolgreichen DB-Änderungen | ✓ |
| Yes | SSE auch bei Rejections | |
| Let Claude decide | Claude entscheidet | |

**User's choice:** No SSE on rejections

---

| Option | Description | Selected |
|--------|-------------|----------|
| Never | Nie pushen bei Rejections | |
| Only admin | Push nur an Admin/Manager bei Rejections | ✓ |
| Let Claude decide | Claude entscheidet | |

**User's choice:** Only admin

---

| Option | Description | Selected |
|--------|-------------|----------|
| New actions | neue action strings pro Rejection-Typ | |
| Same action + outcome | gleiche action + outcome/reason metadata | |
| Let Claude decide | Claude entscheidet | ✓ |

**User's choice:** Let Claude decide

---

| Option | Description | Selected |
|--------|-------------|----------|
| After commit | Side-effects best-effort nach Commit | |
| Audit before | Audit darf vor Commit | |
| Let Claude decide | Claude entscheidet | ✓ |

**User's choice:** Let Claude decide

---

## Claude's Discretion

- Response-Payload bei `409 event_voll`
- Audit action naming/structure für Rejections
- Side-effect Ordering (aber ohne inkonsistente “vor Commit” Signale)

## Deferred Ideas

- None

