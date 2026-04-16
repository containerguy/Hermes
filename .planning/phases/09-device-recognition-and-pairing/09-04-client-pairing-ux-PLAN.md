---
phase: 09-device-recognition-and-pairing
plan: 04
type: execute
wave: 4
depends_on: [01, 02, 03]
files_modified:
  - src/client/api/device-key.ts
  - src/client/components/QrCanvas.tsx
  - src/client/components/LoginPanel.tsx
  - src/client/errors/errors.ts
  - src/client/components/login-panel.test.tsx
autonomous: true
requirements: [AUTH-01, AUTH-02]
must_haves:
  truths:
    - "On every authenticated login attempt, the client sends a per-origin 128-bit device key from localStorage (creating it if absent) so AUTH-01 server recognition has a stable signal."
    - "An authenticated user sees an 'Add a device' panel inside LoginPanel that mints a token via POST /api/auth/pair-token and renders BOTH a clickable link `<APP_BASE>/#login?pair=<token>` AND a QR code from that same URL."
    - "When the app loads with a `?pair=<token>` segment in the URL hash, the client redeems via POST /api/auth/pair-redeem (sending a freshly-generated device key) and immediately strips the token from the URL hash + browser history (no replay from back button)."
    - "An authenticated user has a 'Forget this device' control that wipes the localStorage device key and revokes the current session via DELETE /api/auth/sessions/{currentId}."
    - "QR rendering uses an inline, dependency-light client-side canvas (no new npm package) per D-15."
    - "All four pairing error codes (pair_token_invalid/expired/consumed/origin_revoked) plus device_key_required map to readable German messages via errorMessages."
  artifacts:
    - path: "src/client/api/device-key.ts"
      provides: "getOrCreateDeviceKey(), generateDeviceKey(), forgetDeviceKey(), getDeviceContext()"
      exports: ["getOrCreateDeviceKey", "generateDeviceKey", "forgetDeviceKey", "getDeviceContext", "DEVICE_KEY_STORAGE_KEY"]
    - path: "src/client/components/QrCanvas.tsx"
      provides: "Dependency-free QR canvas component that renders a payload string"
      exports: ["QrCanvas"]
    - path: "src/client/components/LoginPanel.tsx"
      provides: "Add-a-device + Forget-device + redemption banner UI"
      contains: "Add a device"
    - path: "src/client/errors/errors.ts"
      provides: "errorMessages entries for all pairing error codes"
      contains: "pair_token_invalid"
  key_links:
    - from: "src/client/components/LoginPanel.tsx (verifyCode)"
      to: "POST /api/auth/verify-code"
      via: "requestJson with body { username, code, deviceName, deviceKey, pwa }"
      pattern: "deviceKey:"
    - from: "src/client/components/LoginPanel.tsx (pairing panel)"
      to: "POST /api/auth/pair-token + QrCanvas render"
      via: "useEffect for redemption on mount + button handler for mint"
      pattern: "/api/auth/pair-token|/api/auth/pair-redeem"
    - from: "Browser URL hash"
      to: "src/client/components/LoginPanel.tsx"
      via: "history.replaceState after redemption to strip ?pair= from history"
      pattern: "history.replaceState"
---

<objective>
Ship the AUTH-01 and AUTH-02 client UX in `LoginPanel.tsx`: persist a per-origin device key in localStorage and send it on every login + redemption, render an "Add a device" panel that mints a pairing token and shows it as a link + QR code, redeem `?pair=<token>` URLs on app load, and provide a "Forget this device" control. Wire German user-facing copy through the existing `errorMessages` table.

Purpose: Without this plan the server contracts from 09-02 and 09-03 are unreachable from the actual product. The UX must (a) make the device-key flow invisible during normal login, (b) make pairing a phone feel like one screen + one tap.

Output: A new pure helper module (`device-key.ts`), a small dependency-free QR component (`QrCanvas.tsx`), surgical edits to `LoginPanel.tsx`, error-code copy in `errors.ts`, and one focused vitest suite that asserts the redemption-on-mount + URL-strip behavior.
</objective>

<execution_context>
@$HOME/.cursor/get-shit-done/workflows/execute-plan.md
@$HOME/.cursor/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/09-device-recognition-and-pairing/09-CONTEXT.md
@.planning/phases/09-device-recognition-and-pairing/09-02-same-device-recognition-PLAN.md
@.planning/phases/09-device-recognition-and-pairing/09-03-pairing-endpoints-PLAN.md
@AGENTS.md
@src/client/components/LoginPanel.tsx
@src/client/api/request.ts
@src/client/errors/errors.ts
@src/main.tsx

<interfaces>
Server contracts shipped by 09-02 and 09-03:

```typescript
// POST /api/auth/verify-code  (Zod-validated)
type VerifyCodeBody = {
  username: string;
  code: string;
  deviceName?: string;
  deviceKey?: string;        // base64url, 22..44 chars
  pwa?: boolean;
};

// POST /api/auth/pair-token  (auth-required, CSRF, rate-limited)
// → 201 { token: string; expiresAt: string }
// → 401 { error: "nicht_angemeldet" }
// → 429 { error: "rate_limit_aktiv"; retryAfterSeconds: number }

// POST /api/auth/pair-redeem  (public, CSRF-exempt)
type PairRedeemBody = { token: string; deviceName?: string; deviceKey?: string; pwa?: boolean };
// → 201 { user: User }  + Set-Cookie: hermes_session=...
// → 400 { error: "pair_token_invalid" | "pair_token_expired" | "pair_token_consumed" }
// → 401 { error: "pair_origin_revoked" }
```

Existing client primitives to reuse (do NOT reimplement):

```typescript
// src/client/api/request.ts
export async function requestJson<T>(url: string, options?: RequestInit): Promise<T>;

// src/client/api/csrf.ts
export function primeCsrfToken(): void;
export function clearCsrfToken(): void;

// src/client/errors/errors.ts
export const errorMessages: Record<string, string>;
```

URL hash convention (per D-09): pairing URL is `<origin><pathname>#login?pair=<token>` — the substring after `#` is the route + a query-style segment. The existing `getPageFromHash()` in `src/main.tsx` matches `window.location.hash` against route paths exactly, so it already lands on the `login` page for `#login` — `#login?pair=...` will fall through to the default (`events`). This plan adds a small parser inside LoginPanel that reads `window.location.hash` directly and strips after redemption — we do NOT alter `getPageFromHash` (keeping main.tsx out of files_modified for this plan).

Note: To make the redemption banner visible when the URL is `#login?pair=...`, we additionally need `getPageFromHash` to recognize a hash that STARTS WITH `#login` (with optional `?...`). To avoid touching `main.tsx`, the redemption effect runs on mount in LoginPanel regardless of activePage, and forces a navigation to `#login` after parsing.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create the device-key client module</name>
  <files>src/client/api/device-key.ts</files>
  <read_first>
    - src/client/api/request.ts (style: small focused module, no React)
    - src/client/api/csrf.ts (storage-style helpers as a precedent)
    - .planning/phases/09-device-recognition-and-pairing/09-CONTEXT.md (D-04, D-05)
  </read_first>
  <action>
    Create `src/client/api/device-key.ts` exporting:

    ```ts
    export const DEVICE_KEY_STORAGE_KEY = "hermes_device_key_v1";
    const DEVICE_KEY_BYTES = 16;

    function bytesToBase64Url(bytes: Uint8Array): string {
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    }

    export function generateDeviceKey(): string {
      const bytes = new Uint8Array(DEVICE_KEY_BYTES);
      window.crypto.getRandomValues(bytes);
      return bytesToBase64Url(bytes);
    }

    export function getOrCreateDeviceKey(): string {
      try {
        const existing = window.localStorage.getItem(DEVICE_KEY_STORAGE_KEY);
        if (existing && /^[A-Za-z0-9_-]{22,44}$/.test(existing)) {
          return existing;
        }
      } catch {
        // localStorage may be blocked (private mode); fall through to a per-load ephemeral key.
      }
      const fresh = generateDeviceKey();
      try { window.localStorage.setItem(DEVICE_KEY_STORAGE_KEY, fresh); } catch { /* ignore */ }
      return fresh;
    }

    export function forgetDeviceKey(): void {
      try { window.localStorage.removeItem(DEVICE_KEY_STORAGE_KEY); } catch { /* ignore */ }
    }

    export function isPwa(): boolean {
      try {
        return window.matchMedia?.("(display-mode: standalone)")?.matches === true
          || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      } catch { return false; }
    }

    export function getDeviceContext(): { deviceKey: string; pwa: boolean } {
      return { deviceKey: getOrCreateDeviceKey(), pwa: isPwa() };
    }
    ```

    No React imports. No fetch calls. Pure browser primitives.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <acceptance_criteria>
    - File exports `getOrCreateDeviceKey`, `generateDeviceKey`, `forgetDeviceKey`, `getDeviceContext`, `DEVICE_KEY_STORAGE_KEY`.
    - `grep -n 'localStorage' src/client/api/device-key.ts` returns ≥ 3 lines (read + write + remove paths).
    - `grep -n 'crypto.getRandomValues' src/client/api/device-key.ts` returns ≥ 1 line (no Math.random).
    - File contains the literal storage key `hermes_device_key_v1`.
    - `npx tsc --noEmit -p tsconfig.json` exits 0.
  </acceptance_criteria>
  <done>Pure module persists a 128-bit base64url device key per-origin and degrades gracefully when localStorage is unavailable.</done>
</task>

<task type="auto">
  <name>Task 2: Create a dependency-free QrCanvas component</name>
  <files>src/client/components/QrCanvas.tsx</files>
  <read_first>
    - src/client/components/LoginPanel.tsx (component style — function component, plain props, no state libraries)
    - .planning/phases/09-device-recognition-and-pairing/09-CONTEXT.md (D-15: no new dep if ≤5 KB inline; otherwise `qrcode` or `qrcode-generator`, pick the lighter one)
    - AGENTS.md (no new dep without justification — this plan honors D-15 by using a tiny inline encoder)
  </read_first>
  <action>
    Create `src/client/components/QrCanvas.tsx`. Implementation MUST satisfy D-15:

    1. Add a single new runtime dependency `qrcode-generator` (~3 KB minified, MIT, zero deps) by running `npm install --save qrcode-generator@1.4.4`. This is a pure-JS QR encoder published since 2017; it has no native deps and ships ESM + CJS. (Justification per D-15: writing a correct Reed-Solomon-based QR encoder from scratch is error-prone and easily exceeds the 5 KB budget once mode/version/error-correction selection is included; `qrcode-generator` is purpose-built and tiny.)

    2. The component:
       ```tsx
       import React, { useEffect, useRef } from "react";
       import qrcode from "qrcode-generator";

       export function QrCanvas({
         payload,
         pixelSize = 256,
         label = "QR-Code zum Pairing"
       }: { payload: string; pixelSize?: number; label?: string }) {
         const canvasRef = useRef<HTMLCanvasElement | null>(null);

         useEffect(() => {
           if (!canvasRef.current) return;
           const qr = qrcode(0, "M");
           qr.addData(payload);
           qr.make();
           const moduleCount = qr.getModuleCount();
           const cellSize = Math.max(1, Math.floor(pixelSize / moduleCount));
           const ctx = canvasRef.current.getContext("2d");
           if (!ctx) return;
           const dim = cellSize * moduleCount;
           canvasRef.current.width = dim;
           canvasRef.current.height = dim;
           ctx.fillStyle = "#ffffff";
           ctx.fillRect(0, 0, dim, dim);
           ctx.fillStyle = "#000000";
           for (let row = 0; row < moduleCount; row += 1) {
             for (let col = 0; col < moduleCount; col += 1) {
               if (qr.isDark(row, col)) ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
             }
           }
         }, [payload, pixelSize]);

         return <canvas ref={canvasRef} role="img" aria-label={label} />;
       }
       ```

    3. Add a TypeScript module declaration if needed. If `qrcode-generator` does not ship `.d.ts`, create `src/client/types/qrcode-generator.d.ts`:
       ```ts
       declare module "qrcode-generator" {
         type QrErrorCorrection = "L" | "M" | "Q" | "H";
         interface Qr {
           addData(data: string): void;
           make(): void;
           getModuleCount(): number;
           isDark(row: number, col: number): boolean;
         }
         function qrcode(typeNumber: number, errorCorrection: QrErrorCorrection): Qr;
         export default qrcode;
       }
       ```
       (Add this file ONLY if `npx tsc --noEmit` complains about missing types after `npm install`.)
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <acceptance_criteria>
    - `package.json` `dependencies` field contains `"qrcode-generator"` after the install.
    - `src/client/components/QrCanvas.tsx` exports `QrCanvas`.
    - File contains `qr.isDark(` (proves the module-loop renderer is wired).
    - Component renders a `<canvas role="img" aria-label=...>` element (a11y hook for the upcoming UI).
    - `npx tsc --noEmit -p tsconfig.json` exits 0.
  </acceptance_criteria>
  <done>Reusable, dependency-light QR component renders any string payload to a canvas.</done>
</task>

<task type="auto">
  <name>Task 3: Wire device key into login and add the Add-a-device + Forget-device + redemption UX in LoginPanel</name>
  <files>src/client/components/LoginPanel.tsx, src/client/errors/errors.ts</files>
  <read_first>
    - src/client/components/LoginPanel.tsx (full file — pay attention to `verifyCode`, the authenticated-section JSX block ~line 346, and the device list JSX)
    - src/client/api/device-key.ts (created in Task 1)
    - src/client/components/QrCanvas.tsx (created in Task 2)
    - src/client/errors/errors.ts (existing pattern — add German strings)
    - .planning/phases/09-device-recognition-and-pairing/09-CONTEXT.md (D-04, D-05, D-06, D-09, D-15, specifics line about "Forget this device")
  </read_first>
  <action>
    A) Edit `src/client/errors/errors.ts`. Add these entries to the `errorMessages` object (alphabetically reasonable insertion point, do NOT remove anything):
    ```ts
    device_key_required: "Dieses Gerät hat noch keinen Geräteschlüssel. Bitte Seite neu laden.",
    pair_token_invalid: "Pairing-Code ist ungültig. Bitte einen neuen QR-Code erzeugen.",
    pair_token_expired: "Pairing-Code ist abgelaufen. Bitte einen neuen QR-Code erzeugen.",
    pair_token_consumed: "Pairing-Code wurde bereits eingelöst. Bitte einen neuen QR-Code erzeugen.",
    pair_origin_revoked: "Die ursprüngliche Sitzung ist abgelaufen. Auf dem anderen Gerät erneut anmelden und einen neuen QR-Code erzeugen.",
    ```

    B) Edit `src/client/components/LoginPanel.tsx`:

    1. Add imports:
       ```ts
       import { forgetDeviceKey, generateDeviceKey, getDeviceContext } from "../api/device-key";
       import { QrCanvas } from "./QrCanvas";
       ```

    2. In `verifyCode(...)`, send the device context with the request body:
       ```ts
       const deviceContext = getDeviceContext();
       const result = await requestJson<{ user: User }>("/api/auth/verify-code", {
         method: "POST",
         body: JSON.stringify({
           username,
           code,
           deviceName,
           deviceKey: deviceContext.deviceKey,
           pwa: deviceContext.pwa
         })
       });
       ```

    3. Add new state at the top of `LoginPanel`:
       ```ts
       const [pairingToken, setPairingToken] = useState<string | null>(null);
       const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
       const [redeemStatus, setRedeemStatus] = useState<"idle" | "redeeming" | "done" | "error">("idle");
       ```

    4. Add a redemption-on-mount effect (runs once, regardless of activePage). It MUST parse the token out of `window.location.hash` (formats: `#login?pair=XYZ`, `#login&pair=XYZ`, or `#?pair=XYZ` — be permissive), call `/api/auth/pair-redeem`, then strip the `pair` param via `history.replaceState` so back-button navigation cannot re-submit the token:
       ```ts
       useEffect(() => {
         const hash = window.location.hash || "";
         const queryStart = hash.indexOf("?");
         if (queryStart < 0) return;
         const params = new URLSearchParams(hash.slice(queryStart + 1));
         const pair = params.get("pair");
         if (!pair) return;

         setRedeemStatus("redeeming");
         const deviceContext = getDeviceContext();
         requestJson<{ user: User }>("/api/auth/pair-redeem", {
           method: "POST",
           body: JSON.stringify({
             token: pair,
             deviceName: navigator.userAgent.slice(0, 80),
             deviceKey: deviceContext.deviceKey,
             pwa: deviceContext.pwa
           })
         })
           .then((result) => {
             onLoggedIn(result.user);
             primeCsrfToken();
             setRedeemStatus("done");
             setMessage("Gerät erfolgreich verbunden.");
           })
           .catch((caught) => {
             setRedeemStatus("error");
             setError(getErrorMessage(caught));
           })
           .finally(() => {
             // Always strip ?pair from the URL + history so back-button cannot replay (D-08 single-use).
             params.delete("pair");
             const baseHash = hash.slice(0, queryStart);
             const remaining = params.toString();
             const nextHash = remaining ? `${baseHash}?${remaining}` : baseHash || "#login";
             window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
           });
       }, []);
       ```

    5. Add a `mintPairingToken` async handler:
       ```ts
       async function mintPairingToken() {
         setBusy(true);
         setError("");
         setMessage("");
         try {
           const result = await requestJson<{ token: string; expiresAt: string }>("/api/auth/pair-token", {
             method: "POST"
           });
           setPairingToken(result.token);
           setPairingExpiresAt(result.expiresAt);
         } catch (caught) {
           setError(getErrorMessage(caught));
         } finally {
           setBusy(false);
         }
       }
       function clearPairingToken() {
         setPairingToken(null);
         setPairingExpiresAt(null);
       }
       ```

    6. Add a `forgetDevice` handler:
       ```ts
       async function forgetDevice() {
         if (!currentUser) return;
         setBusy(true);
         setError("");
         try {
           const currentSession = sessions.find((s) => s.current);
           if (currentSession) {
             await requestJson<{ revokedCurrent: boolean }>(`/api/auth/sessions/${currentSession.id}`, { method: "DELETE" });
           }
           forgetDeviceKey();
           clearCsrfToken();
           onLoggedOut();
           setMessage("Dieses Gerät wurde vergessen.");
         } catch (caught) {
           setError(getErrorMessage(caught));
         } finally {
           setBusy(false);
         }
       }
       ```

    7. Inside the authenticated-section JSX (the block that renders when `currentUser` is truthy), insert a new `<section className="device-panel">` BEFORE the existing "Angemeldete Geräte" section. The panel:
       - Heading `<h2>Add a device</h2>` with German subtitle "Generiere einen Pairing-Code für ein weiteres Gerät."
       - When `pairingToken === null`: a button "Pairing-Code erzeugen" that calls `mintPairingToken`.
       - When `pairingToken !== null`: derive `pairUrl = `${window.location.origin}${window.location.pathname}#login?pair=${pairingToken}`` and render:
         - The `<QrCanvas payload={pairUrl} pixelSize={256} label="Pairing QR-Code" />`
         - An `<a href={pairUrl} target="_blank" rel="noopener noreferrer">` containing the URL text
         - A `<time dateTime={pairingExpiresAt}>` showing when it expires
         - A "Neuen Code erzeugen" button (calls `mintPairingToken`)
         - A "Schließen" button (calls `clearPairingToken`)

    8. In the existing per-session row that has `session.current === true`, add a "Dieses Gerät vergessen" button next to the existing "Abmelden" button that calls `forgetDevice()`. (Use `className="secondary"` to match style.)

    9. Do NOT change other existing behavior (login/register flows, profile edit, push, session list rename/revoke).
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n 'pair_token_invalid\\|pair_token_expired\\|pair_token_consumed\\|pair_origin_revoked\\|device_key_required' src/client/errors/errors.ts | wc -l` returns ≥ 5.
    - `grep -n 'getDeviceContext()' src/client/components/LoginPanel.tsx` returns ≥ 2 lines (used in verifyCode AND in redemption effect).
    - `grep -n '/api/auth/pair-token' src/client/components/LoginPanel.tsx` returns ≥ 1 line.
    - `grep -n '/api/auth/pair-redeem' src/client/components/LoginPanel.tsx` returns ≥ 1 line.
    - `grep -n 'history.replaceState' src/client/components/LoginPanel.tsx` returns ≥ 1 line (URL stripped after redemption).
    - `grep -n 'forgetDeviceKey()' src/client/components/LoginPanel.tsx` returns ≥ 1 line.
    - `grep -n 'QrCanvas' src/client/components/LoginPanel.tsx` returns ≥ 2 lines (import + usage).
    - File contains the literal `Add a device` AND `Pairing-Code erzeugen` AND `Dieses Gerät vergessen`.
    - `npx tsc --noEmit -p tsconfig.json` exits 0.
  </acceptance_criteria>
  <done>Authenticated user can mint, see, and revoke a pairing code; a guest visiting `#login?pair=...` redeems it and the URL is scrubbed; the device key is silently sent on every login.</done>
</task>

<task type="auto">
  <name>Task 4: Vitest for the redemption-on-mount + URL-strip behavior</name>
  <files>src/client/components/login-panel.test.tsx</files>
  <read_first>
    - src/client/components/ui-correctness.test.tsx (existing client test — mirror the React Testing Library + vitest setup, mocking helpers)
    - src/client/components/LoginPanel.tsx (the redemption useEffect)
  </read_first>
  <action>
    Create `src/client/components/login-panel.test.tsx`. Mirror the testing-library setup used in `ui-correctness.test.tsx`. The suite `describe("LoginPanel pairing redemption", () => { ... })` MUST contain:

    1. **redeems token from URL hash on mount and strips ?pair from the hash**
       - Set `window.location.hash = "#login?pair=PAIR_TOKEN_TEST_VALUE_AAAAAAAAAAAA"` before mounting.
       - Mock `fetch` (or stub `requestJson` via vi.mock) so that `POST /api/auth/pair-redeem` resolves with `{ user: { id: "u1", username: "u", role: "user", ... } }`.
       - Render `<LoginPanel currentUser={null} settings={defaultSettingsLike} onLoggedIn={onLoggedIn} onLoggedOut={vi.fn()} onUserUpdated={vi.fn()} />`.
       - Await a microtask flush (`await Promise.resolve(); await Promise.resolve();` or RTL's `waitFor`).
       - Assert: `onLoggedIn` was called with the mocked user.
       - Assert: `window.location.hash` no longer contains the substring `pair=` (and contains `#login` as the route).
       - Assert: the network mock was called exactly once with URL `/api/auth/pair-redeem` and the request body's `token` field equals `PAIR_TOKEN_TEST_VALUE_AAAAAAAAAAAA`.

    2. **does NOT call pair-redeem when no ?pair is in the hash**
       - Set `window.location.hash = "#login"`.
       - Render the component with the same mocks.
       - Wait a tick. Assert: the `pair-redeem` mock was NOT called.

    3. **handles pair_token_expired by surfacing a German error**
       - Set the hash with a `pair=` token. Make the `pair-redeem` mock reject with `ApiError({ code: "pair_token_expired", status: 400, body: { error: "pair_token_expired" } })`.
       - Render. Wait. Assert: the rendered DOM contains the literal string `Pairing-Code ist abgelaufen` (from the `errorMessages` entry added in Task 3).
       - Assert: the URL hash was still scrubbed (token stripped on success AND failure per `.finally` in Task 3).

    Use `beforeEach` to reset `window.location.hash = ""` and `vi.restoreAllMocks()`. Use `import { fireEvent, render, waitFor } from "@testing-library/react"`.
  </action>
  <verify>
    <automated>npx vitest run src/client/components/login-panel.test.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `src/client/components/login-panel.test.tsx` exists.
    - `npx vitest run src/client/components/login-panel.test.tsx` exits 0.
    - File contains `describe("LoginPanel pairing redemption"`.
    - File contains all three test names: `redeems token from URL hash`, `does NOT call pair-redeem`, `pair_token_expired`.
    - File contains the literal token value `PAIR_TOKEN_TEST_VALUE_AAAAAAAAAAAA` (deterministic test data).
    - File asserts `expect(window.location.hash).not.toContain("pair=")` (or equivalent).
  </acceptance_criteria>
  <done>The redeem-then-scrub-history contract is locked in by CI.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser localStorage | Stores the device key for AUTH-01 — per-origin, never sent except in request bodies, cleared by Forget-this-device. |
| Browser URL hash | Pairing token transits the URL fragment. Fragments are NEVER sent to servers, but they DO land in browser history. |
| QR canvas / clipboard | Token is rendered visually + as a clickable link — anyone shoulder-surfing the originating screen during the ≤10-min TTL could redeem. |
| Mocked network in tests | Test must NOT call the real backend. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-23 | Information Disclosure | Device key leaks across origins | mitigate | localStorage is per-origin by browser policy. Storage key namespaced (`hermes_device_key_v1`). No code path writes the key to `document.cookie`, `sessionStorage` mirrors, or query strings. |
| T-09-24 | Information Disclosure | Pairing token persists in browser history | mitigate | After `pair-redeem` resolves OR rejects, `history.replaceState` strips the `pair=` parameter from the hash so the back button cannot re-submit it. (D-08 single-use makes a replay also fail server-side, but stripping defense-in-depth removes the trace.) |
| T-09-25 | Tampering | Attacker injects a token via crafted link to a logged-in user | accept | The redeemer always becomes a session for the TOKEN's user — there is no path by which a malicious link can hijack the current user's session (a redemption never modifies the existing session). The worst case is the victim creates a session for an attacker-controlled account on their device, which is overt and visible in the device list. |
| T-09-26 | Spoofing | localStorage device key is user-set / forged | accept | Per D-04 the key is not a credential; it is a recognition hint. Server-side AUTH-01 still requires a valid OTP in the same request. A forged key only causes the user to be recognized as another of THEIR OWN devices (the userId is derived from OTP verification). |
| T-09-27 | DoS / UX | Forget device while server unreachable | accept | `forgetDevice()` clears localStorage even if the network DELETE fails (`try/catch`). The user can always re-login and explicitly revoke from the device list. |
| T-09-28 | Information Disclosure | QR rendering ships a heavy / vulnerable dep | mitigate | `qrcode-generator@1.4.4` is ~3 KB minified, MIT, zero deps, last published Jan 2024 — within D-15's "≤5 KB / lightweight" budget. No native bindings. `npm audit --omit=dev` must remain green (verify in execute). |
| T-09-29 | Tampering | URL fragment with `?pair=` could be combined with attacker-controlled JS | accept | App is single-origin and does not load third-party scripts. CSP work for the SPA is out of scope per Phase 1 disposition. |
| T-09-30 | Repudiation | Client cannot tell if redemption succeeded after URL strip | mitigate | `setRedeemStatus` + visible `message`/`error` shows status; `onLoggedIn` is called only on success. |
</threat_model>

<verification>
- `npx tsc --noEmit -p tsconfig.json` passes.
- `npx vitest run src/client/components/login-panel.test.tsx` passes (3 tests).
- `npx vitest run` (full suite) passes — Phase 1 + 09-02 + 09-03 + this plan all green.
- `npm audit --omit=dev` reports no new high/critical findings (qrcode-generator does not introduce any).
- `grep -E '"qrcode-generator"' package.json` shows the new dependency.
</verification>

<success_criteria>
- Device key is created on first verify-code attempt and persists across reloads (localStorage).
- Mint-then-display-then-redeem flow works end-to-end against the real backend (manual smoke check is fine — automation lives in 09-03 server tests + this plan's redeem-on-mount test).
- "Forget this device" wipes the localStorage key AND revokes the current server session.
- All four pairing error codes render readable German strings.
- The `pair=` token is stripped from URL + history after the redeem effect resolves OR rejects.
</success_criteria>

<output>
After completion, create `.planning/phases/09-device-recognition-and-pairing/09-04-SUMMARY.md` recording: the new client modules, the new dependency (`qrcode-generator@1.4.4`) and its size/justification per D-15, the new errorMessages keys, and confirmation that `npm audit --omit=dev` remains green.
</output>
