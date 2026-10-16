---
phase: 15-amp-gameserver-modul
plan: 01
status: complete
completed: 2026-10-15
requirements: [AMP-01, AMP-02]
---

# 15-01 Zugang und Bindings — Summary

## Ergebnis

- **Zugangsdaten nur per Env** (D-02): `HERMES_AMP_USERNAME`, `HERMES_AMP_PASSWORD`, optional
  `HERMES_AMP_REMEMBER_TOKEN_FILE`, `HERMES_AMP_CA_FILE` (`src/server/env.ts`: `getAmpCredentials()`,
  `getAmpCaFile()`). Settings-Keys `ampUsername`, `ampPassword`, `ampTlsSkipVerify` sind aus Schema,
  Public-Projektion, Client-Typen, Admin-UI und Fixtures entfernt; Migration `0019` löscht sie aus `app_settings`.
- **Eine AMP-Session pro Prozess** (D-03): `src/server/integrations/amp/amp-session.ts` mit `ampCall()`
  (serialisierte Warteschlange), `getAmpSession()`, `resetAmpSession()`, `normalizeAmpBaseUrl()`,
  `unwrapAmpData()`. Login mit `rememberMe: true`; Token wird bei Erfolg rotierend in die Token-Datei
  (0600) geschrieben und beim nächsten Login vor dem Passwort versucht. Sitzungsverlust (HTTP 401/403 oder
  AMP-Fehlertext mit `Session.Exists`/`Unauthorized`) → genau ein Re-Login + Retry.
- **TLS** (D-04): undici-`Agent` mit `connect.ca` aus `HERMES_AMP_CA_FILE`; kein `rejectUnauthorized`
  im Code. `undici` ist jetzt explizite Abhängigkeit (`^7.30.1`), vorher kam es nur transitiv.
- **Instanzliste**: `fetchAmpInstances()` zieht `AvailableInstances` der Targets flach
  (`flattenAmpInstances()`), lässt ADS-Instanzen aus und liefert zusätzlich `instanceName`, `targetName`,
  `running`. Die alte Implementierung hätte auf dem Controller die Targets selbst als Instanzen gelistet.
- **Datenmodell** (D-05/D-06): `0020_game_server_bindings.sql` — Tabelle `game_server_bindings`
  (UNIQUE `game_title_norm`, CHECK auf `connect_scheme`), `game_events.server_binding_id`
  (`ON DELETE SET NULL`), Index. Drizzle: `gameServerBindings`, `gameEvents.serverBindingId`, Relation.
- **Domain**: `src/server/domain/gameservers/normalize-title.ts` (`normalizeGameTitle`, identisch zu
  `isCod4Game`), `bindings.ts` (`listBindings`, `getBinding`, `findBindingForTitle`, `upsertBinding`,
  `deleteBinding`, `BindingTitleConflictError`, Zod `bindingInputSchema`).
- **Routen** (`/api/integrations/amp`): `GET /instances` (organizer+, unverändert für das bestehende
  Event-Formular), `GET /bindings` (angemeldet, nur aktive; Modul aus → leere Liste), `GET /bindings/all`,
  `POST /bindings`, `PUT /bindings/:id`, `DELETE /bindings/:id` (admin + CSRF; Modul aus → 404).
  Audit: `gameserver.binding_upsert`, `gameserver.binding_delete`. Fehlercodes: `ungueltige_bindung`,
  `binding_titel_existiert`, `binding_nicht_gefunden`, `amp_ca_ungueltig`.
- **Events**: `eventInputSchema`/`updateEventSchema` akzeptieren `serverBindingId` (null = bewusst keine).
  POST ohne Key → Zuordnung per Titel; PATCH mit geändertem Titel → neu zuordnen; unbekannte Id → 400.
  `serializeEvent` liefert `serverBindingId`.
- **Admin-UI**: Abschnitt „CubeCoders AMP" in `AdminPanelBetrieb` (Schalter, Basis-URL, Env-Hinweis) und
  neue Komponente `src/client/gameservers/BindingsAdmin.tsx` (Tabelle + Formular, Instanzauswahl aus
  `GET /instances`, Datalist aus `gameCatalog`). i18n `admin.amp.bindings.*` (de/en).

## Tests

- `amp-session.test.ts` (5): ein Login bei parallelen Aufrufen, Re-Login + Retry, Token-Fallback auf
  Passwort mit Dateirotation, fehlende Env ohne Netzaufruf, unlesbare CA ohne Netzaufruf.
- `normalize-title.test.ts` (2).
- `amp-bindings.test.ts` (2, HTTP über supertest): Rollen-Gate (manager 403 / admin 201), Titelkonflikt
  409, Auto-Zuordnung, explizite Abwahl, unbekannte Id 400, PATCH-Neuzuordnung, deaktivierte Bindung,
  `ON DELETE SET NULL`, Modul aus → leere Liste + 404.
- `app-flow.test.ts`: Migrationsassertion um Tabelle, Index, Spalte und Abwesenheit der Alt-Keys erweitert.
- Gesamt: 194 grün, 2 rot — `push-service-cleanup.test.ts` schlägt auf `main` identisch fehl (Vorbestand,
  nicht Teil dieser Phase).

## Abweichungen vom Plan

- `GET /instances` bleibt für organizer+ offen, weil das Event-Formular aus `fcc03ff` es noch nutzt;
  die Umstellung auf die Bindungsauswahl ist Plan 15-03 (dann Gate auf admin, siehe 15-02 Task 3).
- OpenAPI (`src/server/openapi/hermes-api.yaml`) noch nicht ergänzt (auch Pizza fehlt dort); nachholen in 15-04.
- `npm run build` unter Windows-`cmd` scheitert an `mkdir -p`/`cp` im `build:server`-Skript (Vorbestand);
  `tsc`, `vite build` und der esbuild-Schritt laufen durch.

## Betrieb (außerhalb des Repos)

- AMP-Dienstkonto `hermes` mit minimaler Rolle anlegen (D-17), Env auf docker01 setzen, CA
  `lanparty-amp-ca.crt` mounten, `ampBaseUrl = https://amp-ctl.lanparty.familie-keller.info`.
