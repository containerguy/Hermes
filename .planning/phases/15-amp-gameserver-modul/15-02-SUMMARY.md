---
phase: 15-amp-gameserver-modul
plan: 02
status: complete
completed: 2026-10-15
requirements: [AMP-03, AMP-04]
---

# 15-02 Status und Steuerung — Summary

## Verifizierte AMP-Methoden (Task 1)

Geprüft am 2026-10-15 gegen den echten Controller (`amp-ctl`, AMP 2.8.0.8) mit dem Dienstkonto
`hermes` (3 Berechtigungen) über `Core/GetAPISpec` **nach Login** — anonym liefert die Spec nur
`Core/Login`, `Core/OIDCLogin`, `ADSModule/AttachADSWithPairingCode`. Skript (nicht im Repo):
`network_security/amp-split/amp_spec_dump.py`; läuft auf docker01 mit `/opt/hermes-amp/amp.env`
und `/opt/hermes-amp/amp-ca.pem`, gibt nie Passwort/Session aus.

| Zweck | Methode | Hinweis |
|---|---|---|
| Instanzen + Status | `ADSModule/GetInstances` | Antwort ist eine **nackte Liste von Targets**, Instanzen unter `AvailableInstances` |
| Instanz starten (AMP-Prozess) | `ADSModule/StartInstance { InstanceName }` | nur nötig, wenn `Running === false` |
| Spiel starten/stoppen/neu starten | `ADSModule/Servers/{InstanceID}/API/Core/Start` / `Core/Stop` / `Core/Restart` | Instanz-Proxy mit der Controller-Session |
| Spiel updaten | `…/API/Core/UpdateApplication` | **nicht** `ADSModule/UpdateInstance` (existiert nicht) und nicht `UpgradeInstance` (= AMP-Upgrade) |
| Prozess abschießen | `…/API/Core/Kill` | |
| Konsole lesen | `…/API/Core/GetUpdates` → `ConsoleEntries[{Timestamp, Source, Type, Contents}]` | liefert **pro Session nur neue Zeilen** |
| Konsolenbefehl | `…/API/Core/SendConsoleMessage { message }` | |

Felder je Instanz: `InstanceID`, `InstanceName`, `FriendlyName`, `Module`, `Running` (AMP-Prozess),
`AppState` (**numerisch**: 0 Stopped, 10 Starting, 20 Ready, 40 Stopping, 75 Updating, 100 Failed …),
`Metrics["Active Users"].{RawValue, MaxValue}`, `ApplicationEndpoints` (nur Bind-Adresse `0.0.0.0:port`,
daher kommt der Host aus der Bindung).

Fixture: `src/server/integrations/amp/__fixtures__/get-instances.json` — echte Antwort, anonymisiert
(Token-/Key-/Lizenzfelder entfernt, Nicht-LAN-IPs auf `0.0.0.0`); 4 Targets (cs2, factorio, minecraft, retro),
7 Spiele-Instanzen + 4 ADS.

## Umsetzung

- **Statusdienst** `src/server/integrations/amp/amp-status.ts`: `applyInstancesSnapshot()` (rein, testbar),
  `pollNow()` (überlappende Läufe zusammengelegt), `startAmpStatusService()`/`stopAmpStatusService()`,
  `getServerStatus()`, `getAllServerStatus()`, `appStateName()`. Poll alle 15 s nur bei aktivem Modul und
  aktiven Bindungen; Fehler halten die letzten Werte und setzen `error`; Log nur bei Fehlerwechsel.
  `ServerStatus` enthält zusätzlich `instanceRunning` (AMP-Prozess) neben `running` (= AppState Ready).
- **SSE**: `broadcastServersChanged(servers)` im Event-Bus, Ereignis `servers_changed` mit der vollständigen Liste.
- **Lebenszyklus**: Start in `createHermesApp()` (neben dem bestehenden `statusInterval`), Stop in `close()`.
  Unter Vitest mit 1-h-Takt; Tests stoßen Polls über `GET /status?refresh=1` an.
- **Rollen**: `canManageServers()` = manager | admin (`src/server/domain/users.ts`).
- **Rate-Limit**: Scope `amp_control` = 20 Aktionen / 60 s pro User, Sperre 5 min; jede Aktion wird mit
  `recordRateLimitFailure` gezählt (checkRateLimit prüft nur bestehende Sperren).
- **Routen** (`/api/integrations/amp`): `GET /status[?refresh=1]` (angemeldet; Modul aus → 404),
  `POST /instances/:bindingId/{start|stop|restart|update|kill}` (manager+, CSRF, Rate-Limit, Audit
  `amp.instance_<aktion>`, danach `pollNow`), `GET /instances/:bindingId/console?since=<seq>`,
  `POST /instances/:bindingId/console { command }` (Audit `amp.console_command`, Befehl maskiert).
  Nur gebundene, aktive Instanzen (404 `binding_nicht_gefunden`, 409 `binding_deaktiviert`).
- **Konsolenpuffer**: weil `GetUpdates` pro Session nur neue Zeilen liefert und Hermes genau eine Session hat,
  puffert der Server bis zu 300 Zeilen je Bindung und verteilt sie per `seq`-Cursor an beliebig viele Betrachter.
  `maskConsoleSecrets()` maskiert `rcon_password`, `sv_password`, `password`, `token`.
- **Kiosk**: `server: { running, appState, players, maxPlayers, host, port } | null` je Event.

## Tests

- `amp-status.test.ts` (5): AppState-Mapping, Snapshot gegen Fixture inkl. unbekannter Instanz und exakter
  Feldmenge, identischer Snapshot = keine Änderung, Fehler hält Werte, verschwundene Bindung räumt Cache.
- `amp-control.test.ts` (3, HTTP mit gemocktem AMP): Maskierung; Rollenmatrix user/organizer 403 ×5 Aktionen,
  manager 200 (Stop, Update → `UpdateApplication`), unbekannte Aktion/Bindung 404, Audit-Eintrag,
  Konsole (403 für user, Maskierung, Cursor, Befehl), Kiosk-Feldmenge, Rate-Limit greift; Modul aus → 404.
- Gesamt: 202 grün, 2 rot (`push-service-cleanup`, Vorbestand auf `main`).

## Abweichungen vom Plan

- Dienst startet in `app.ts` statt `index.ts`, damit `close()` ihn auch in Tests sauber beendet.
- `GET /status?refresh=1` ergänzt (sofortiger Poll), nützlich für UI-Refresh und Tests.
- Test-Mock-Falle: Proxy-Pfade enthalten ein zweites `/API/` — Endpoint-Extraktion muss nicht-gierig sein.
- Express 5: `/instances/:id/console` (POST) kollidiert mit `/instances/:id/:action`; die Aktions-Route reicht
  `console` per `next()` weiter (keine Regex-Parameter in Express 5).
