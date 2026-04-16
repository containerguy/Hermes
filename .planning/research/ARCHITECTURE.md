# Architecture Patterns (Client): Hermes v1.1 UX Polish

**Domain:** Responsive LAN-party coordination web app (React/Vite client + Express API)
**Researched:** 2026-04-16
**Scope:** Client structure for modular UI, state management patterns, error handling, hash-based routing, and maintainable admin/event flows.

## Recommended Architecture

Hermes already works with a “server as source of truth” model and hash routing (no router package). For v1.1 UX polish, keep that model but make the client **modular**:

- Keep backend behavior and API contracts stable.
- Stop growing `src/main.tsx`; make it a thin composition root.
- Organize by **feature** (Events / Login(Profile) / Manager / Admin) with a small `shared/` layer.
- Centralize HTTP + error normalization so every page behaves consistently (401/403, offline, validation errors).

## Component Boundaries

### App shell (`src/app/*`)

- **Responsibility:** route selection, navigation chrome, global settings/theme application, and top-level surfaces (global toasts / fatal fallback UI).
- **Must not:** contain feature logic (event SSE wiring, admin workflows, login forms).

### Feature modules (`src/features/*`)

Each feature owns:

- **UI pages + internal components**
- **API wrappers** (`*.api.ts`) for endpoints it uses
- **State boundary hook** (`useEvents`, `useCurrentUser`, `useAdminUsers`, …) as the only place that does “load/refresh/invalidate”

This keeps “flow complexity” local: admin polish doesn’t force edits in events/auth, and vice versa.

### Shared layer (`src/shared/*`)

Only cross-cutting utilities + primitives:

- `shared/api/*`: fetch wrapper, error normalization, SSE helper
- `shared/ui/*`: accessible UI primitives (buttons, dialogs, banners, spinners, toasts)
- `shared/hooks/*`: small generic hooks (async state, hash-route subscription)
- `shared/theme/*`: theme mapping (CSS custom properties)

**Rule:** shared code must not import from `features/*`.

## Proposed Client Folder Layout

Opinionated, minimal, and compatible with the current hash-routing approach:

```
src/
  main.tsx                  # boot + mount only (thin)
  app/
    App.tsx                 # app shell composition (nav, layout)
    routes.ts               # hash route parsing + route table
    guards.ts               # role-based route guards + redirects
    providers.tsx           # Settings/User provider(s) if needed
  shared/
    api/
      http.ts               # requestJson(), typed ApiError, retry policy
      errors.ts             # error normalization (401/403/offline/timeout)
      realtime.ts           # EventSource wrapper + fallback polling helpers
    ui/
      Button.tsx
      Dialog.tsx
      Toasts.tsx
      Spinner.tsx
      ErrorBanner.tsx
    hooks/
      useHashRoute.ts       # subscribe to hash changes
      useAsync.ts           # tiny helper for async state (idle/loading/error)
    theme/
      applyTheme.ts         # CSS var mapping (from server settings)
  features/
    events/
      EventsPage.tsx
      events.api.ts
      useEvents.ts
      components/
        EventCard.tsx
        EventStatusBadge.tsx
        ParticipationButtons.tsx
    auth/
      LoginPage.tsx
      ProfilePage.tsx       # sessions + notification prefs
      auth.api.ts
      useCurrentUser.ts
      push/
        usePushRegistration.ts
    manager/
      ManagerPage.tsx
      manager.api.ts
    admin/
      AdminPage.tsx
      users/
      settings/
      invites/
      audit/
      backupRestore/
```

## Data Flow (State Management) Patterns

### Principle: server is source of truth

Keep current semantics:

- After **mutations**, **refetch** the relevant list/detail (avoid optimistic UI that can desync).
- Treat SSE (`/api/realtime/events`) as an **invalidation signal**, not canonical state.

This is correct for Hermes’ scale and avoids cache correctness bugs.

### Pattern: per-feature “resource hook” with explicit invalidation

Each feature exposes one hook that manages:

- `data`
- `loading`
- `error`
- `reload()`
- mutation functions that call API then trigger `reload()`

Illustrative shape:

```typescript
export type ApiError =
  | { kind: "offline" }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "http"; status: number; message?: string; code?: string }
  | { kind: "unknown"; message?: string };

export type Resource<T> = {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => Promise<void>;
};
```

**Why:** prevents duplicated `useEffect(fetch...)` patterns and enables consistent UX (spinners, disabled states, banners) across pages.

### Cross-feature state: keep it tiny

Global state should be limited to:

- **Route** (hash)
- **Current user** (or “anonymous”)
- **Settings** (theme + toggles)

Prefer `useState` + Context only where it reduces duplication; do not introduce Redux/React Query for v1.1.

## Hash-Based Routing (No Router Package)

### Route table + parsing in one place

- Define a `RouteId` union (e.g. `events | login | manager | admin`).
- Parse `location.hash` into `{ id, params }`.
- Centralize `navigate(route)` helper that updates `location.hash`.

### Guards: role-aware, but server-enforced

Client guards are for UX clarity, not security:

- If a user hits `#admin` without admin role, redirect to `#events` with a clear explanation.
- Always handle `401` (session expired/revoked) and `403` (role changed) from APIs.

### Deep links and defaults

- Default route: `#events`
- Preserve hash on reload
- Keep anchors stable so users can share “go here” links inside the LAN

## Error Handling (Consistent UX)

### Centralize HTTP + error normalization

All network calls should go through one wrapper that:

- Always uses `credentials: "include"`
- Normalizes common failures:
  - offline / fetch failure
  - non-2xx responses
  - JSON parse errors
  - app-level error codes (if used by Hermes)

### Global handling + local rendering

- **Global:** a top-level “session expired” reaction (on 401) that offers re-login and can navigate to `#login`.
- **Local:** page-level `ErrorBanner` for recoverable issues (load failed, validation error, mutation failed).
- **Boundary:** a React error boundary at the shell to prevent blank screens and provide “Reload” affordance.

## Maintainable Admin & Event Flows

### Model actions as small workflow components

Admin/manager pages tend to accumulate one-off buttons. Keep them maintainable by using small “work units”:

- Change role modal
- Create/revoke invite code dialog
- Settings sections (theme colors, registration toggles)
- Event manage actions (update time, cancel/archive) with confirmation

Each workflow should reuse the same primitives:

- `Dialog` (a11y-first)
- `BusyButton` / spinner state
- `Toast` for success feedback
- `ErrorBanner` for failure

### Invalidation boundaries

Avoid “partial refresh spaghetti”:

- Each admin sub-area owns its `useX()` hook (`useAdminUsers`, `useAuditLog`, …).
- Successful mutations trigger only that area’s `reload()`.
- Events reload events; admin does not reload events, and vice versa.

### SSE belongs to Events only

Only the Events feature should own:

- `EventSource` lifecycle
- reconnect/backoff strategy
- fallback polling schedule

Other pages should not open SSE connections “just in case”.

## Anti-Patterns to Avoid (v1.1)

### Anti-pattern: growing `src/main.tsx`

**Why it’s bad:** merge conflicts + accidental coupling; UX polish becomes risky.
**Instead:** move pages into `features/*`, keep `main.tsx` for boot/mount only.

### Anti-pattern: ad-hoc fetch calls scattered across components

**Why it’s bad:** inconsistent spinners and error messages; duplicated 401/403 handling.
**Instead:** `shared/api/http.ts` + per-feature resource hooks.

### Anti-pattern: “UI hides admin = secure”

**Why it’s bad:** role changes and session revokes still happen; manual requests exist.
**Instead:** rely on backend enforcement and render 401/403 states gracefully everywhere.

## Scalability Considerations (Right-Sized)

Hermes is optimized for ~25 users, single instance:

- **At ~25 users:** refetch-after-mutation + SSE invalidation is simplest and reliable.
- **At 200+ users (future):** consider selective reload (per-event updates) to reduce redundant fetches.
- **Multi-instance (out of scope):** SSE/in-memory broadcast would need external pub/sub and a different persistence/locking story.

## Sources

- `.planning/PROJECT.md` (v1.1 goals: clearer navigation Events/Login/Manager/Admin; UX/a11y/responsive polish; no behavior change)
- `.planning/codebase/ARCHITECTURE.md` (current implementation notes: hash routing in `src/main.tsx`, server as source of truth, SSE invalidation model)

