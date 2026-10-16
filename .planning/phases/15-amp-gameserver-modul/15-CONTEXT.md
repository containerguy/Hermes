# Phase 15: AMP-Gameserver-Modul - Context

**Gathered:** 2026-10-15
**Status:** Ready for planning
**Source:** Branch `feature/amp-integration` (commit `fcc03ff`, 2026-04-19, rebased 2026-10-15) plus Betriebsentscheidungen vom 2026-10-15 (Controller `amp-ctl`, vier Target-VMs, Rollen-Vorgabe „ab manager wird verwaltet").

<domain>
## Phase Boundary

Hermes wird die zentrale Oberfläche für die Gameserver der LAN-Party. CubeCoders AMP (Controller `amp-ctl` mit Targets `cs2`, `minecraft`, `factorio`, `retro`) bleibt die Ausführungsschicht; Spieler und Orga arbeiten in Hermes:

1. Spiele aus dem `gameCatalog` werden an AMP-Instanzen gebunden (Adresse, Port, Verbinden-Schema).
2. Jedes Event mit gebundenem Spiel zeigt Live-Status, Spielerzahl und einen Verbinden-Knopf.
3. Ab Rolle `manager` werden Instanzen aus Hermes heraus verwaltet (Start, Stop, Neustart, Update, Konsole).
4. Optional: automatischer Start bei `ready`, automatischer Stop nach Archivierung/Leerlauf, Push „Server läuft".

Out of scope: AMP-Konten für Spieler, SSO/OIDC zwischen Hermes und AMP, Bearbeiten von Instanz-Einstellungen oder Dateien in Hermes (bleibt im AMP-Panel), Anlegen/Löschen von Instanzen, Backups.
</domain>

<decisions>
## Implementation Decisions

### Zugang und Transport (locked)

- D-01: **Hermes ruft AMP direkt** über `src/server/integrations/amp/amp-client.ts` auf. Keine separate Bridge. Netzpfad: docker01 (192.168.9.103) → `https://amp-ctl.lanparty.familie-keller.info` (Port 443 ist dafür freigegeben).
- D-02: **Zugangsdaten nur per Env**, nie in `app_settings`: `HERMES_AMP_USERNAME`, `HERMES_AMP_PASSWORD`, optional `HERMES_AMP_REMEMBER_TOKEN_FILE` (Pfad, in dem das rotierende `rememberMeToken` persistiert wird), `HERMES_AMP_CA_FILE` (PEM der LANPARTY-AMP-CA). Die Settings-Keys `ampUsername`, `ampPassword`, `ampTlsSkipVerify` aus `fcc03ff` werden entfernt; Migration `0019` löscht sie aus `app_settings`. In Settings bleiben nur `ampIntegrationEnabled` und `ampBaseUrl` (admin-sichtbar).
- D-03: **Eine AMP-Session pro Hermes-Prozess**: Login einmal mit `rememberMe: true`, `SESSIONID` wird wiederverwendet, bei `Session.Exists`/401 erneuter Login (zuerst mit `rememberMeToken`, dann mit Passwort). AMP-Aufrufe laufen durch eine kleine Warteschlange (max. 1 gleichzeitig), damit das AMP-Login-Rate-Limit (120/60 s) nie greift.
- D-04: TLS-Verifikation ist Pflicht; `ampTlsSkipVerify` entfällt. Die CA wird als `ca`-Option im `undici`/Node-Fetch-Dispatcher gesetzt.

### Datenmodell (locked)

- D-05: Neue Tabelle `game_server_bindings` (Migration `0020_game_server_bindings.sql`): `id`, `game_title_norm` (UNIQUE, Normalisierung wie `isCod4Game`: lowercase, nur `[a-z0-9]`), `display_title`, `amp_instance_id` (AMP-GUID), `amp_instance_name`, `host`, `port`, `connect_scheme` ∈ `steam` | `minecraft` | `copy`, `enabled`, `created_at`, `updated_at`.
- D-06: `game_events` bekommt `server_binding_id TEXT NULL REFERENCES game_server_bindings(id) ON DELETE SET NULL`. Beim Anlegen/Bearbeiten eines Events wird die Bindung automatisch aus `gameTitle` ermittelt (Normalisierung), kann aber vom Ersteller abgewählt werden.
- D-07: `details` bleibt Freitext für Menschen. Verbindungsdaten kommen **nur** aus der Bindung, nie aus `details`. Passwörter/RCON stehen nirgends in Hermes.

### Status und Steuerung (locked)

- D-08: Ein Statusdienst (`src/server/integrations/amp/amp-status.ts`) pollt `ADSModule/GetInstances` alle 15 s, solange das Modul aktiv ist und mindestens eine Bindung existiert. Pro gebundener Instanz werden `running`, `appState`, `players`/`maxPlayers` (Metrik „Active Users") und `updatedAt` im Speicher gehalten. Änderungen gehen als SSE-Ereignis `servers_changed` über den vorhandenen Event-Bus.
- D-09: **Rollenmatrix** (serverseitig erzwungen, `src/server/domain/users.ts`):

  | Rolle | Status/Verbinden | Start/Stop/Restart/Update/Kill | Konsole lesen + Befehl | Bindungen/Settings |
  |---|---|---|---|---|
  | user | ja | – | – | – |
  | organizer | ja | – | – | – |
  | manager | ja | ja | ja | – |
  | admin | ja | ja | ja | ja |

  Helfer: `canManageServers(actor)` = `manager` oder `admin`; Bindungen über `canAssignRoles` (admin).
- D-10: Steuer-Endpunkte unter `/api/integrations/amp/instances/:id/{start,stop,restart,update,kill}` (POST), `GET …/console?since=<n>` und `POST …/console {command}`. Nur für Instanzen mit aktiver Bindung. Jede Aktion schreibt Audit-Log (`amp.instance_start` …) und läuft durch einen neuen Rate-Limit-Scope `amp_control`.
- D-11: AMP-Methodennamen werden in Plan 15-02 gegen `Core/GetAPISpec` **nach Login** verifiziert (anonym liefert die Spec nur Login-Methoden). Erwartet: `ADSModule/GetInstances`, `ADSModule/StartInstance`, `StopInstance`, `RestartInstance`, `UpdateInstance`, Instanz-Proxy `ADSModule/Servers/{id}/API/Core/GetUpdates` und `…/Core/SendConsoleMessage`, `…/Core/Kill`.

### Oberfläche (locked)

- D-12: `EventCard` bekommt einen Server-Bereich nach dem Muster `Cod4KeyGenerator`: Status-Punkt (aus/startet/läuft), `players/maxPlayers`, Verbinden (`steam://connect/host:port` bei `steam`, `host:port` kopieren bei `copy`/`minecraft`), für `manager`+ die Steuerknöpfe. Konsole als aufklappbarer Bereich mit Polling (5 s) auf `GET …/console`.
- D-13: Event-Formular: Auswahl aus gebundenen Spielen (ersetzt das AMP-Dropdown aus `fcc03ff`, das `details` befüllte). Admin: Bindungen pflegen in `AdminPanelBetrieb` (Tabelle + Formular, Instanz-Auswahl aus `GET /api/integrations/amp/instances`).
- D-14: Kiosk (`/api/kiosk/events`) liefert zusätzlich `server: { running, players, maxPlayers, host, port }` ohne Geheimnisse.

### Automatik (locked)

- D-15: Settings `ampAutoStartOnReady` (bool, Default false) und `ampAutoStopIdleMinutes` (int, 0 = aus). Auswertung im Server-Tick (neues `setInterval` in `src/server/index.ts`, 30 s): Event wird `ready` und Instanz läuft nicht → Start; Event `archived`/`cancelled` oder `players = 0` seit N Minuten und kein anderes aktives Event auf derselben Bindung → Stop. Audit `amp.auto_start`/`amp.auto_stop`, Actor `null`.
- D-16: Push „Server für <Spiel> läuft" an alle `dabei` eines Events, wenn die gebundene Instanz von nicht-laufend auf laufend wechselt (einmal pro Event).

### Betrieb (locked, außerhalb des Repos)

- D-17: AMP-Service-User `hermes` mit eigener Rolle, ohne 2FA, nur: Instanzen sehen, Start/Stop/Restart/Update, Konsole lesen/schreiben auf den Spiele-Instanzen. Wird von René im AMP-Panel angelegt; Hermes erhält die Daten per Env (D-02).
- D-18: Tests laufen gegen einen gemockten AMP (`src/server/integrations/amp/__fixtures__/get-instances.json`, Form einer Controller-Antwort mit `AvailableInstances`). Kein Test spricht mit einem echten AMP.

### Claude's Discretion

- Ob der Statusdienst bei 0 Bindungen komplett pausiert oder mit 60 s weiterläuft.
- Exakte Rate-Limit-Werte für `amp_control` (Orientierung: `pair_token_create`).
- Ob die Konsole per SSE statt Polling geliefert wird, wenn der Event-Bus das ohne neue Abhängigkeit hergibt.

</decisions>

<canonical_refs>
## Canonical References

- `src/server/integrations/amp/amp-client.ts` — bestehender Client aus `fcc03ff` (URL-Normalisierung, `ampPostJson`, `unwrapAmpData`); wird um Session-Cache und CA erweitert.
- `src/server/http/amp-routes.ts` — bestehender Router (nur `GET /instances`).
- `src/server/domain/users.ts` — `canCreateEvent`, `canManageEvent`, `canAssignRoles` (Muster für `canManageServers`).
- `src/server/http/pizza-routes.ts`, `src/server/domain/pizza/` — Muster für ein abschaltbares Feature-Modul.
- `src/client/cod4/isCod4Game.ts`, `src/client/components/EventCard.tsx` — Muster für spielspezifische Bereiche und Titel-Normalisierung.
- `src/server/realtime/event-bus.ts` — SSE-Broadcast.
- `src/server/push/push-service.ts` — `sendPushToEnabledUsers`.
- `src/server/audit-log.ts`, `src/server/auth/rate-limits.ts`.
- `.planning/phases/09-device-recognition-and-pairing/09-01-schema-and-device-model-PLAN.md` — Migrations-/Schema-Konventionen.

## AMP-Fakten (Stand 2026-10-15, Betrieb)

- Controller: `https://amp-ctl.lanparty.familie-keller.info` (nginx → AMP 2.8.0.8), Zertifikat von der eigenen CA „LANPARTY AMP CA" (Datei `lanparty-amp-ca.crt`, gültig bis 2029).
- Anonym erreichbar: `Core/Login`, `Core/OIDCLogin`, `ADSModule/AttachADSWithPairingCode`. Alles andere braucht `SESSIONID`.
- `Core/Login` erwartet `{ username, password, token, rememberMe }` und einen `Accept: application/json`-Header; Antwort enthält `sessionID`, `rememberMeToken`, `permissions`.
- Targets und Instanzen (FriendlyName → Instanzname): cs2 → `Counter-Strike201`, minecraft → `Minecraft01`, retro → `CS1601`, `UT200401`, `CoD401`, `Soldat01` (Factorio, Among Us, TeamSpeak folgen).
</canonical_refs>
