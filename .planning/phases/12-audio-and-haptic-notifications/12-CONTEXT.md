# Phase 12: Audio and Haptic Notification UX - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning
**Source:** Promoted from todo `2026-04-16-audio-and-haptic-notifications.md`

<domain>
## Phase Boundary

This phase improves the perceptibility of Hermes notifications by:
1. Extending Web Push payloads with the fields OS/browser need to play sound + trigger device vibration when the platform supports it.
2. Adding optional in-app haptic feedback (`navigator.vibrate`) for direct realtime UI events when allowed by the platform.
3. Exposing user-facing toggles for "audible cues" and "haptic feedback" with feature-detected silent fallback.

Out of scope: shipping custom notification audio files (we use OS defaults / browser-permitted fields), or replacing the Web Push transport.
</domain>

<decisions>
## Implementation Decisions

### Web Push Payload (locked)

- D-01: Push payloads include the standard W3C Notification options needed for OS-level audio+haptics where supported: `silent: false`, `vibrate: [pattern]`, and the appropriate icon/badge fields. The server emits these fields **only** when the user has the corresponding toggle enabled.
- D-02: Vibration pattern default: `[120, 60, 120]` (short-pause-short). This is conservative and avoids long buzzes.
- D-03: Push payload schema is documented in code via Zod (or equivalent type) so the contract is explicit and testable.
- D-04: We do **not** ship custom audio files; we rely on the OS notification sound. Hermes-specific tones are deferred.

### In-App Haptic (locked)

- D-05: In-app vibration calls are **gated by**: (a) the user toggle, (b) `'vibrate' in navigator` feature detection, (c) a user-interaction context where the browser allows it.
- D-06: When the API is unavailable, the call path is a no-op — no console errors, no thrown exceptions, no warnings shown to the user.
- D-07: In-app haptics fire for: a small, finite set of realtime events to be enumerated in PLAN.md (e.g. event-becomes-ready, event-cancelled-while-you're-in). The planner finalizes this list against the existing realtime event types.

### Settings & UX (locked)

- D-08: Two new toggles in Profile/Settings: **"Audible cues"** and **"Haptic feedback"**, each with an explanatory line that the OS/browser may override the setting.
- D-09: Defaults: both **off** for new users. Existing users keep the existing behaviour (no implicit opt-in).
- D-10: Toggles are persisted on the user record (or in user settings, per existing convention) and round-tripped through the existing user settings endpoints.
- D-11: Audit code (server-side, when relevant): no audit entry is required for toggling these — they are personal UI prefs.

### Cross-Cutting (locked)

- D-12: All client calls that touch `Notification`, `navigator.vibrate`, or push subscription APIs use feature detection and degrade silently.
- D-13: Server tests assert push payload shape (presence/absence of `vibrate` and `silent` based on the toggle).
- D-14: Client tests assert that vibration only runs when `navigator.vibrate` exists and the user toggle is on; assertions are made via mocked navigator.
- D-15: No new client or server dependencies are introduced.

### Claude's Discretion

- Where exactly the toggles live in the existing Settings UI.
- Whether to add a small "test haptic" / "test sound" button in settings.
- Whether the in-app haptic respects an `idle/visible` page state or always fires on event arrival.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Client
- `src/main.tsx` — app shell + realtime event handlers (where in-app haptic gets wired)
- `public/sw.js` — service worker that handles push events client-side

### Server
- `src/server/push/push-service.ts` — push payload assembly
- `src/server/http/push-routes.ts` — subscribe/unsubscribe endpoints; user-prefs touchpoints

### Project Convention
- `.planning/codebase/CONCERNS.md` — known PWA/push limitations on iOS/Android
- `.planning/codebase/CONVENTIONS.md` — feature-detection patterns

</canonical_refs>

<specifics>
## Specific Ideas

- Toggle keys (user record / settings): `notificationsAudibleEnabled`, `notificationsHapticEnabled`.
- Default vibration pattern: `[120, 60, 120]`.
- Push payload additions: `silent`, `vibrate` (omitted entirely when the toggle is off).
- Realtime in-app haptic candidate triggers: event-ready, event-cancelled-with-you-participating.

</specifics>

<deferred>
## Deferred Ideas

- Custom Hermes notification audio files.
- Per-event-type haptic patterns.
- iOS-specific push tweaks beyond standard W3C fields.
- Cross-device "do not disturb" windows.

</deferred>

---

*Phase: 12-audio-and-haptic-notifications*
*Context gathered: 2026-04-16 from todos promotion*
