---
phase: 12
plan: 02
type: execute
wave: 2
depends_on:
  - 12-01
files_modified:
  - src/client/types/core.ts
  - src/client/haptic.ts
  - src/client/haptic.test.ts
  - src/client/components/LoginPanel.tsx
  - src/client/components/EventBoard.tsx
  - public/sw.js
autonomous: true
requirements:
  - NOTIF-01
must_haves:
  truths:
    - "Profile/Settings exposes two toggles labelled 'Audible cues' and 'Haptic feedback' (D-08), each with an explanatory line noting that the OS/browser may override the setting."
    - "Toggling either switch calls `PATCH /api/push/preferences` with only the changed field and the returned `publicUser` (including `notificationsAudibleEnabled` / `notificationsHapticEnabled`) is propagated via `onUserUpdated`."
    - "`triggerHaptic(pattern)` is a no-op whenever `'vibrate' in navigator` is false, `document.visibilityState !== 'visible'`, or the passed `enabled` flag is false — it never throws, never logs, never surfaces an error (D-05, D-06, D-12)."
    - "EventBoard fires a haptic on exactly two realtime transitions (D-07): an event transitioning INTO status `ready` (from any non-terminal state), and an event transitioning INTO status `cancelled` while the current user's `myParticipation === 'joined'`."
    - "`public/sw.js` respects the server-supplied `silent` field verbatim and uses `payload.vibrate` as-is (no client-side fallback vibrate pattern), so a user with haptic off gets NO vibration and a user with audio off gets a silent notification."
    - "No new client dependencies are introduced (D-15)."
  artifacts:
    - path: "src/client/haptic.ts"
      provides: "Pure feature-detected `triggerHaptic({ enabled, pattern })` + a `detectHapticSupport()` helper."
      min_lines: 20
    - path: "src/client/haptic.test.ts"
      provides: "Vitest suite covering: API missing → no-op; toggle off → no-op; tab hidden → no-op; happy path calls navigator.vibrate with the given pattern."
      contains: "triggerHaptic"
    - path: "src/client/components/LoginPanel.tsx"
      provides: "Two new Profile toggles wired to `PATCH /api/push/preferences`."
      contains: "notificationsAudibleEnabled"
    - path: "src/client/components/EventBoard.tsx"
      provides: "In-app haptic triggered on event-ready and event-cancelled-with-participation transitions."
      contains: "triggerHaptic"
    - path: "public/sw.js"
      provides: "Service worker that passes through server-finalized `silent` and `vibrate` without inventing client-side defaults."
      contains: "silent"
  key_links:
    - from: "src/client/components/LoginPanel.tsx"
      to: "/api/push/preferences (PATCH)"
      via: "requestJson with audibleEnabled / hapticEnabled body"
      pattern: "/api/push/preferences"
    - from: "src/client/components/EventBoard.tsx"
      to: "src/client/haptic.ts (triggerHaptic)"
      via: "call after loadEvents() with diff-detected transitions"
      pattern: "triggerHaptic"
    - from: "public/sw.js"
      to: "self.registration.showNotification"
      via: "payload.silent + payload.vibrate passed through unchanged"
      pattern: "silent: payload.silent"
---

<objective>
Client half of NOTIF-01: surface the two user toggles (D-08), make the service worker honour the server-finalized `silent`/`vibrate` fields (D-01, D-12), and fire an in-app `navigator.vibrate(...)` for the two realtime transitions enumerated in D-07 — always feature-detected and silently degrading (D-05, D-06, D-12). Depends on 12-01 for the server-side toggle fields and payload contract.

Purpose: Close Phase 12 Success Criteria #2 ("settings + feature-detected in-app calls that never throw") and #3 (client-side half of the test assertions).

Output: New `src/client/haptic.ts` helper with a matching test, two new settings controls in `LoginPanel.tsx`, event-transition haptic wiring in `EventBoard.tsx`, a `core.ts` type extension, and a service-worker update that trusts the server-finalized payload.
</objective>

<execution_context>
@.planning/phases/12-audio-and-haptic-notifications/12-CONTEXT.md
@AGENTS.md
@.planning/phases/12-audio-and-haptic-notifications/12-01-server-push-payload-and-prefs-PLAN.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/12-audio-and-haptic-notifications/12-CONTEXT.md
@.planning/codebase/CONCERNS.md

# Canonical files
@src/client/components/LoginPanel.tsx
@src/client/components/EventBoard.tsx
@src/client/types/core.ts
@public/sw.js
@src/client/components/ui-correctness.test.tsx

<interfaces>
<!-- Contracts from 12-01 that this plan consumes. -->

From 12-01 (server):
```typescript
// PATCH /api/push/preferences body (all optional, at least one required)
type PreferencesBody = {
  enabled?: boolean;
  audibleEnabled?: boolean;
  hapticEnabled?: boolean;
};

// Response: { user: publicUser } — publicUser now includes:
notificationsAudibleEnabled: boolean;
notificationsHapticEnabled: boolean;
```

From src/client/types/core.ts (current User — to be extended):
```typescript
export type User = {
  id: string;
  phoneNumber: string;
  username: string;
  displayName: string;
  email: string;
  role: "user" | "manager" | "admin";
  notificationsEnabled: boolean;
  deletedAt?: string | null;
};
```

From src/client/components/EventBoard.tsx (realtime wiring already in place):
```typescript
source.addEventListener("events_changed", () => {
  loadEvents().catch(() => setLiveState("polling"));
});
```

From src/client/components/LoginPanel.tsx (existing pref flow — reuse the pattern):
```typescript
const result = await requestJson<{ user: User }>("/api/push/preferences", {
  method: "PATCH",
  body: JSON.stringify({ enabled: true })
});
onUserUpdated(result.user);
```

From public/sw.js (current behaviour — replace the fallback chain):
```javascript
self.registration.showNotification(payload.title || "Hermes", {
  body: payload.body || "",
  vibrate: payload.vibrate || [180, 80, 180],  // ← remove this client-side fallback
  // ...
});
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Haptic helper + types + service-worker payload passthrough</name>
  <files>src/client/types/core.ts, src/client/haptic.ts, src/client/haptic.test.ts, public/sw.js</files>
  <read_first>
    - src/client/types/core.ts (full User shape)
    - public/sw.js (full file — understand the existing `payload.vibrate || [180, 80, 180]` fallback that must go)
    - src/client/components/ui-correctness.test.tsx (canonical vitest + jsdom + stubbed globals pattern — imitate its `globalThis as unknown as { ... }` assignment style)
  </read_first>
  <action>
    1. Extend `src/client/types/core.ts` `User` with two REQUIRED boolean fields: `notificationsAudibleEnabled: boolean;` and `notificationsHapticEnabled: boolean;`. Add them immediately after `notificationsEnabled`. Do not make them optional — the server always returns them from `publicUser` after 12-01.
    2. Create `src/client/haptic.ts` exporting:
       ```typescript
       export type HapticPattern = readonly number[];
       export const DEFAULT_HAPTIC_PATTERN: HapticPattern = [120, 60, 120];

       export function hapticSupported(): boolean {
         return typeof navigator !== "undefined" &amp;&amp; "vibrate" in navigator;
       }

       export function triggerHaptic(options: {
         enabled: boolean;
         pattern?: HapticPattern;
         requireVisible?: boolean;
       }): boolean {
         // Returns true iff navigator.vibrate was actually invoked.
         // NEVER throws. NEVER logs. NEVER surfaces errors.
         if (!options.enabled) return false;
         if (!hapticSupported()) return false;
         if ((options.requireVisible ?? true) &amp;&amp;
             typeof document !== "undefined" &amp;&amp;
             document.visibilityState !== "visible") {
           return false;
         }
         try {
           const pattern = options.pattern ?? DEFAULT_HAPTIC_PATTERN;
           (navigator as Navigator &amp; { vibrate: (p: number | readonly number[]) =&gt; boolean })
             .vibrate(pattern as number[]);
           return true;
         } catch {
           return false;
         }
       }
       ```
       This implements D-02 default, D-05 gating (toggle + feature + user-interaction context proxied via visibility), D-06 silent failure, D-12 feature detection.
    3. Create `src/client/haptic.test.ts` with four vitest cases:
       - **Not supported**: stub `globalThis.navigator = { ...}` WITHOUT a `vibrate` key → `triggerHaptic({ enabled: true, pattern: [10] })` returns `false` and no `vibrate` spy is called.
       - **Toggle off**: stub a `vibrate: vi.fn()` navigator → `triggerHaptic({ enabled: false, pattern: [10] })` returns `false`, spy NOT called.
       - **Tab hidden**: stub `document.visibilityState = "hidden"` (use `Object.defineProperty(document, "visibilityState", { configurable: true, get: () =&gt; "hidden" })`) + vibrate spy → returns `false`, spy NOT called.
       - **Happy path**: `visibilityState = "visible"`, vibrate spy, `triggerHaptic({ enabled: true, pattern: [120, 60, 120] })` returns `true` and spy was called once with `[120, 60, 120]`.
       - **Never throws**: make `vibrate` a spy that throws an `Error` → `triggerHaptic` still returns `false` and does not rethrow.
       Use `afterEach` to restore globals cleanly.
    4. Rewrite `public/sw.js` push-event handler so it trusts the server-finalized payload:
       - Remove the `payload.vibrate || [180, 80, 180]` fallback. Replace with conditional spread: build a `notificationOptions` object that includes `vibrate: payload.vibrate` ONLY if `Array.isArray(payload.vibrate)`; otherwise omit the key entirely.
       - Add `silent: payload.silent === true` (pass through the server's explicit boolean; default `false` when the server did not set it — but 12-01 always sets it).
       - Keep `body`, `icon`, `badge`, `tag`, `renotify`, `requireInteraction`, `actions`, and `data.url` behaviour unchanged.
       - Keep the existing `try { event.data.json(); } catch {}` guard — do NOT throw on malformed payloads (existing CONCERNS.md item).
    5. Do not introduce any new npm package (D-15). Do not touch the `sw.js` install/activate/notificationclick handlers.
  </action>
  <verify>
    <automated>grep -n "notificationsAudibleEnabled" src/client/types/core.ts &amp;&amp; grep -n "notificationsHapticEnabled" src/client/types/core.ts &amp;&amp; grep -n "triggerHaptic" src/client/haptic.ts &amp;&amp; grep -n "hapticSupported" src/client/haptic.ts &amp;&amp; grep -n "DEFAULT_HAPTIC_PATTERN" src/client/haptic.ts &amp;&amp; grep -n "silent: payload.silent" public/sw.js &amp;&amp; ! grep -n "180, 80, 180" public/sw.js &amp;&amp; npx vitest run src/client/haptic.test.ts &amp;&amp; npx vitest run --dir src 2>&amp;1 | tail -20</automated>
  </verify>
  <done>
    `src/client/haptic.ts` exports `triggerHaptic`, `hapticSupported`, `DEFAULT_HAPTIC_PATTERN`; `src/client/haptic.test.ts` passes all five cases; `public/sw.js` no longer contains the `[180, 80, 180]` fallback and conditionally emits `vibrate` + `silent` from the payload; `User` type surfaces both new booleans; `npx vitest run --dir src` exits 0.
  </done>
</task>

<task type="auto">
  <name>Task 2: Profile toggles in LoginPanel (Audible cues + Haptic feedback)</name>
  <files>src/client/components/LoginPanel.tsx</files>
  <read_first>
    - src/client/components/LoginPanel.tsx (full file — the Profile section begins around line 346 `if (currentUser)`; the Notifications "Voraussetzungen" section is the canonical place to add the new toggles because that's where the existing enable/disable buttons live)
    - src/client/api/request.ts (not listed but invoked — `requestJson` already handles CSRF, so no special wiring is needed)
  </read_first>
  <action>
    1. Inside the `if (currentUser)` branch of `LoginPanel`, add a new `<section className="device-panel" aria-label="Notification Präferenzen">` placed DIRECTLY BELOW the existing "Voraussetzungen" section and ABOVE the existing `<button onClick={enableNotifications}>Notifications aktivieren</button>` action row.
    2. The section contains two checkbox controls (match the existing `label &gt; input[type="checkbox"]` pattern used in `AdminPanel.tsx`):
       - Checkbox 1 — bound to `currentUser.notificationsAudibleEnabled`:
         - Label: **"Hörbare Signale"**
         - Helper text (`<p className="muted">`): **"Der OS- oder Browser-Ruhemodus kann diese Einstellung überschreiben."** (D-08 explanatory line about OS/browser overrides)
       - Checkbox 2 — bound to `currentUser.notificationsHapticEnabled`:
         - Label: **"Haptisches Feedback"**
         - Helper text: **"Vibration ist geräte- und browserabhängig; manche Plattformen blockieren sie."** (D-08 explanatory line)
    3. Each `onChange` handler calls a single helper:
       ```typescript
       async function updatePrefs(body: { audibleEnabled?: boolean; hapticEnabled?: boolean }) {
         setBusy(true); setError(""); setMessage("");
         try {
           const result = await requestJson&lt;{ user: User }&gt;("/api/push/preferences", {
             method: "PATCH",
             body: JSON.stringify(body)
           });
           onUserUpdated(result.user);
         } catch (caught) {
           setError(getErrorMessage(caught));
         } finally {
           setBusy(false);
         }
       }
       ```
       Pass only the changed field (`{ audibleEnabled: event.target.checked }` or `{ hapticEnabled: event.target.checked }`).
    4. Disable both checkboxes when `busy` is true (existing pattern in this file).
    5. Do NOT alter the existing `enableNotifications` / `disableNotifications` flow — the master `notificationsEnabled` toggle is still the parent switch. The two new toggles are child settings and may stay interactable even when master is off (per D-10 — they are personal prefs stored independently).
    6. Do NOT add an audit entry anywhere (D-11).
    7. No new dependencies (D-15).
  </action>
  <verify>
    <automated>grep -n "Hörbare Signale" src/client/components/LoginPanel.tsx &amp;&amp; grep -n "Haptisches Feedback" src/client/components/LoginPanel.tsx &amp;&amp; grep -n "audibleEnabled" src/client/components/LoginPanel.tsx &amp;&amp; grep -n "hapticEnabled" src/client/components/LoginPanel.tsx &amp;&amp; grep -n 'notificationsAudibleEnabled' src/client/components/LoginPanel.tsx &amp;&amp; grep -n 'notificationsHapticEnabled' src/client/components/LoginPanel.tsx &amp;&amp; npx tsc -p tsconfig.json --noEmit &amp;&amp; npx vitest run --dir src 2>&amp;1 | tail -20</automated>
  </verify>
  <done>
    Two labelled checkboxes appear in the Profile section; each binds to the matching `User` field; `onChange` sends a minimal `PATCH /api/push/preferences` body with exactly one of `audibleEnabled` / `hapticEnabled`; `onUserUpdated` is called with the returned user so the checkbox reflects the server truth on next render; `npx tsc --noEmit` passes and `npx vitest run --dir src` exits 0.
  </done>
</task>

<task type="auto">
  <name>Task 3: In-app haptic on realtime event transitions (D-07)</name>
  <files>src/client/components/EventBoard.tsx</files>
  <read_first>
    - src/client/components/EventBoard.tsx (full file — note the `loadEvents()` function, the `useEffect` that subscribes to `source.addEventListener("events_changed", ...)`, and the existing `events` / `setEvents` state)
    - src/client/haptic.ts (created in Task 1 — the helper this task calls)
    - src/client/types/core.ts (the extended `User` type with the new toggle fields)
  </read_first>
  <action>
    1. Accept the already-rendered user via the existing `currentUser` prop. Add a `useRef<Map&lt;string, GameEvent&gt;>` named `previousEventsRef` initialized to `new Map()`. (`useRef` is already imported via React, add to the import list if missing.)
    2. Modify `loadEvents()` so that AFTER the new events are set and BEFORE returning, it diffs `previousEventsRef.current` against the new list and detects the two D-07 triggers:
       - **event_status_ready**: `prev.status !== "ready"` AND `next.status === "ready"` AND `next.status` was not `cancelled`/`archived` before.
       - **event_cancelled_with_participation**: `prev.status !== "cancelled"` AND `next.status === "cancelled"` AND `prev.myParticipation === "joined"`.
       If ANY event satisfies either trigger, call `triggerHaptic` exactly ONCE per `loadEvents()` invocation (no spamming) with the D-02 default pattern:
       ```typescript
       import { triggerHaptic, DEFAULT_HAPTIC_PATTERN } from "../haptic";
       // ...inside loadEvents(), after setEvents(result.events):
       if (hapticShouldFire) {
         triggerHaptic({
           enabled: currentUser?.notificationsHapticEnabled === true,
           pattern: DEFAULT_HAPTIC_PATTERN
         });
       }
       previousEventsRef.current = new Map(result.events.map(e =&gt; [e.id, e]));
       ```
       The FIRST call to `loadEvents()` (empty `previousEventsRef`) MUST NOT trigger — skip haptic detection when `previousEventsRef.current.size === 0`. This prevents a buzz on initial page load.
    3. Do NOT fire haptic for event creation, participation updates that do not cross into `ready`, archival, or any other transition — keep the trigger set MINIMAL per D-07.
    4. Do NOT call `navigator.vibrate` directly anywhere in `EventBoard.tsx` — always go through `triggerHaptic` (D-12 single-choke-point).
    5. Add a vitest case to `src/client/haptic.test.ts` OR a new `src/client/components/event-board-haptic.test.tsx` (prefer extending `haptic.test.ts` with a synthetic diff test on a pure helper you extract, rather than rendering the full component — that keeps context cost down). Specifically, factor the diff logic into a pure exported function `detectHapticTransitions(prev: Map&lt;string, GameEvent&gt;, next: GameEvent[]): boolean` inside `EventBoard.tsx` (export it) and assert:
       - Empty `prev` → returns `false` (initial load).
       - Event goes `open → ready` → returns `true`.
       - Event the current user had `joined` goes `open → cancelled` → returns `true`.
       - Event the current user had NOT joined goes `open → cancelled` → returns `false`.
       - Unchanged list → returns `false`.
    6. Visibility gating is already enforced inside `triggerHaptic` — do not re-check `document.visibilityState` here.
    7. No new dependencies (D-15).
  </action>
  <verify>
    <automated>grep -n "triggerHaptic" src/client/components/EventBoard.tsx &amp;&amp; grep -n "previousEventsRef" src/client/components/EventBoard.tsx &amp;&amp; grep -n "detectHapticTransitions" src/client/components/EventBoard.tsx &amp;&amp; ! grep -n "navigator.vibrate" src/client/components/EventBoard.tsx &amp;&amp; git diff --quiet package.json package-lock.json &amp;&amp; npx tsc -p tsconfig.json --noEmit &amp;&amp; npx vitest run --dir src 2>&amp;1 | tail -25</automated>
  </verify>
  <done>
    `EventBoard.tsx` imports and calls `triggerHaptic` only; `detectHapticTransitions` is exported and covered by unit tests for all five cases in the action; initial page load does not vibrate; second load that includes an `open → ready` transition vibrates once; a `joined → cancelled` transition vibrates once; irrelevant transitions do not vibrate; `navigator.vibrate` is not called directly from `EventBoard.tsx`; `npx tsc --noEmit` passes; full `npx vitest run --dir src` exits 0.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `public/sw.js` ← Web Push payload | Untrusted JSON from the push network; already guarded with try/catch. Must not invent client-side defaults that override the server-finalized `vibrate`/`silent`. |
| `EventBoard.tsx` ← SSE `events_changed` | Refresh signal causes a re-fetch; the diff against `previousEventsRef` must be deterministic so it can't be coerced into firing haptics on spurious transitions. |
| browser API surface (`navigator.vibrate`, `document.visibilityState`) | Absent on many platforms (iOS Safari). All access MUST be feature-detected and silent-fallback. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-12-08 | Tampering / client bypass | `EventBoard.tsx` haptic trigger | mitigate | `triggerHaptic({ enabled: currentUser.notificationsHapticEnabled })` reads the server-backed toggle on every call; the client cannot "forget" to gate because the helper requires the flag as a parameter. |
| T-12-09 | Denial-of-service (annoyance) | realtime haptic firing | mitigate | D-07 trigger set is minimal; a single haptic per `loadEvents()` batch; initial-load guard prevents buzz on mount; default pattern capped at [120, 60, 120] (D-02). |
| T-12-10 | Availability / JS error surface | feature-detection failures | mitigate | `triggerHaptic` wraps `navigator.vibrate` in try/catch, checks `'vibrate' in navigator`, and checks `document.visibilityState` — it cannot throw (D-06, D-12). `haptic.test.ts` asserts the never-throws property. |
| T-12-11 | Information disclosure | preferences PATCH | accept | Request body carries booleans only — no PII; reuse of existing `requestJson` CSRF+cookie plumbing inherits Phase 1 hardening. |
| T-12-12 | Schema drift (sw.js ↔ server) | `public/sw.js` payload consumption | mitigate | Service worker treats unknown / missing fields as "not set" (conditional spread); pairs with the server-side `pushPayloadSchema` in 12-01 that guarantees the contract. |
| T-12-13 | Cross-platform inconsistency (iOS Safari) | `navigator.vibrate` absent | accept | Documented in `.planning/codebase/CONCERNS.md`; feature detection means the code path is a no-op on iOS. Not a fix-target per the phase prompt. |
</threat_model>

<verification>
- `npx tsc -p tsconfig.json --noEmit` passes.
- `npx vitest run --dir src` exits 0 (new `haptic.test.ts` passes; all pre-existing client + server tests remain green).
- `grep -RIn "navigator.vibrate" src/client` returns a match ONLY inside `src/client/haptic.ts` (the single choke-point).
- `grep -n "180, 80, 180" public/sw.js` returns nothing (old fallback removed).
- Manual sanity (not a gate): in a browser with `navigator.vibrate` present, toggling the "Haptisches Feedback" checkbox persists across reload and controls whether `triggerHaptic` fires on an `open → ready` transition.
- `git diff package.json package-lock.json` is empty (D-15).
</verification>

<success_criteria>
- Phase 12 Success Criterion #2: settings toggles exist, calls to `navigator.vibrate` are feature-detected and never throw — proven by `LoginPanel.tsx` markup + `haptic.test.ts`.
- Phase 12 Success Criterion #3 (client half): vibration paths only run when `navigator.vibrate` exists and the user toggle is on — proven by the "API missing" / "toggle off" / "throws" vitest cases.
- D-05, D-06, D-07, D-08, D-10, D-12, D-14, D-15 implemented and verifiable.
</success_criteria>

<output>
After completion, create `.planning/phases/12-audio-and-haptic-notifications/12-02-SUMMARY.md` with: files touched, a screenshot-free description of the two new checkboxes (label + helper text verbatim), the final `detectHapticTransitions` signature, the exact set of realtime transitions that fire haptics, and a note confirming no new dependencies and that `navigator.vibrate` is only invoked from `src/client/haptic.ts`.
</output>
