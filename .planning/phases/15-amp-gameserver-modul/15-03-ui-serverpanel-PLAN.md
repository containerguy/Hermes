---
phase: 15-amp-gameserver-modul
plan: 03
type: execute
wave: 3
depends_on: ["15-02"]
files_modified:
  - src/client/gameservers/ServerPanel.tsx
  - src/client/gameservers/ServerConsole.tsx
  - src/client/gameservers/connect-link.ts
  - src/client/gameservers/connect-link.test.ts
  - src/client/gameservers/use-server-status.ts
  - src/client/components/EventCard.tsx
  - src/client/components/EventBoard.tsx
  - src/client/types/core.ts
  - src/client/i18n/catalog/de.ts
  - src/client/i18n/catalog/en.ts
  - src/main.tsx
  - src/styles.css
  - src/client/components/server-panel.test.tsx
autonomous: true
requirements: [AMP-03, AMP-04]
must_haves:
  truths:
    - "Jedes Event mit Bindung zeigt Status, Spielerzahl und einen funktionierenden Verbinden-Knopf; Events ohne Bindung sehen aus wie heute."
    - "manager und admin sehen Start/Stop/Restart/Update/Kill und eine Konsole; user und organizer nicht."
    - "Statusänderungen erscheinen ohne Reload über das SSE-Ereignis servers_changed, mit 30-s-Polling als Fallback."
    - "Das AMP-Dropdown aus fcc03ff im Event-Formular ist durch die Auswahl gebundener Spiele ersetzt; details wird nicht mehr automatisch befüllt."
  artifacts:
    - path: "src/client/gameservers/ServerPanel.tsx"
      provides: "Server-Bereich in der Event-Karte"
      exports: ["ServerPanel"]
    - path: "src/client/gameservers/connect-link.ts"
      provides: "Verbinden-Link/-Text je Schema"
      exports: ["buildConnectAction"]
    - path: "src/client/gameservers/use-server-status.ts"
      provides: "Hook: Status-Map, SSE + Polling"
      exports: ["useServerStatus"]
  key_links:
    - from: "src/client/components/EventCard.tsx"
      to: "ServerPanel"
      via: "Render, wenn event.serverBindingId gesetzt"
      pattern: "<ServerPanel"
    - from: "src/main.tsx"
      to: "servers_changed"
      via: "EventSource-Listener neben events_changed"
      pattern: "servers_changed"
---

<objective>
Die Spieler- und Orga-Oberfläche für die Gameserver (D-12, D-13 Client-Teil): Server-Bereich in der Event-Karte mit Status, Verbinden und Verwaltung ab `manager`, Konsole, Live-Updates, Auswahl gebundener Spiele im Event-Formular.

Purpose: Damit „alles über die Mitspielzentrale läuft", müssen Spieler ohne AMP-Kenntnis beitreten können und die Orga ohne AMP-Panel verwalten.

Output: Neues Client-Modul `src/client/gameservers/`, angepasste `EventCard`/`EventBoard`, i18n, Styles, Tests.
</objective>

<execution_context>
@$HOME/.cursor/get-shit-done/workflows/execute-plan.md
@$HOME/.cursor/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/15-amp-gameserver-modul/15-CONTEXT.md
@.planning/phases/15-amp-gameserver-modul/15-02-SUMMARY.md
@src/client/components/EventCard.tsx
@src/client/components/EventBoard.tsx
@src/client/cod4/Cod4KeyGenerator.tsx
@src/client/cod4/clipboard.ts
@src/main.tsx
@src/client/types/core.ts

<interfaces>
```typescript
// src/client/types/core.ts (Ergänzung)
export type GameEvent = { ...; serverBindingId: string | null };
export type ServerStatus = { /* identisch zum Server-Typ aus 15-02 */ };
export type GameServerBinding = { /* identisch zu 15-01, ohne interne Felder */ };

// src/client/gameservers/connect-link.ts
export type ConnectAction =
  | { kind: "link"; href: string; label: string }     // steam://connect/host:port
  | { kind: "copy"; text: string; label: string };    // host:port (minecraft, copy)
export function buildConnectAction(status: Pick<ServerStatus, "host" | "port" | "connectScheme">): ConnectAction;

// src/client/gameservers/use-server-status.ts
export function useServerStatus(enabled: boolean): { byBinding: Map<string, ServerStatus>; error: string | null; refresh(): void };

// src/client/gameservers/ServerPanel.tsx
export function ServerPanel(props: { event: GameEvent; status: ServerStatus | null; canManage: boolean; onAction(action: "start"|"stop"|"restart"|"update"|"kill"): Promise<void> }): JSX.Element;
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Verbinden-Logik und Status-Hook</name>
  <files>src/client/gameservers/connect-link.ts, src/client/gameservers/connect-link.test.ts, src/client/gameservers/use-server-status.ts, src/main.tsx</files>
  <read_first>
    - src/main.tsx (EventSource-Setup, 30-s-Polling-Fallback, `requestJson`)
    - src/client/cod4/clipboard.ts (Copy-Helfer wiederverwenden)
  </read_first>
  <action>
    1. `buildConnectAction`: `steam` → `{kind:"link", href:"steam://connect/<host>:<port>"}`; `minecraft` und `copy` → `{kind:"copy", text:"<host>:<port>"}` (Minecraft-Standardport 25565 wird weggelassen, wenn `port === 25565`). Tests für alle drei Schemata.
    2. `useServerStatus(enabled)`: lädt `GET /api/integrations/amp/status`, hört auf `servers_changed` (über denselben `EventSource` wie `events_changed` — in `main.tsx` einen zweiten Listener registrieren und per kleinem Emitter an den Hook weiterreichen), Fallback-Polling 30 s wie bei Events. Bei `enabled === false` keine Requests.
  </action>
  <verify>
    <automated>npx vitest run src/client/gameservers/connect-link.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `buildConnectAction({host:"cs2.lanparty.familie-keller.info",port:27015,connectScheme:"steam"}).href === "steam://connect/cs2.lanparty.familie-keller.info:27015"`.
    - Hook macht bei deaktiviertem Modul keinen Fetch (Test mit gemocktem `fetch`).
  </acceptance_criteria>
  <done>Verbinden und Live-Status sind als wiederverwendbare Bausteine da.</done>
</task>

<task type="auto">
  <name>Task 2: ServerPanel in der Event-Karte</name>
  <files>src/client/gameservers/ServerPanel.tsx, src/client/components/EventCard.tsx, src/client/components/EventBoard.tsx, src/styles.css, src/client/i18n/catalog/de.ts, src/client/i18n/catalog/en.ts, src/client/components/server-panel.test.tsx</files>
  <read_first>
    - src/client/components/EventCard.tsx (Stelle `{isCod4Game(...) ? <Cod4KeyGenerator/> : null}` — ServerPanel direkt davor)
    - src/client/cod4/Cod4KeyGenerator.tsx (Aufbau, Accessibility-Vertrag, Copy-Status)
    - 15-CONTEXT.md (D-12)
  </read_first>
  <action>
    1. `ServerPanel`: Kopf mit Status-Punkt (`.server-dot--off|--starting|--on`, Farbe über vorhandene CSS-Tokens, zusätzlich Text für Screenreader), `appState`-Text, `players/maxPlayers` (oder „–"), `updatedAt` relativ. Verbinden-Knopf nach `buildConnectAction` (Link öffnet `href`; Copy nutzt `copyToClipboard` mit demselben Status-Muster wie `Cod4KeyGenerator`). Bei `status === null` (noch kein Poll) oder `status.error` ein ruhiger Hinweis, kein Fehlerbanner.
    2. Für `canManage`: Aktionsleiste Start / Stop / Restart / Update / Kill (Kill und Update hinter „Mehr"), Knöpfe während laufender Aktion deaktiviert, Fehlercodes `amp_*` über `getErrorMessage`. Nach einer Aktion `refresh()`.
    3. `EventCard`: `canManage = currentUser.role === "manager" || "admin"`; Panel nur wenn `event.serverBindingId` und Modul aktiv. `EventBoard` reicht `byBinding` aus dem Hook an alle Karten (ein Hook pro Board, nicht pro Karte).
    4. Styles: `.server-panel`, `.server-dot`, `.server-actions` in `styles.css`, mobil einspaltig (Breakpoint wie `event-stats--pair`).
    5. i18n `events.server.*` (de/en): status.off/starting/on, players, connect, copy, copied, start, stop, restart, update, kill, console, confirmKill.
    6. Tests (`server-panel.test.tsx`, Testing-Library-Muster aus `ui-correctness.test.tsx`): user sieht Verbinden, keine Aktionen; manager sieht Aktionen; Klick auf Stop ruft `onAction("stop")`; Copy-Schema zeigt Text statt Link.
  </action>
  <verify>
    <automated>npx vitest run src/client/components/server-panel.test.tsx src/client/components/ui-correctness.test.tsx</automated>
  </verify>
  <acceptance_criteria>
    - Rolle `user`: keine Aktionsknöpfe im DOM (nicht nur versteckt).
    - Rolle `manager`: fünf Aktionen, Kill mit Bestätigung.
    - Event ohne Bindung rendert kein `.server-panel`.
  </acceptance_criteria>
  <done>Spieler verbinden sich, Orga verwaltet — alles in der Event-Karte.</done>
</task>

<task type="auto">
  <name>Task 3: Konsole und Event-Formular</name>
  <files>src/client/gameservers/ServerConsole.tsx, src/client/components/EventBoard.tsx, src/client/i18n/catalog/de.ts, src/client/i18n/catalog/en.ts</files>
  <read_first>
    - src/client/components/EventBoard.tsx (Create-Formular; das AMP-Dropdown aus `fcc03ff` mit `ampSelection`/`ampInstances`)
    - 15-CONTEXT.md (D-13)
  </read_first>
  <action>
    1. `ServerConsole` (nur `canManage`, aufklappbar unter dem ServerPanel): Polling `GET …/console?since=<cursor>` alle 5 s, solange geöffnet; Ausgabe als `<pre>` mit max. 300 Zeilen, Auto-Scroll ans Ende (abschaltbar, wenn der Nutzer nach oben gescrollt hat); Eingabezeile sendet `POST …/console`. Beim Zuklappen Polling stoppen.
    2. Event-Formular: AMP-Dropdown, `ampSelection`, `ampInstances` und das Befüllen von `details` entfernen. Stattdessen: Wenn `gameCatalog`-Auswahl oder Freitext-Titel zu einer Bindung passt (`GET /api/integrations/amp/bindings` einmal laden, Normalisierung clientseitig wie `isCod4Game`), Hinweis „Server: <host:port>" unter dem Titel und Checkbox „Server mit diesem Event verknüpfen" (Default an → `serverBindingId` im Body; abgewählt → `serverBindingId: null`).
    3. i18n `events.server.console.*`, `events.form.serverHint`, `events.form.linkServer`.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json && npx vitest run src/client</automated>
  </verify>
  <acceptance_criteria>
    - `rg "ampSelection|ampInstances" src/client` liefert keine Treffer.
    - Event-Erstellung mit Titel „Minecraft" sendet `serverBindingId` der Minecraft-Bindung.
    - Konsole pollt nur im geöffneten Zustand (Test mit Fake-Timern).
  </acceptance_criteria>
  <done>Konsole für die Orga, saubere Verknüpfung beim Anlegen.</done>
</task>

</tasks>

<threat_model>
| ID | Category | Threat | Decision | Mitigation |
|----|----------|--------|----------|------------|
| T-15-11 | Elevation | Aktionen nur im UI versteckt | mitigate | Server-Gate aus 15-02 ist maßgeblich; UI-Test prüft Abwesenheit im DOM nur als Komfort. |
| T-15-12 | Information Disclosure | Konsole im Kiosk/für user | mitigate | Konsole nur bei `canManage` gerendert und serverseitig 403. |
| T-15-13 | Tampering | `steam://`-Link mit fremdem Host | accept | Host kommt ausschließlich aus der Admin-gepflegten Bindung. |
</threat_model>

<verification>
- `npm run build` grün (tsc + Vite + Server-Bundle).
- `npx vitest run src` grün.
- Manuell im Browser (Betrieb): als `user` Event „Counter-Strike 1.6" → Verbinden öffnet `steam://connect/cs16.lanparty.familie-keller.info:27015`; als `manager` Stop → Status wechselt binnen 15 s.
</verification>

<success_criteria>
- Server-Bereich in jeder gebundenen Event-Karte, rollenabhängig.
- Konsole für manager+.
- Event-Formular verknüpft Bindungen statt Freitext.
</success_criteria>

<output>
`15-03-SUMMARY.md`: neue Komponenten, i18n-Keys, CSS-Klassen, Testabdeckung, Screenshots-Hinweis für `screen/`.
</output>
