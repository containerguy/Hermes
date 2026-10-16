---
phase: 15-amp-gameserver-modul
plan: 04
type: execute
wave: 4
depends_on: ["15-03"]
files_modified:
  - src/server/settings.ts
  - src/server/integrations/amp/amp-automation.ts
  - src/server/integrations/amp/amp-automation.test.ts
  - src/server/index.ts
  - src/server/push/push-service.ts
  - src/client/components/AdminPanelBetrieb.tsx
  - src/client/types/core.ts
  - src/client/i18n/catalog/de.ts
  - src/client/i18n/catalog/en.ts
  - README.md
  - docker-compose.yml
  - e2e/hermes-flow.spec.ts
autonomous: true
requirements: [AMP-05]
must_haves:
  truths:
    - "Mit ampAutoStartOnReady startet Hermes die gebundene Instanz, sobald ein Event ready wird und die Instanz nicht läuft; ohne die Einstellung passiert nichts."
    - "Mit ampAutoStopIdleMinutes > 0 stoppt Hermes eine Instanz, wenn kein aktives Event sie mehr nutzt und sie seit N Minuten 0 Spieler hat."
    - "Beim Wechsel einer Instanz auf running erhalten alle 'dabei'-Teilnehmer des Events genau einmal einen Push."
    - "README und docker-compose dokumentieren die vier Env-Variablen und das CA-Mount; e2e deckt den Weg Event anlegen → Server-Bereich sichtbar ab."
  artifacts:
    - path: "src/server/integrations/amp/amp-automation.ts"
      provides: "Tick-Logik für Auto-Start/Auto-Stop und Push bei running"
      exports: ["runAutomationTick", "startAmpAutomation", "stopAmpAutomation"]
  key_links:
    - from: "src/server/index.ts"
      to: "startAmpAutomation"
      via: "setInterval 30 s nach Serverstart"
      pattern: "startAmpAutomation("
---

<objective>
Automatik (D-15, D-16) und Betriebsreife: Auto-Start bei `ready`, Auto-Stop bei Leerlauf, Push „Server läuft", Dokumentation, Compose-Beispiel mit CA-Mount, e2e-Abdeckung.

Purpose: Die Orga soll an der LAN nicht mehr an Server denken müssen; und ein Neuaufbau von Hermes darf nicht an fehlender Doku scheitern.

Output: Automatik-Modul mit Tests, zwei neue Settings mit Admin-UI, Doku, e2e.
</objective>

<execution_context>
@$HOME/.cursor/get-shit-done/workflows/execute-plan.md
@$HOME/.cursor/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/15-amp-gameserver-modul/15-CONTEXT.md
@.planning/phases/15-amp-gameserver-modul/15-03-SUMMARY.md
@src/server/domain/events.ts
@src/server/http/event-routes.ts
@src/server/push/push-service.ts
@src/server/integrations/amp/amp-status.ts
@src/server/index.ts
@README.md
@docker-compose.yml
@e2e/hermes-flow.spec.ts

<interfaces>
```typescript
// src/server/integrations/amp/amp-automation.ts
export type AutomationDeps = {
  now(): Date;
  listActiveEvents(): Array<{ id: string; status: "open"|"ready"|"running"; serverBindingId: string | null; gameTitle: string }>;
  getStatus(bindingId: string): ServerStatus | null;
  start(bindingId: string): Promise<void>;
  stop(bindingId: string): Promise<void>;
  pushRunning(eventId: string, gameTitle: string): Promise<void>;
  settings: { ampAutoStartOnReady: boolean; ampAutoStopIdleMinutes: number };
};
export function runAutomationTick(deps: AutomationDeps, state: AutomationState): Promise<AutomationState>;
export function startAmpAutomation(context: DatabaseContext, opts?: { intervalMs?: number }): void;
export function stopAmpAutomation(): void;
```
Settings-Ergänzung: `ampAutoStartOnReady: z.boolean()` (Default false), `ampAutoStopIdleMinutes: z.number().int().min(0).max(1440)` (Default 0).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Settings und Admin-UI</name>
  <files>src/server/settings.ts, src/client/types/core.ts, src/client/components/AdminPanelBetrieb.tsx, src/client/i18n/catalog/de.ts, src/client/i18n/catalog/en.ts, src/client/components/*.test.tsx, src/server/http/app-flow.test.ts</files>
  <read_first>
    - src/server/settings.ts (Schema/Defaults/Public-Projektion — die beiden Keys sind NICHT public)
    - src/client/components/AdminPanelBetrieb.tsx (Abschnitt „Gameserver (AMP)" aus 15-01)
  </read_first>
  <action>
    Beide Keys ins Schema, Defaults, Admin-Typ und Test-Fixtures; Admin-UI im AMP-Abschnitt: Checkbox „Server automatisch starten, wenn ein Event bereit ist" und Zahlenfeld „Leerlauf-Stopp nach Minuten (0 = aus)". i18n `admin.amp.autoStart`, `admin.amp.autoStopIdle`.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json && npx vitest run src/server/http/app-flow.test.ts src/client/components/admin-panel.test.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `GET /api/settings/public` enthält die beiden Keys nicht.
    - Admin kann beide Werte speichern; Validierung lehnt 1441 ab.
  </acceptance_criteria>
  <done>Automatik ist konfigurierbar, standardmäßig aus.</done>
</task>

<task type="auto">
  <name>Task 2: Automatik-Tick mit reinen Abhängigkeiten</name>
  <files>src/server/integrations/amp/amp-automation.ts, src/server/integrations/amp/amp-automation.test.ts, src/server/index.ts, src/server/push/push-service.ts</files>
  <read_first>
    - src/server/domain/events.ts (`deriveEventStatus`, `shouldAutoArchive` — gleiche „reine Funktion + Deps"-Bauweise)
    - src/server/push/push-service.ts (`sendPushToEnabledUsers`; neue Variante für Teilnehmer eines Events)
    - 15-CONTEXT.md (D-15, D-16)
  </read_first>
  <action>
    1. `runAutomationTick` ist rein (alle Seiteneffekte über `deps`), `AutomationState` hält pro Bindung `idleSince` und pro Event `pushedRunning`.
       - Start: für jedes Event mit Status `ready` oder `running`, Bindung gesetzt, `getStatus().running === false`, `!appState.startsWith("Start")`, Setting an → `start()` einmal; Audit `amp.auto_start` (Actor null) über `deps.start`-Implementierung.
       - Stop: Setting > 0; Bindung ohne aktives (`open|ready|running`) Event; `players === 0` → `idleSince` setzen/halten; `now - idleSince >= N min` → `stop()`, Audit `amp.auto_stop`, `idleSince` löschen. Sobald `players > 0` oder ein aktives Event auftaucht → `idleSince` löschen.
       - Push: Event aktiv, Status wechselt (vorher nicht running oder unbekannt) auf `running && appState === "Ready"` und `!pushedRunning[eventId]` → `pushRunning()`, markieren.
    2. `startAmpAutomation`: `setInterval` 30 s, Deps aus Context/Statusdienst/Settings aufbauen; Fehler einer Aktion loggen und den Tick fortsetzen.
    3. `push-service.ts`: `sendPushToEventParticipants(context, eventId, payload)` (nur `joined`, nur Nutzer mit aktivierten Benachrichtigungen).
    4. Tests mit Fake-Deps: Auto-Start genau einmal; kein Start bei Setting aus; Stop erst nach N Minuten Leerlauf und nie bei aktivem Event; Push einmal pro Event trotz mehrerer Ticks; Fehler in `start()` bricht den Tick nicht ab.
  </action>
  <verify>
    <automated>npx vitest run src/server/integrations/amp/amp-automation.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - Fünf Testfälle grün.
    - `rg "setInterval" src/server/integrations/amp/amp-automation.ts` genau ein Treffer (in `startAmpAutomation`).
  </acceptance_criteria>
  <done>Server starten und stoppen sich entlang der Events.</done>
</task>

<task type="auto">
  <name>Task 3: Doku, Compose, e2e</name>
  <files>README.md, docker-compose.yml, .env.example, e2e/hermes-flow.spec.ts</files>
  <read_first>
    - README.md (Abschnitte „Wo werden Einstellungen gespeichert?", Wasabi — gleicher Stil)
    - docker-compose.yml (Secrets-Mount `s3.creds` als Muster für die CA)
    - e2e/hermes-flow.spec.ts (Login-Helfer, Event-Erstellung)
  </read_first>
  <action>
    1. README-Abschnitt „Gameserver (CubeCoders AMP)": Voraussetzungen (AMP-Service-User mit minimaler Rolle, ohne 2FA; CA-Datei), die vier Env-Variablen, Rollenmatrix aus D-09, Hinweis dass Passwörter/RCON nie in Hermes liegen.
    2. `docker-compose.yml`: Beispiel-Mount `./amp-ca.pem:/run/secrets/amp-ca.pem:ro`, `HERMES_AMP_CA_FILE=/run/secrets/amp-ca.pem`, Username/Passwort über `env_file`, `HERMES_AMP_REMEMBER_TOKEN_FILE=/data/amp-remember.token`.
    3. e2e: Admin legt Bindung „Minecraft" an (AMP-API im e2e über `page.route` gemockt mit dem Fixture), Manager erstellt Event „Minecraft" → Server-Bereich mit Status und Verbinden sichtbar; als user keine Aktionsknöpfe.
  </action>
  <verify>
    <automated>npm run build && npx playwright test -g "gameserver"</automated>
  </verify>
  <acceptance_criteria>
    - README nennt alle vier Variablen und die Rollenmatrix.
    - e2e-Test „gameserver" grün.
  </acceptance_criteria>
  <done>Neuaufbau und Betrieb sind ohne Rückfragen möglich.</done>
</task>

</tasks>

<threat_model>
| ID | Category | Threat | Decision | Mitigation |
|----|----------|--------|----------|------------|
| T-15-14 | DoS | Auto-Start/-Stop flattert (Start/Stop im Wechsel) | mitigate | Start nur bei `running === false` und nicht „Starting"; Stop nur ohne aktives Event und nach N Minuten; Zustand pro Bindung. |
| T-15-15 | Tampering | Auto-Stop beendet einen Server mit Spielern | mitigate | Stop nur bei `players === 0` über die gesamte Leerlaufzeit; `players === null` (Metrik fehlt) zählt nicht als leer. |
| T-15-16 | Information Disclosure | Push-Payload enthält Serverdaten | accept | Payload enthält nur Spieltitel und Event-Link; Verbindungsdaten holt der Client nach Login. |
</threat_model>

<verification>
- `npm run build`, `npx vitest run src`, `npx playwright test` grün.
- Manuell (Betrieb, mit Setting an): Event „Factorio" auf `ready` bringen → Instanz startet binnen 30 s; Event archivieren, 10 min warten → Instanz stoppt; Push kam einmal.
</verification>

<success_criteria>
- Automatik konfigurierbar, mit Tests belegt, standardmäßig aus.
- Push bei laufendem Server.
- Doku und Compose vollständig; e2e deckt den Kernweg ab.
</success_criteria>

<output>
`15-04-SUMMARY.md`: Settings-Keys, Tick-Intervalle, Push-Payload, Doku-Änderungen; danach Phase in ROADMAP/STATE als abgeschlossen markieren.
</output>
