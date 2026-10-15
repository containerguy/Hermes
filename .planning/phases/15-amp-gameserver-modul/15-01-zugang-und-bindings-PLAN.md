---
phase: 15-amp-gameserver-modul
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server/env.ts
  - src/server/settings.ts
  - src/server/integrations/amp/amp-client.ts
  - src/server/integrations/amp/amp-session.ts
  - src/server/db/migrations/0019_game_server_bindings.sql
  - src/server/db/schema.ts
  - src/server/domain/gameservers/bindings.ts
  - src/server/domain/gameservers/normalize-title.ts
  - src/server/http/amp-routes.ts
  - src/server/http/app-flow.test.ts
  - src/client/types/core.ts
  - src/client/components/AdminPanel.tsx
  - src/client/components/AdminPanelBetrieb.tsx
  - src/main.tsx
  - .env.example
autonomous: true
requirements: [AMP-01, AMP-02]
must_haves:
  truths:
    - "Hermes meldet sich genau einmal pro Prozess bei AMP an, hält die SESSIONID und meldet sich bei Ablauf selbst neu an (rememberMeToken vor Passwort)."
    - "AMP-Zugangsdaten und CA kommen ausschließlich aus Env-Variablen; app_settings enthält keine Zugangsdaten mehr."
    - "TLS zum Controller wird gegen HERMES_AMP_CA_FILE verifiziert; ohne CA-Datei wird das System-Trust-Store genutzt, nie skipVerify."
    - "Es gibt eine Tabelle game_server_bindings und game_events.server_binding_id; Bindungen werden über die Titel-Normalisierung automatisch zugeordnet."
    - "Admins pflegen Bindungen über /api/integrations/amp/bindings; andere Rollen bekommen 403."
  artifacts:
    - path: "src/server/db/migrations/0019_game_server_bindings.sql"
      provides: "Tabelle game_server_bindings, Spalte game_events.server_binding_id, Bereinigung der alten Settings-Keys"
      contains: "CREATE TABLE IF NOT EXISTS game_server_bindings"
    - path: "src/server/integrations/amp/amp-session.ts"
      provides: "Session-Cache mit Warteschlange, Re-Login und rememberMe-Rotation"
      exports: ["getAmpSession", "ampCall", "resetAmpSession"]
    - path: "src/server/domain/gameservers/normalize-title.ts"
      provides: "normalizeGameTitle() — identisch zur Client-Normalisierung in isCod4Game"
      exports: ["normalizeGameTitle"]
    - path: "src/server/domain/gameservers/bindings.ts"
      provides: "CRUD + Lookup für Bindungen"
      exports: ["listBindings", "upsertBinding", "deleteBinding", "findBindingForTitle"]
  key_links:
    - from: "src/server/http/event-routes.ts"
      to: "findBindingForTitle"
      via: "beim Create/Patch eines Events"
      pattern: "serverBindingId"
    - from: "src/server/integrations/amp/amp-client.ts"
      to: "ampCall"
      via: "alle AMP-Aufrufe laufen durch die Session-Warteschlange"
      pattern: "ampCall("
---

<objective>
Den Client aus `fcc03ff` produktionsfähig machen und das Datenmodell für Bindungen legen: Zugangsdaten raus aus der Datenbank (D-02), eine gecachte AMP-Session mit Warteschlange (D-03), TLS gegen die LANPARTY-CA (D-04), Tabelle `game_server_bindings` plus Event-Verknüpfung (D-05, D-06) und die Admin-Pflege der Bindungen (D-13, Admin-Teil).

Purpose: Ohne stabile Session und ohne Bindungen kann weder der Statusdienst (15-02) noch die Oberfläche (15-03) gebaut werden. Die Entfernung der Klartext-Zugangsdaten ist Voraussetzung für jedes Ausrollen.

Output: Migration `0019`, erweiterter Client, neues Session-Modul, Bindungs-Domain, Admin-Endpunkte und -UI, bereinigte Settings.
</objective>

<execution_context>
@$HOME/.cursor/get-shit-done/workflows/execute-plan.md
@$HOME/.cursor/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/15-amp-gameserver-modul/15-CONTEXT.md
@AGENTS.md
@src/server/integrations/amp/amp-client.ts
@src/server/http/amp-routes.ts
@src/server/settings.ts
@src/server/env.ts
@src/server/db/schema.ts
@src/server/db/migrations/0018_pizza_session_global.sql
@src/client/cod4/isCod4Game.ts

<interfaces>
Neue Verträge, die 15-02/15-03 konsumieren:

```typescript
// src/server/env.ts (Ergänzung)
export function getAmpCredentials(): { username: string; password: string; rememberTokenFile?: string } | null;
export function getAmpCaFile(): string | undefined;

// src/server/integrations/amp/amp-session.ts
export type AmpSession = { sessionId: string; obtainedAt: number };
export function getAmpSession(settings: HermesSettings): Promise<AmpSession>;
export function ampCall<T = unknown>(settings: HermesSettings, method: string, body?: Record<string, unknown>): Promise<T>;
export function resetAmpSession(): void;   // nach 401/Session.Exists oder Settings-Änderung

// src/server/domain/gameservers/normalize-title.ts
export function normalizeGameTitle(title: string): string;   // lowercase, nur [a-z0-9]

// src/server/domain/gameservers/bindings.ts
export type GameServerBinding = {
  id: string; gameTitleNorm: string; displayTitle: string;
  ampInstanceId: string; ampInstanceName: string;
  host: string; port: number; connectScheme: "steam" | "minecraft" | "copy";
  enabled: boolean; createdAt: string; updatedAt: string;
};
export function listBindings(context: DatabaseContext): GameServerBinding[];
export function upsertBinding(context: DatabaseContext, input: BindingInput): GameServerBinding;
export function deleteBinding(context: DatabaseContext, id: string): boolean;
export function findBindingForTitle(context: DatabaseContext, title: string): GameServerBinding | null;
```

Settings nach dieser Phase (`src/server/settings.ts`): `ampIntegrationEnabled: boolean`, `ampBaseUrl: string` bleiben; `ampUsername`, `ampPassword`, `ampTlsSkipVerify` werden entfernt; neu in 15-04: `ampAutoStartOnReady`, `ampAutoStopIdleMinutes`.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Env-Zugang und Settings bereinigen</name>
  <files>src/server/env.ts, src/server/settings.ts, src/client/types/core.ts, src/client/components/AdminPanel.tsx, src/main.tsx, src/client/components/*.test.tsx, src/server/http/app-flow.test.ts, .env.example</files>
  <read_first>
    - src/server/env.ts (Muster `getDatabasePath()`)
    - src/server/settings.ts (Schema, `PUBLIC_KEYS`, Defaults — Stand nach Rebase enthält `ampUsername`/`ampPassword`/`ampTlsSkipVerify`)
    - .planning/phases/15-amp-gameserver-modul/15-CONTEXT.md (D-02, D-04)
  </read_first>
  <action>
    1. `src/server/env.ts`: `getAmpCredentials()` liest `HERMES_AMP_USERNAME`, `HERMES_AMP_PASSWORD`, optional `HERMES_AMP_REMEMBER_TOKEN_FILE`; gibt `null`, wenn Username oder Passwort fehlen. `getAmpCaFile()` liest `HERMES_AMP_CA_FILE` und prüft mit `fs.existsSync`; fehlende Datei → Warnung einmalig auf `console.warn`, Rückgabe `undefined`.
    2. `src/server/settings.ts`: Keys `ampUsername`, `ampPassword`, `ampTlsSkipVerify` aus Schema, Union-Typ, Defaults und Public-Projektion entfernen. `ampIntegrationEnabled` und `ampBaseUrl` bleiben; `ampBaseUrl` wird mit der bestehenden `normalizeAmpBaseUrl()`-Logik validiert (Fehlercode `amp_url_ungueltig`).
    3. Alle Client-Typen/Defaults/Test-Fixtures auf die reduzierten Keys angleichen (`core.ts`, `AdminPanel.tsx`, `main.tsx`, `login-panel.test.tsx`, `admin-panel.test.tsx`, `ui-correctness.test.tsx`, `app-flow.test.ts`).
    4. `.env.example`: die vier neuen Variablen mit Kommentar ergänzen (ohne Werte).
    5. Fehlercodes in `src/client/errors/errors.ts`: `amp_zugang_erforderlich` → Text „AMP-Zugangsdaten fehlen in der Server-Umgebung (HERMES_AMP_USERNAME/PASSWORD)." (de/en).
  </action>
  <verify>
    <automated>rg -n "ampPassword|ampUsername|ampTlsSkipVerify" src && exit 1 || echo ok; npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <acceptance_criteria>
    - `rg "ampPassword" src` liefert keine Treffer.
    - `npx tsc --noEmit` ist grün.
    - `.env.example` enthält `HERMES_AMP_USERNAME`, `HERMES_AMP_PASSWORD`, `HERMES_AMP_REMEMBER_TOKEN_FILE`, `HERMES_AMP_CA_FILE`.
  </acceptance_criteria>
  <done>Zugangsdaten existieren nur noch als Env; Build ist grün.</done>
</task>

<task type="auto">
  <name>Task 2: Session-Cache mit Warteschlange und CA-Verifikation</name>
  <files>src/server/integrations/amp/amp-session.ts, src/server/integrations/amp/amp-client.ts, src/server/integrations/amp/amp-session.test.ts</files>
  <read_first>
    - src/server/integrations/amp/amp-client.ts (bestehende `ampPostJson`, `unwrapAmpData`, Fehlercodes)
    - 15-CONTEXT.md (D-03, D-04, AMP-Fakten: Login-Body, Accept-Header)
  </read_first>
  <action>
    1. `amp-session.ts`: Modul-Singleton `{ sessionId, rememberMeToken, obtainedAt, inflightLogin }`. `getAmpSession()` meldet an mit `Core/Login { username, password: rememberMeToken ?? password, token: "", rememberMe: true }`; Erfolg = `success === true` mit `sessionID`. Bei Fehlschlag mit rememberMeToken sofort Fallback auf Passwort. `rememberMeToken` wird bei jedem Login-Erfolg in `HERMES_AMP_REMEMBER_TOKEN_FILE` (mode 0600) geschrieben, falls gesetzt.
    2. `ampCall()`: serialisiert alle Aufrufe über eine Promise-Kette (max. 1 gleichzeitig), hängt `SESSIONID` an, sendet `Accept: application/json` und `Content-Type: application/json`. Antwort mit `Title === "Unauthorized"`/HTTP 401/`resultReason` enthält `Session` → `resetAmpSession()` und genau ein Retry.
    3. TLS: Dispatcher mit `ca: fs.readFileSync(getAmpCaFile())` (undici `Agent({ connect: { ca } })`), gecacht pro CA-Pfad. Kein `rejectUnauthorized: false` im Code.
    4. `amp-client.ts`: `fetchAmpInstances()` nutzt `ampCall` statt eigenem Login; `GetApplicationEndpoints` bleibt, aber nur für Instanzen, die `IsContainerInstance`/`Running` unabhängig sind (keine Filterung ändern, nur Transport).
    5. Tests (`amp-session.test.ts`, vitest, `globalThis.fetch` gemockt): (a) zwei parallele `ampCall` lösen genau einen Login aus; (b) 401 beim Aufruf → Re-Login + Retry; (c) rememberMeToken-Login fehlgeschlagen → Passwort-Login; (d) fehlende Env → Fehler `amp_zugang_erforderlich` ohne Netzaufruf.
  </action>
  <verify>
    <automated>npx vitest run src/server/integrations/amp</automated>
  </verify>
  <acceptance_criteria>
    - `rg "rejectUnauthorized" src` liefert keine Treffer.
    - Vier Testfälle grün.
    - `ampCall` ist der einzige Ort, an dem `SESSIONID` gesetzt wird (`rg "SESSIONID" src/server` → nur amp-session.ts).
  </acceptance_criteria>
  <done>Ein Login pro Prozess, automatische Erneuerung, TLS verifiziert.</done>
</task>

<task type="auto">
  <name>Task 3: Migration 0019 und Drizzle-Schema für Bindungen</name>
  <files>src/server/db/migrations/0019_game_server_bindings.sql, src/server/db/schema.ts, src/server/http/app-flow.test.ts</files>
  <read_first>
    - src/server/db/migrations/0018_pizza_session_global.sql (jüngste Migration, Stil)
    - src/server/db/schema.ts (`gameEvents`, Index-Stil, relations)
    - 15-CONTEXT.md (D-05, D-06)
  </read_first>
  <action>
    Migration `0019_game_server_bindings.sql`:
    1. Header `-- Phase 15: AMP-Gameserver-Modul (AMP-01, AMP-02)`.
    2. `CREATE TABLE IF NOT EXISTS game_server_bindings (id TEXT PRIMARY KEY, game_title_norm TEXT NOT NULL, display_title TEXT NOT NULL, amp_instance_id TEXT NOT NULL, amp_instance_name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, connect_scheme TEXT NOT NULL DEFAULT 'copy', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`
    3. `CREATE UNIQUE INDEX IF NOT EXISTS game_server_bindings_title_unique ON game_server_bindings(game_title_norm);`
    4. `ALTER TABLE game_events ADD COLUMN server_binding_id TEXT REFERENCES game_server_bindings(id) ON DELETE SET NULL;`
    5. `CREATE INDEX IF NOT EXISTS game_events_server_binding_idx ON game_events(server_binding_id);`
    6. `DELETE FROM app_settings WHERE key IN ('ampUsername','ampPassword','ampTlsSkipVerify');`
    Schema: `gameServerBindings` als `sqliteTable` spiegeln, `gameEvents.serverBindingId` ergänzen, Relation `gameEvents → gameServerBindings` eintragen. Migrations-Assertion in `app-flow.test.ts` um Tabelle, Index und Spalte erweitern.
  </action>
  <verify>
    <automated>npx vitest run src/server/http/app-flow.test.ts -t "migrations"</automated>
  </verify>
  <acceptance_criteria>
    - `ls src/server/db/migrations | sort | tail -1` → `0019_game_server_bindings.sql`.
    - Schema exportiert `gameServerBindings`; `gameEvents` hat `serverBindingId`.
    - Migrationstest prüft `game_server_bindings_title_unique` und `server_binding_id`.
  </acceptance_criteria>
  <done>Datenmodell steht, Alt-Keys werden bereinigt.</done>
</task>

<task type="auto">
  <name>Task 4: Bindungs-Domain, Admin-Endpunkte und automatische Zuordnung</name>
  <files>src/server/domain/gameservers/normalize-title.ts, src/server/domain/gameservers/bindings.ts, src/server/domain/gameservers/bindings.test.ts, src/server/http/amp-routes.ts, src/server/http/event-routes.ts, src/client/components/AdminPanelBetrieb.tsx, src/client/types/core.ts, src/client/i18n/catalog/de.ts, src/client/i18n/catalog/en.ts</files>
  <read_first>
    - src/client/cod4/isCod4Game.ts (Normalisierung — serverseitig identisch nachbauen)
    - src/server/http/pizza-routes.ts (Feature-Gate `featuresPizzaEnabled` → hier `ampIntegrationEnabled`)
    - src/server/domain/users.ts (`canAssignRoles` für Admin-Gate)
    - src/server/http/event-routes.ts (Create/Patch; dort `serverBindingId` setzen)
  </read_first>
  <action>
    1. `normalize-title.ts`: `normalizeGameTitle(title) = title.toLowerCase().replace(/[^a-z0-9]/g, "")`.
    2. `bindings.ts`: Zod-Schema `bindingInputSchema` (displayTitle 1–160, ampInstanceId 1–64, ampInstanceName 1–120, host 1–253, port 1–65535, connectScheme enum, enabled). `upsertBinding` schreibt `game_title_norm` aus `displayTitle`; Konflikt auf `game_title_norm` → Fehlercode `binding_titel_existiert`. Audit `gameserver.binding_upsert` / `gameserver.binding_delete`.
    3. `amp-routes.ts`: `GET /bindings` (alle Angemeldeten, nur `enabled`), `PUT /bindings/:id` + `POST /bindings` + `DELETE /bindings/:id` (nur `admin`, sonst 403 `admin_erforderlich`). Feature-Gate wie Pizza: Modul aus → 404 für alle Bindungs-Routen außer `GET` (liefert leere Liste).
    4. `event-routes.ts`: bei `POST /` und `PATCH /:id` → `serverBindingId = findBindingForTitle(gameTitle)?.id ?? null`, es sei denn der Body setzt explizit `serverBindingId: null` (Abwahl). Event-Antwort (`toEventView`) enthält `serverBindingId`.
    5. Admin-UI in `AdminPanelBetrieb.tsx`: Abschnitt „Gameserver (AMP)" mit Schalter `ampIntegrationEnabled`, Feld `ampBaseUrl`, Tabelle der Bindungen (Titel, Instanz, host:port, Schema, aktiv) und Formular; Instanz-Auswahl per `GET /api/integrations/amp/instances` (nur wenn Modul aktiv). i18n-Keys `admin.amp.*`, `admin.bindings.*` in de/en.
    6. Tests `bindings.test.ts`: Normalisierung („Counter-Strike 1.6" ↔ „counterstrike16"), Upsert-Konflikt, Lookup, Admin-Gate (403 für manager).
  </action>
  <verify>
    <automated>npx vitest run src/server/domain/gameservers src/server/http/app-flow.test.ts && npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <acceptance_criteria>
    - `POST /api/integrations/amp/bindings` als `manager` → 403; als `admin` → 201.
    - Event mit Titel „Minecraft" erhält automatisch die Bindung mit `game_title_norm = "minecraft"`.
    - Admin-Panel zeigt Bindungen und speichert sie; keine Zugangsdaten-Felder mehr sichtbar.
  </acceptance_criteria>
  <done>Bindungen sind pflegbar und werden Events automatisch zugeordnet.</done>
</task>

</tasks>

<threat_model>
| ID | Category | Threat | Decision | Mitigation |
|----|----------|--------|----------|------------|
| T-15-01 | Information Disclosure | AMP-Passwort in SQLite/Backups/S3 | mitigate | D-02: nur Env; Migration löscht Alt-Keys; Settings-Export enthält sie nicht mehr. |
| T-15-02 | Spoofing | MITM auf dem Weg docker01 → amp-ctl | mitigate | D-04: CA-Pinning über `HERMES_AMP_CA_FILE`; kein skipVerify im Code. |
| T-15-03 | DoS | AMP-Login-Rate-Limit (120/60 s) durch Login pro Aufruf | mitigate | D-03: eine Session, Warteschlange, Retry höchstens einmal. |
| T-15-04 | Elevation | Nicht-Admin legt Bindung auf fremde Instanz | mitigate | Admin-Gate serverseitig; Steuerung (15-02) nur auf gebundene Instanzen. |
| T-15-05 | Information Disclosure | rememberMeToken auf Platte | accept | Datei 0600, Pfad optional; ohne Datei wird bei jedem Prozessstart per Passwort angemeldet. |
</threat_model>

<verification>
- `npx tsc --noEmit -p tsconfig.json` grün.
- `npx vitest run src` grün.
- `rg "ampPassword|rejectUnauthorized" src` leer.
- Manuell gegen den echten Controller (nur Betrieb, nicht CI): `HERMES_AMP_*` gesetzt, `GET /api/integrations/amp/instances` liefert die sechs Instanzen; AMP-Log zeigt genau einen Login.
</verification>

<success_criteria>
- Zugangsdaten nur per Env; Settings bereinigt.
- Eine gecachte AMP-Session mit Re-Login.
- Tabelle `game_server_bindings` + Event-Verknüpfung + Admin-Pflege.
</success_criteria>

<output>
Nach Abschluss `.planning/phases/15-amp-gameserver-modul/15-01-SUMMARY.md` anlegen: Migrationsname, neue Env-Variablen, neue Exporte, Testabdeckung, ggf. Abweichungen vom Plan.
</output>
