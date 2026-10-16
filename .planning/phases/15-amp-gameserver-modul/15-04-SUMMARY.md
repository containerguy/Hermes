---
phase: 15-amp-gameserver-modul
plan: 04
status: complete
completed: 2026-10-16
requirements: [AMP-05]
---

# 15-04 Automatik und Härtung — Summary

Umgesetzt in der Cloud-Session ohne Zugriff aufs LAN: Alles ist gegen gemockte AMP-Antworten
(`__fixtures__/get-instances.json`) getestet. **Die Abnahme gegen die echten AMP-Server steht aus**
(siehe „Offen" unten). Branch `feature/amp-integration`, Draft-PR nach `main` — nicht mergen, bevor
die lokale Abnahme gelaufen ist (Merge nach `main` rollt Produktion aus).

## Ergebnis

### Task 1 — Settings und Admin-UI

- `src/server/settings.ts`: `ampAutoStartOnReady: z.boolean()` (Default `false`),
  `ampAutoStopIdleMinutes: z.number().int().min(0).max(1440)` (Default `0` = aus).
  Beide **nicht** in `pickPublicSettings` (Test prüft `GET /api/settings/public`).
- Admin-UI (`AdminPanelBetrieb`, Abschnitt „CubeCoders AMP", nur bei aktivem Modul): Checkbox
  „Server automatisch starten, wenn ein Event bereit ist", Zahlenfeld „Leerlauf-Stopp nach Minuten
  (0 = aus)" (Client klemmt auf 0..1440), Hilfetext. i18n `admin.amp.autoStart`,
  `admin.amp.autoStopIdle`, `admin.amp.automationHelp` (de/en).
- Fixtures angepasst: `main.tsx`, `AdminPanel.tsx`, `admin-panel.test.tsx`, `login-panel.test.tsx`,
  `ui-correctness.test.tsx`, `app-flow.test.ts` (dort zusätzlich: 1441 → 400).

### Task 2 — Automatik

- **`src/server/integrations/amp/amp-automation.ts`**
  - `runAutomationTick(deps, state)` ist rein; Seiteneffekte nur über `AutomationDeps`
    (`now`, `listActiveEvents`, `getStatus`, `listStatuses`, `start`, `stop`, `pushRunning`,
    `settings`, optional `logError`). Gegenüber dem Plan-Interface kam `listStatuses()` dazu
    (für den Leerlauf-Stopp braucht der Tick auch Bindungen ohne Event).
  - `AutomationState`: `initialized`, `startHandled[eventId]`, `pushHandled[eventId]`,
    `pushBaseline[eventId]`, `idleSince[bindingId]`. Einträge inaktiver Events/Bindungen werden
    pro Tick aufgeräumt.
  - `startAmpAutomation(context, { intervalMs })` / `stopAmpAutomation()` / `runAutomationNow()`.
    Gestartet in `src/server/app.ts` direkt nach dem Statusdienst, gestoppt in `close()`;
    Takt **30 s**, unter Vitest 1 h (Tests rufen `runAutomationNow()` direkt). Überlappende Läufe
    werden zusammengelegt; ein Fehler im Tick wird geloggt, der Timer läuft weiter.
- **`src/server/integrations/amp/amp-control.ts`** (neu): `runControlAction`, `assertActionOk`,
  `CONTROL_ACTIONS` aus `amp-routes.ts` ausgelagert; Routen und Automatik nutzen dieselbe
  Start-Logik (bei `instanceRunning === false` erst `ADSModule/StartInstance`, dann `Core/Start`
  über `ampInstanceCall` mit Instanz-Session).
- Laufzeit-Aktionen: Audit `amp.auto_start` / `amp.auto_stop` mit `actor: undefined`
  (→ `actor_user_id` NULL), danach `pollNow(context)`. Bei deaktiviertem Modul oder
  deaktivierter/gelöschter Bindung passiert nichts.
- **`push-service.ts`**: `sendPushToEventParticipants(context, eventId, payload)` — nur
  `participations.status = "joined"`, `users.notificationsEnabled = true`, nicht gelöschte Nutzer.

#### Regeln (inkl. der Entscheidungen aus dem Auftrag)

| Regel | Umsetzung |
|---|---|
| Auto-Start höchstens einmal pro Event | `startHandled[eventId]` wird gesetzt, sobald über das Event entschieden ist: Start ausgelöst, oder Server lief schon. Mehrere bereite Events auf derselben Bindung lösen einen Start aus und gelten alle als bedient. Ein fehlgeschlagener Start wird **nicht** wiederholt (Fehler geloggt). |
| Kein Start, wenn `status.running` | `running` kommt aus `JOINABLE_STATES` (Ready, PreparingForSleep, Sleeping) → Ruhemodus wird nie gestartet. |
| Kein Start in Zwischenzuständen | PreStart, Configuring, Starting, Restarting, Stopping, Waiting, Installing, Updating, AwaitingUserInput, Maintenance → warten, nicht als bedient markieren. Unbekannter Status (`null` oder `error`) → nichts tun. |
| Push bei `status.running` | Nicht nur bei AppState „Ready", sondern bei jedem beitretbaren Zustand inkl. Sleeping; einmal pro Event (`pushHandled`), auch wenn der Server später aus- und wieder angeht. |
| Erster Tick nach Prozessstart | Übernimmt nur den Stand: alle dann aktiven Events kommen in `pushBaseline` (erster **bekannter** Status ist Basis — läuft der Server schon, kein Push; läuft er nicht, kommt der Push beim späteren Wechsel). Bereits `ready`/`running` Events gelten für Auto-Start als bedient. Events, die nach dem ersten Tick neu auftauchen, folgen den normalen Regeln (laufender Server → Push). |
| Auto-Stopp | Nur wenn `ampAutoStopIdleMinutes > 0`, **kein** aktives Event (open/ready/running) auf der Bindung, Status bekannt, `running === true` und `players === 0` über die ganze Zeit. `players === null`, `players > 0`, ein Event oder ein Fehler setzen `idleSince` zurück. Nach dem Stopp-Versuch wird `idleSince` gelöscht (Wiederholung frühestens nach weiteren N Minuten). |
| Push-Payload | `{ title: "Server für <Spiel> läuft", body: "Du bist dabei – jetzt verbinden.", url: "/#events" }` — keine Adresse, kein Port. |

Bewusste Folgen, die René kennen sollte:

- Nach einem Deploy startet Hermes Server von Events, die **schon bereit waren**, nicht automatisch
  (sonst würde ein bewusst gestoppter Server wieder hochfahren). Wurde ein Event genau während des
  Deploys bereit, muss ein Manager einmal „Start" drücken.
- Wird `ampAutoStartOnReady` eingeschaltet, während Events schon bereit sind (und der Prozess nicht
  neu gestartet wurde), startet Hermes deren Server beim nächsten Tick.
- Events, die in den ersten 30 s nach dem Start angelegt werden, landen in der Basis
  (kein Push, wenn ihr Server zu dem Zeitpunkt schon läuft).

### Task 3 — Doku, Compose, e2e

- **README**: neuer Abschnitt „Gameserver (CubeCoders AMP)" — Voraussetzungen (Dienstkonto mit
  minimaler Rolle, nicht `*`, ohne 2FA; CA-Datei; Hinweis `App.HasSuccessfullyUpdatedAtLeastOnce`:
  ohne erfolgreiches erstes Update startet AMP das Spiel stumm nicht), die vier Env-Variablen,
  CA-Mount, Rollenmatrix (Status/Verbinden alle; Start/Stopp/Neustart/Update/Konsole ab manager;
  Kill hinter Bestätigung; Bindungen admin), Automatik inkl. Neustart-Verhalten und Audit-Aktionen.
  Release-Checklist ergänzt.
- **docker-compose.yml**: `HERMES_AMP_REMEMBER_TOKEN_FILE: /data/amp-remember.token` (im Volume);
  `HERMES_AMP_CA_FILE` und der Mount `./amp-ca.pem:/run/secrets/amp-ca.pem:ro` als **auskommentiertes**
  Beispiel — ein Bind-Mount einer fehlenden Datei legt bei Docker ein Verzeichnis an, und eine auf ein
  Verzeichnis zeigende `HERMES_AMP_CA_FILE` würde jede AMP-Verbindung brechen. Zugangsdaten kommen
  über das vorhandene `env_file: .env`.
- **.env.example**: Hinweis „nicht die Rolle *" und dass die Automatik in der Admin-UI eingestellt wird.
- **e2e** (`e2e/hermes-flow.spec.ts`, Test „gameserver: …"): AMP wird **serverseitig** gemockt
  (`setAmpFetchForTests` im Playwright-Prozess, Fixture per `fs`), nicht über `page.route` — die
  AMP-Aufrufe macht der Hermes-Server, nicht der Browser. Ablauf: Admin aktiviert das Modul
  (Automatik-Schalter stehen auf aus/0), legt die Bindung „Minecraft" über das Formular an; Manager
  legt Event „Minecraft" an (Bindungshinweis + Verknüpfung vorausgewählt), sieht den Server-Bereich
  mit „Server aus" und „Start"; Spieler sieht Status, Adresse und „Adresse kopieren", aber keinen
  Start/Stopp/Neustart/„Mehr …".
  Der Login-Helfer füllt „Gerätename" nur noch, wenn das Feld sichtbar ist (bekannte Geräte blenden
  es seit den persistenten Sitzungen aus).

## Tests

- `amp-automation.test.ts` (9, Fake-Deps): Auto-Start genau einmal und kein Neustart nach manuellem
  Stopp; Setting aus → nichts; kein Start bei Sleeping/Starting/unbekanntem Status, Start nach
  hängengebliebenem Start; geteilte Bindung → ein Start; Push einmal pro Event inkl. Sleeping und
  neues Event auf laufendem Server; erster Tick nach Neustart ohne Push/Start; Leerlauf-Stopp erst
  nach N Minuten, nie mit aktivem Event, `players === null`/`> 0` setzen zurück; Stopp aus bei 0;
  Fehler in `start()` bricht den Tick nicht ab.
- `amp-automation-flow.test.ts` (3, echte App + gemocktes AMP + gemocktes web-push): Auto-Start
  ruft genau einmal `…/API/Core/Start`, Audit `amp.auto_start` ohne Actor; Push nur an „dabei" mit
  Benachrichtigungen (nicht an abgemeldete Benachrichtigung, nicht an „nicht dabei"), Payload ohne
  Host/Port, einmal; nach manuellem Stopp kein zweiter Start; Leerlauf-Stopp mit Audit
  `amp.auto_stop`; Modul aus → keine AMP-Aufrufe.
- `admin-amp-automation.test.tsx` (2, jsdom): Felder sichtbar/unsichtbar, Klemmung 5000 → 1440.
- `app-flow.test.ts`: Keys nicht public, 1441 → 400.
- Gesamt: `npm test` 46 Dateien / 272 Tests grün (in dieser Umgebung auch
  `push-service-cleanup.test.ts`), `tsc --noEmit` und `npm run build` grün,
  `npx playwright test` 3/3 grün (Chromium aus `/opt/pw-browsers`).

## Abweichungen vom Plan

- Timer in `src/server/app.ts` statt `index.ts` (wie der Statusdienst, damit `close()` ihn in Tests stoppt).
- `AutomationDeps.listStatuses()` zusätzlich; `logError` optional.
- Push-Bedingung `status.running` (inkl. Sleeping) statt `running && appState === "Ready"` (Vorgabe aus dem Auftrag).
- e2e mockt AMP serverseitig statt per `page.route` (siehe oben).
- CA-Mount in Compose nur auskommentiert (siehe oben).
- Kein OpenAPI-Nachtrag für die AMP-Routen (war in 15-03 als offen notiert, nicht Teil von 15-04).

## Offen / für die Abnahme im LAN

1. **Manuell gegen echte AMP-Server** (Setting an): Event „Factorio" auf `ready` bringen → Instanz
   startet binnen ~30 s, Audit `amp.auto_start`; Push kam genau einmal an die „dabei"-Teilnehmer;
   Event archivieren, `ampAutoStopIdleMinutes` (z. B. 10) abwarten → Instanz stoppt, Audit `amp.auto_stop`.
2. Prüfen, dass `Active Users` bei den echten Spielen eine Zahl liefert. Spiele ohne diese Metrik
   (`players === null`) werden vom Leerlauf-Stopp **nie** gestoppt (gewollt, aber gut zu wissen).
3. Verhalten bei Instanzen, deren AMP-Prozess aus ist (`Running: false`): Auto-Start ruft
   `StartInstance` und direkt danach `Core/Start`; schlägt `Core/Start` fehl, weil die Instanz noch
   bootet, wird das (wie bei der manuellen Aktion) verschluckt und **nicht** wiederholt. Im LAN prüfen,
   ob AMP das Spiel nach `StartInstance` selbst startet; sonst braucht es einen zweiten Versuch.
4. ~~UI-Verhalten aus 15-01: Bindungsverwaltung lud AMP-Instanzen schon beim Ankreuzen.~~ Behoben
   (Nachtrag 2026-10-16, siehe unten).
5. Der Push-Text ist nur deutsch (wie die übrigen Event-Pushes).

## Nachtrag: Bindungsverwaltung ohne Neuladen

- `AdminPanel` hält zusätzlich `savedSettings` (letzter vom Server bestätigter Stand: Laden, Speichern,
  Import). `AdminPanelBetrieb` rendert `BindingsAdmin` nur bei **gespeichertem**
  `ampIntegrationEnabled`, mit `key={savedSettings.ampBaseUrl}` — nach dem Speichern einer anderen
  Basis-URL lädt die Verwaltung Instanzen und Vorschläge neu.
- Solange das Modul nur im Entwurf angekreuzt ist, steht im AMP-Abschnitt „Einstellungen speichern,
  um danach Server-Bindungen anzulegen." (`admin.amp.saveFirst`, de/en); es gehen keine AMP-Anfragen raus.
- `BindingsAdmin`: bei einem Ladefehler gibt es jetzt „Neu aus AMP laden" direkt unter der Meldung
  (vorher nur sichtbar, wenn Vorschläge existierten — nach einem Fehler war die Seite eine Sackgasse).
- Tests: `admin-amp-automation.test.tsx` +2 (Entwurf → kein Request + Hinweis; gespeichert → lädt;
  Fehler → Retry lädt erneut). e2e „gameserver" ohne `page.reload()`, prüft Hinweis und dass die
  Bindungsverwaltung vor dem Speichern fehlt.

