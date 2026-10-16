---
phase: 15-amp-gameserver-modul
plan: 03
status: complete
completed: 2026-10-16
requirements: [AMP-03, AMP-04]
---

# 15-03 UI ServerPanel — Summary

## Ergebnis

- **Neues Client-Modul `src/client/gameservers/`**
  - `connect-link.ts`: `buildConnectAction()` — `steam` → `steam://connect/host:port`-Link,
    `minecraft` → Host (Standardport 25565 weggelassen) zum Kopieren, `copy` → `host:port`.
  - `server-status-bus.ts`: kleiner Emitter; der bestehende `EventSource` in `EventBoard` reicht
    `servers_changed`-Payloads (vollständige Statusliste) an alle Hook-Instanzen weiter.
  - `use-server-status.ts`: `useServerStatus(enabled, userId)` → initialer Fetch, Bus-Abo, 30-s-Polling;
    `refresh(force)` nutzt `?refresh=1` nach Aktionen. Ohne Modul/Login keine Requests.
  - `ServerPanel.tsx`: Status-Punkt (`.server-dot--off|starting|on|error`), Statuszeile mit `appState`
    bei Zwischenzuständen, `players / max`, Verbinden-Link bzw. Adresse + „Adresse kopieren"
    (Copy-Status wie `Cod4KeyGenerator`), für `canManage` Start/Stopp/Neustart, „Mehr …" mit Update
    und Abschießen (mit Bestätigung), Konsole auf-/zuklappbar. Aktionsknöpfe werden für `user`/`organizer`
    **nicht gerendert**; die eigentliche Sperre ist serverseitig (15-02).
  - `ServerConsole.tsx`: pollt `GET …/console?since=<seq>` alle 5 s nur im gerenderten Zustand, max. 300
    Zeilen, Auto-Scroll ans Ende (aus, sobald der Nutzer hochscrollt), Eingabezeile → `POST …/console`.
- **`EventCard`**: neue optionale Prop `server?: ServerPanelBinding` (undefined = Modul aus oder Event ohne
  Bindung) → `ServerPanel` direkt vor dem CoD4-Bereich.
- **`EventBoard`**: `useServerStatus`, `servers_changed`-Listener am vorhandenen `EventSource`,
  `runServerAction()` (POST, danach `refresh(true)`, Meldung/Fehler wie bei Events), `canManageServers`
  (admin/manager). Das AMP-Instanz-Dropdown aus `fcc03ff` ist entfernt (`ampInstances`, `ampSelection`,
  `events.amp.*`-Keys). Stattdessen: Bindungen (`GET /bindings`) werden geladen, sobald das Formular
  sichtbar ist; passt der Titel (Normalisierung `src/shared/game-title.ts`, jetzt von Server und Client
  genutzt), erscheint „Server für „X": host:port" mit Checkbox „Server mit diesem Event verknüpfen"
  (Default an → `serverBindingId`, abgewählt → `serverBindingId: null`, kein Treffer → Key weggelassen).
- **Typen**: `ServerStatus` in `src/client/types/core.ts`. **i18n**: `events.server.*`, `events.form.serverHint`,
  `events.form.linkServer` (de/en). **Styles**: `.server-panel`, `.server-dot*`, `.server-connect`,
  `.server-endpoint`, `.button-link`, `.server-actions`, `.server-console-*`, `.event-form-server`, mobil einspaltig.

## Tests

- `connect-link.test.ts` (3), `server-panel.test.tsx` (3, jsdom: user sieht Link + keine Aktionen; manager
  sieht Aktionen, Klick → `onAction("stop")`, „Mehr …" zeigt Abschießen; Copy-Schema + Ladezustand),
  `event-board-server.test.tsx` (3: Hinweis + `serverBindingId` beim Anlegen, Abwahl → `null`,
  kein AMP-Request bei deaktiviertem Modul).
- Gesamt: 211 grün, 2 rot (`push-service-cleanup`, Vorbestand). `tsc` und `vite build` grün.

## Abweichungen vom Plan

- Kein zusätzlicher Listener in `main.tsx`: der `EventSource` lebt in `EventBoard`, dort wurde angedockt.
- `useServerStatus` liefert `byBinding` als `Record` statt `Map` (einfacher in React-State).
- Konsole weiter per Polling (5 s), kein SSE-Kanal dafür.

## Offen (15-04)

- Auto-Start/-Stop, Push „Server läuft", README/Compose, e2e, OpenAPI-Ergänzung.
- Manuelle Abnahme im Betrieb steht aus: Modul in Hermes aktivieren, Bindungen anlegen, als `user` verbinden,
  als `manager` stoppen/starten (siehe `<verification>` im Plan).
