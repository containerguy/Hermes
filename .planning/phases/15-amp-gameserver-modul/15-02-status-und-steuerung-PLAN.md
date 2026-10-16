---
phase: 15-amp-gameserver-modul
plan: 02
type: execute
wave: 2
depends_on: ["15-01"]
files_modified:
  - src/server/integrations/amp/amp-status.ts
  - src/server/integrations/amp/amp-status.test.ts
  - src/server/integrations/amp/__fixtures__/get-instances.json
  - src/server/domain/users.ts
  - src/server/auth/rate-limits.ts
  - src/server/http/amp-routes.ts
  - src/server/http/amp-routes.test.ts
  - src/server/http/kiosk-routes.ts
  - src/server/realtime/event-bus.ts
  - src/server/index.ts
autonomous: true
requirements: [AMP-03, AMP-04]
must_haves:
  truths:
    - "Der Statusdienst pollt GetInstances alle 15 s, hält pro gebundener Instanz running/appState/players/maxPlayers und sendet servers_changed über SSE, sobald sich etwas ändert."
    - "GET /api/integrations/amp/status ist für jeden Angemeldeten lesbar und enthält keine Geheimnisse."
    - "Start/Stop/Restart/Update/Kill und Konsole sind nur für manager und admin erlaubt; organizer und user erhalten 403."
    - "Steueraktionen sind nur auf Instanzen mit aktiver Bindung möglich, werden auditiert und rate-limitiert."
    - "Die verwendeten AMP-Methodennamen sind gegen Core/GetAPISpec (nach Login) verifiziert und in der SUMMARY dokumentiert."
  artifacts:
    - path: "src/server/integrations/amp/amp-status.ts"
      provides: "Statusdienst mit Poller, Cache und SSE-Broadcast"
      exports: ["startAmpStatusService", "stopAmpStatusService", "getServerStatus", "getAllServerStatus"]
    - path: "src/server/domain/users.ts"
      provides: "canManageServers()"
      contains: "canManageServers"
    - path: "src/server/auth/rate-limits.ts"
      provides: "Scope amp_control"
      contains: "amp_control"
  key_links:
    - from: "src/server/index.ts"
      to: "startAmpStatusService"
      via: "Serverstart, Stop bei SIGTERM"
      pattern: "startAmpStatusService("
    - from: "src/server/http/amp-routes.ts"
      to: "canManageServers"
      via: "Gate vor jeder Steueraktion"
      pattern: "canManageServers("
---

<objective>
Live-Status der gebundenen Instanzen (D-08) und die Verwaltung ab `manager` (D-09, D-10): Statusdienst, Status-Endpunkt, Steuer- und Konsolen-Endpunkte mit Rollen-Gate, Audit und Rate-Limit, Kiosk-Erweiterung (D-14).

Purpose: Das ist der Kern von „alles über die Mitspielzentrale". Die Oberfläche (15-03) baut nur noch auf diese Endpunkte.

Output: Statusdienst, erweiterter Router, Rollenhelfer, Rate-Limit-Scope, Kiosk-Felder, Tests gegen Fixture.
</objective>

<execution_context>
@$HOME/.cursor/get-shit-done/workflows/execute-plan.md
@$HOME/.cursor/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/15-amp-gameserver-modul/15-CONTEXT.md
@.planning/phases/15-amp-gameserver-modul/15-01-SUMMARY.md
@src/server/integrations/amp/amp-session.ts
@src/server/domain/users.ts
@src/server/auth/rate-limits.ts
@src/server/realtime/event-bus.ts
@src/server/http/kiosk-routes.ts
@src/server/http/event-routes.ts
@src/server/audit-log.ts

<interfaces>
```typescript
// src/server/integrations/amp/amp-status.ts
export type ServerStatus = {
  bindingId: string; ampInstanceId: string; ampInstanceName: string;
  running: boolean; appState: string;          // AMP AppState-Name, z. B. "Ready", "Stopped", "Starting"
  players: number | null; maxPlayers: number | null;
  host: string; port: number; connectScheme: "steam" | "minecraft" | "copy";
  updatedAt: string; error: string | null;     // error: letzter Pollfehler (Code), sonst null
};
export function startAmpStatusService(context: DatabaseContext, opts?: { intervalMs?: number }): void;
export function stopAmpStatusService(): void;
export function getServerStatus(bindingId: string): ServerStatus | null;
export function getAllServerStatus(): ServerStatus[];

// src/server/domain/users.ts (Ergänzung)
export function canManageServers(actor: { role: UserRole }): boolean;   // manager | admin

// src/server/auth/rate-limits.ts
export type RateLimitScope = ... | "amp_control";   // 20 Aktionen / 60 s pro User, 5 min Sperre

// Event-Bus (Ergänzung)
export function broadcastServersChanged(payload: ServerStatus[]): void;  // SSE-Event "servers_changed"
```

HTTP (alle unter `/api/integrations/amp`, Modul-Gate: `ampIntegrationEnabled`, sonst 404):
- `GET /status` → `{ servers: ServerStatus[] }` (angemeldet)
- `POST /instances/:bindingId/start|stop|restart|update|kill` → `{ ok: true }` (manager+, Audit `amp.instance_<aktion>`)
- `GET /instances/:bindingId/console?since=<cursor>` → `{ lines: [{ts, source, text}], cursor }` (manager+)
- `POST /instances/:bindingId/console` `{ command }` → `{ ok: true }` (manager+, Audit `amp.console_command` mit dem Befehl)

AMP-Aufrufe (zu verifizieren, Task 1):
- `ADSModule/GetInstances {}` → Controller-Antwort: Array von Targets mit `AvailableInstances[]`; je Instanz `InstanceID`, `InstanceName`, `FriendlyName`, `Running`, `AppState`, `Metrics["Active Users"].{RawValue,MaxValue}`.
- `ADSModule/StartInstance|StopInstance|RestartInstance|UpdateInstance { InstanceName }`.
- Instanz-Proxy: `ADSModule/Servers/{InstanceID}/API/Core/GetUpdates`, `…/Core/SendConsoleMessage { message }`, `…/Core/Kill`.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: AMP-Methoden verifizieren und Fixture aufnehmen</name>
  <files>src/server/integrations/amp/__fixtures__/get-instances.json, .planning/phases/15-amp-gameserver-modul/15-02-SUMMARY.md</files>
  <read_first>
    - 15-CONTEXT.md (D-11, AMP-Fakten)
    - src/server/integrations/amp/amp-session.ts
  </read_first>
  <action>
    Einmalig gegen den echten Controller (Betrieb, mit gesetzten `HERMES_AMP_*`): kleines Skript `scripts/amp-spec-dump.ts` (nicht ins Image), das sich per `ampCall` anmeldet, `Core/GetAPISpec` holt und die Methodennamen von `ADSModule` und `Core` ausgibt. Abgleich mit den erwarteten Namen aus `<interfaces>`; Abweichungen in der SUMMARY festhalten und im Code verwenden. Danach `ADSModule/GetInstances` aufrufen und die Antwort **anonymisiert** (keine Tokens, keine IPs außer den LAN-Adressen der Spiele, keine Lizenzfelder) als Fixture speichern. Das Fixture ist die einzige Testgrundlage (D-18).
  </action>
  <verify>
    <automated>node -e "const f=require('./src/server/integrations/amp/__fixtures__/get-instances.json');const t=Array.isArray(f)?f:f.result;if(!t.some(x=>Array.isArray(x.AvailableInstances)))process.exit(1);console.log('ok')"</automated>
  </verify>
  <acceptance_criteria>
    - Fixture enthält mindestens eine Instanz mit `Running`, `AppState` und `Metrics["Active Users"]`.
    - SUMMARY listet die tatsächlich existierenden Methodennamen.
  </acceptance_criteria>
  <done>Methodennamen bestätigt, Fixture vorhanden.</done>
</task>

<task type="auto">
  <name>Task 2: Statusdienst mit Poller und SSE</name>
  <files>src/server/integrations/amp/amp-status.ts, src/server/integrations/amp/amp-status.test.ts, src/server/realtime/event-bus.ts, src/server/index.ts</files>
  <read_first>
    - src/server/realtime/event-bus.ts (`broadcastEventsChanged`, Client-Registrierung)
    - src/server/index.ts (Start/Shutdown-Hooks)
    - 15-CONTEXT.md (D-08)
  </read_first>
  <action>
    1. Poller: `setInterval` (15 s, konfigurierbar), überspringt Läufe, wenn Modul aus oder keine aktiven Bindungen; keine überlappenden Läufe (Guard-Flag). Antwort von `GetInstances` flach machen (alle `AvailableInstances` aller Targets), nach `InstanceID` den Bindungen zuordnen. Nicht gefundene Instanz → `error: "amp_instanz_unbekannt"`, `running: false`.
    2. Diff gegen den Cache (running, appState, players): nur bei Änderung `broadcastServersChanged`. Pollfehler setzen `error` auf allen Einträgen, lassen die letzten Werte stehen, loggen einmal pro Fehlerwechsel (kein Log-Spam).
    3. `event-bus.ts`: neues Ereignis `servers_changed` (gleicher Transport wie `events_changed`).
    4. `index.ts`: Dienst nach dem Listen starten, bei SIGINT/SIGTERM stoppen.
    5. Tests: Fixture → zwei Bindungen (eine bekannt, eine unbekannt); erster Lauf broadcastet, zweiter identischer Lauf nicht; Pollfehler setzt `error` ohne Werte zu löschen; überlappende Läufe werden verhindert (Fake-Timer).
  </action>
  <verify>
    <automated>npx vitest run src/server/integrations/amp/amp-status.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - Vier Testfälle grün.
    - `getAllServerStatus()` liefert niemals Felder außerhalb von `ServerStatus` (Snapshot-Test).
  </acceptance_criteria>
  <done>Status liegt im Speicher und wird live verteilt.</done>
</task>

<task type="auto">
  <name>Task 3: Rollen-Gate, Steuer- und Konsolen-Endpunkte</name>
  <files>src/server/domain/users.ts, src/server/auth/rate-limits.ts, src/server/http/amp-routes.ts, src/server/http/amp-routes.test.ts</files>
  <read_first>
    - src/server/domain/users.ts (`canManageEvent`, `canAssignRoles`)
    - src/server/auth/rate-limits.ts (Scope-Muster `pair_token_create`)
    - src/server/http/event-routes.ts (Fehlercode-Konventionen, `requireUser`)
    - 15-CONTEXT.md (D-09, D-10)
  </read_first>
  <action>
    1. `canManageServers(actor)` = `role === "manager" || role === "admin"`. `canUseAmpIntegration` aus `fcc03ff` entfernen (Instanzliste wird in 15-01 nur für Admin-Bindungspflege genutzt, Gate dort `canAssignRoles`).
    2. Scope `amp_control`: 20 Aktionen pro 60 s pro User, Sperre 5 min; Konsolen-GET ist nicht limitiert.
    3. Router: `GET /status` (angemeldet). Steueraktionen: Bindung laden (404 `binding_nicht_gefunden`, 409 `binding_deaktiviert`), Gate `canManageServers` (403 `manager_erforderlich`), Rate-Limit (429 `zu_viele_anfragen`), dann `ampCall` mit `InstanceName`. Audit `amp.instance_<aktion>` mit `bindingId`, `ampInstanceName`, Actor. Nach Erfolg sofortigen Poll anstoßen (`pollNow()` im Statusdienst), damit die UI nicht 15 s wartet.
    4. Konsole: `GET …/console` ruft `Core/GetUpdates` über den Instanz-Proxy auf; Antwort auf `ConsoleEntries` reduziert (`Timestamp`, `Source`, `Contents`), `cursor` = Zeitstempel des letzten Eintrags; Secrets-Filter: Zeilen mit `rcon_password`/`password` werden maskiert. `POST …/console` → `Core/SendConsoleMessage { message }`, Befehl max. 200 Zeichen, Audit mit Befehlstext.
    5. Tests: Rollenmatrix für alle vier Rollen × fünf Aktionen (Tabelle), unbekannte Bindung, deaktivierte Bindung, Rate-Limit, Modul aus → 404, Konsolen-Maskierung.
  </action>
  <verify>
    <automated>npx vitest run src/server/http/amp-routes.test.ts src/server/domain</automated>
  </verify>
  <acceptance_criteria>
    - `organizer` → 403 auf `POST …/start`; `manager` → 200 und Audit-Eintrag `amp.instance_start`.
    - `user` erhält `GET /status` mit 200.
    - Konsolen-Antwort enthält nie den Klartext eines `rcon_password`.
  </acceptance_criteria>
  <done>Verwaltung ab manager, serverseitig erzwungen und auditiert.</done>
</task>

<task type="auto">
  <name>Task 4: Kiosk-Erweiterung</name>
  <files>src/server/http/kiosk-routes.ts, src/server/http/kiosk-routes.test.ts</files>
  <read_first>
    - src/server/http/kiosk-routes.ts (`toKioskEvent`, Secret-Check)
    - 15-CONTEXT.md (D-14)
  </read_first>
  <action>
    Jedes Kiosk-Event bekommt `server: { running, appState, players, maxPlayers, host, port } | null` aus `getServerStatus(event.serverBindingId)`. Keine weiteren Felder. Test: Event mit Bindung liefert `server`, ohne Bindung `null`; Snapshot stellt sicher, dass keine zusätzlichen Keys erscheinen.
  </action>
  <verify>
    <automated>npx vitest run src/server/http/kiosk-routes.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - Kiosk-Antwort enthält `server` mit genau den sechs Feldern oder `null`.
  </acceptance_criteria>
  <done>Fernseher zeigt Serverstatus ohne Geheimnisse.</done>
</task>

</tasks>

<threat_model>
| ID | Category | Threat | Decision | Mitigation |
|----|----------|--------|----------|------------|
| T-15-06 | Elevation | organizer startet/stoppt Server | mitigate | `canManageServers` serverseitig vor jeder Aktion; UI versteckt nur zusätzlich. |
| T-15-07 | Tampering | Steuerung fremder, nicht gebundener Instanzen | mitigate | Nur `bindingId`, nie rohe `InstanceName` aus dem Request. |
| T-15-08 | DoS | Klick-Spam auf Start/Stop | mitigate | Scope `amp_control`, Poll-Guard. |
| T-15-09 | Information Disclosure | Konsole zeigt RCON-Passwort | mitigate | Maskierung in `GET …/console`; Konsole nur manager+. |
| T-15-10 | Repudiation | Wer hat den Server gestoppt? | mitigate | Audit mit Actor für jede Aktion und jeden Befehl. |
</threat_model>

<verification>
- `npx vitest run src` grün; `npx tsc --noEmit` grün.
- Manuell (Betrieb): Server in AMP starten → innerhalb 15 s erscheint `running: true` in `GET /status`; Stop über Hermes als manager → AMP-Panel zeigt Instanz gestoppt, Audit-Log hat Eintrag.
</verification>

<success_criteria>
- Live-Status pro gebundener Instanz, per SSE verteilt.
- Verwaltung ab manager, mit Audit und Rate-Limit.
- Kiosk mit Serverstatus.
</success_criteria>

<output>
`15-02-SUMMARY.md`: verifizierte AMP-Methodennamen, Fixture-Herkunft, Rate-Limit-Werte, Testmatrix.
</output>
