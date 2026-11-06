# Building Matchdesk

## Voraussetzungen

- Node.js 22
- npm
- Docker für Container-Builds
- Zugriff auf den Wasabi Bucket `hermes-storage`
- lokale Datei `s3.creds` mit Access Key und Secret Key

## Abhängigkeiten Installieren

```bash
npm install
```

## Konfiguration

```bash
cp .env.example .env
```

Matchdesk nutzt CSRF Tokens für mutierende, cookie-authentifizierte Requests. Für lokale Entwicklung gibt es einen Dev-Fallback; für produktive Deployments sollte ein eigenes Secret gesetzt werden:

```env
MATCHDESK_CSRF_SECRET=change-me
MATCHDESK_DEVICE_KEY_SECRET=change-me
```

`MATCHDESK_DEVICE_KEY_SECRET` dient als HMAC-Secret für gespeicherte Geräteschlüssel. Einmal setzen und stabil halten – eine Änderung macht alle bekannten Geräte unbekannt. `MATCHDESK_SESSION_TTL_DAYS` (Standard 180, max. 400) legt fest, nach wie vielen Tagen ohne Nutzung eine Session abläuft.

S3/Wasabi ist in `.env.example` bereits auf diese Werte vorbereitet:

```env
MATCHDESK_STORAGE_BACKEND=s3
MATCHDESK_S3_BUCKET=hermes-storage
MATCHDESK_S3_REGION=eu-central-2
MATCHDESK_S3_ENDPOINT=https://s3.eu-central-2.wasabisys.com
MATCHDESK_S3_CREDS_FILE=./s3.creds
MATCHDESK_S3_DB_KEY=hermes.sqlite
MATCHDESK_S3_RESTORE_MODE=if-missing
```

`s3.creds` bleibt lokal und wird nicht committed.

Unterstützte Credential-Datei-Formate:

```env
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

```env
access-key=...
secret-key=...
```

```text
ACCESS_KEY
SECRET_KEY
```

## Build

```bash
npm run build
```

Der Build erzeugt:

- `dist/` für die WebApp
- `dist-server/` für den Node-Server

Die WebApp nutzt Hash-Seiten, die im gebauten Bundle direkt erreichbar sind:

- `/#events`
- `/#login`
- `/#manager`
- `/#admin`

## Realtime (SSE) Hinweise

Matchdesk nutzt SSE (Server-Sent Events) für Live-Updates. In produktiven Deployments sollten Reverse-Proxies/Load-Balancer SSE-Verbindungen nicht zu aggressiv wegen Idle-Timeouts trennen. Matchdesk sendet Heartbeats und verbindet sich im Client automatisch neu; zusätzlich läuft ein Polling-Fallback.

Bei UI-Änderungen sollte mindestens `npm run build` ausgeführt werden, damit TypeScript und Vite die React-Seiten prüfen.

## Tests

```bash
npm test
npm audit --omit=dev
```

Browser-E2E:

```bash
npm run test:e2e
```

Der E2E-Kernflow navigiert explizit durch `#login`, `#admin`, `#manager` und `#events`, damit die getrennten Arbeitsbereiche geprüft werden.

Falls Playwright Systembibliotheken fehlen:

```bash
npx playwright install-deps chromium
```

Das benötigt auf vielen Systemen sudo-Rechte.

## Docker Image Bauen

```bash
docker build -t matchdesk:local .
```

## GitHub Actions Image Pipeline

Die Pipeline liegt unter:

```text
.github/workflows/docker-image.yml
```

Sie führt bei Pull Requests aus:

- `npm ci`
- `npm test`
- `npm run build`
- `npm audit --omit=dev`
- Docker Build ohne Push

Sie führt bei Push auf `main`, Tags `v*` und manuellem Start aus:

- dieselben Prüfungen
- Docker Build
- Push nach GitHub Container Registry

Image:

```text
ghcr.io/containerguy/matchdesk
```

Tags:

- `latest` für `main`
- Branch-Tag für Branch-Builds
- Git-Tag für Releases wie `v0.1.0`, bei Releases aus `release.yml` zusätzlich `X.Y` (z. B. `0.22`)
- `sha-<commit>` für jeden gepushten Commit

Dieselbe Workflow-Datei ist per `workflow_call` aufrufbar (Eingabe `tag`). Darüber baut `release.yml` das Image für einen neuen Release-Tag, siehe [Release](#release).

Das Repository muss für GitHub Packages Schreibzugriff über `GITHUB_TOKEN` erlauben. Die Workflow-Datei setzt dafür:

```yaml
permissions:
  contents: read
  packages: write
```

## Release

Releases entstehen automatisch mit [release-please](https://github.com/googleapis/release-please) (`.github/workflows/release.yml`). Konfiguration: `release-please-config.json` und `.release-please-manifest.json` (zuletzt veröffentlichte Version).

### Ablauf

1. Feature- und Fix-PRs werden per **Squash** auf `main` gemergt. Ihr PR-Titel ist damit der Commit auf `main`.
2. Nach jedem Push auf `main` pflegt release-please einen offenen Release-PR `chore(release): vX.Y.Z`. Er enthält den Versions-Bump in `package.json`, `package-lock.json` und `src/server/openapi/matchdesk-api.yaml` (Zeile mit `# x-release-please-version`) sowie den neuen Eintrag oben in `CHANGELOG.md`.
3. Der Repo-Owner merged den Release-PR. Derselbe Workflow legt dann Tag `vX.Y.Z` und GitHub-Release (Notes = Changelog-Eintrag) an und ruft `docker-image.yml` mit dem Tag auf. Das Image erscheint als `vX.Y.Z`, `X.Y` und `latest` in GHCR.

Es wird nie direkt auf `main` gepusht. Handgesetzte Tags `v*` bauen wie bisher über den Tag-Trigger von `docker-image.yml`.

### Commit-Konvention

PR-Titel folgen [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>)?!?: <Text>`. Der Prefix ist englisch, der Text darf deutsch sein. Der Workflow `pr-title.yml` prüft das bei jedem PR.

| Typ | Wirkung vor 1.0 |
|---|---|
| `feat` | minor (0.21.0 → 0.22.0), Abschnitt „Features“ |
| `fix`, `perf`, `deps` | patch (0.22.0 → 0.22.1) |
| `feat!:` oder Footer `BREAKING CHANGE: …` | minor bis 1.0.0, eigener Abschnitt mit dem Footer-Text |
| `docs`, `refactor`, `build`, `ci`, `test`, `style`, `chore` | kein Release, nicht im Changelog |

Beispiele: `feat(events): Infos wird Unterseite von Event`, `fix(login): Code nach Ablauf neu anfordern`, `build(deps): Bump vite`.

Steuerung:

- **1.0.0 oder andere Zielversion:** Footer `Release-As: 1.0.0` im Commit (beim Squash-Merge in die Commit-Beschreibung).
- **Falscher Titel nach dem Merge:** In der Beschreibung des gemergten PRs einen Block ergänzen; release-please nimmt beim nächsten Lauf diesen Text statt des Commits:

  ```text
  BEGIN_COMMIT_OVERRIDE
  feat(events): richtiger Titel
  END_COMMIT_OVERRIDE
  ```

- **Upgrade-Notes:** entweder als Footer `BREAKING CHANGE: …` im Feature-PR oder als letzter Commit auf dem Release-PR-Branch (Block „Upgrade note“ im neuen Changelog-Eintrag). Ein weiterer Merge auf `main` baut den Release-PR neu, die Ergänzung muss dann wiederholt werden.

### Voraussetzungen im Repo

- Settings → Actions → General → Workflow permissions: **„Allow GitHub Actions to create and approve pull requests“** eingeschaltet, sonst kann release-please keinen Release-PR anlegen.
- Empfohlen: Settings → General → Pull Requests nur „Allow squash merging“ mit Titel „Pull request title“.
- Kein Secret nötig: Alle Jobs nutzen `GITHUB_TOKEN` mit Rechten pro Job (`release-please`: `contents`, `pull-requests`, `issues` write; Docker: `contents` read, `packages` write; PR-Titel-Check: keine).
- Folge von `GITHUB_TOKEN`: Auf dem Release-PR selbst läuft keine CI. Er enthält nur Version und Changelog; der Code ist auf `main` schon geprüft.

### Lokal prüfen

```bash
npx release-please release-pr --dry-run --token="$GITHUB_TOKEN" \
  --repo-url=containerguy/Matchdesk --target-branch=main
```

## Docker Compose Starten

```bash
docker compose run --rm hermes node dist-server/db/bootstrap-admin.js
docker compose up --build
```

Compose mountet:

```text
./s3.creds -> /run/secrets/s3.creds
```

und speichert lokale SQLite-Daten im Volume:

```text
hermes-data:/data
```

## Produktionsstart Ohne Docker

```bash
npm run build
MATCHDESK_DB_PATH=./data/matchdesk.sqlite npm start
```

## S3-Verhalten

Beim Start:

- Wenn `MATCHDESK_STORAGE_BACKEND=s3` und `MATCHDESK_S3_RESTORE_MODE=if-missing` gesetzt ist, wird `MATCHDESK_DB_PATH` aus `s3://hermes-storage/hermes.sqlite` wiederhergestellt, falls lokal keine Datenbank existiert.

Nach Schreiboperationen:

- Matchdesk erstellt einen SQLite-WAL-Checkpoint.
- Danach wird die SQLite-Datei als Snapshot nach S3 hochgeladen.

Beim Shutdown:

- Matchdesk versucht erneut, den aktuellen Snapshot nach S3 zu schreiben.

Admin-Aktionen:

- `POST /api/admin/backup` schreibt den aktuellen SQLite-Stand nach S3.
- `GET /api/admin/settings` liefert Settings + Storage-Status (Backup Erfolg/Fehler + Location) für die Admin UI.
- `POST /api/admin/restore` lädt den S3-Snapshot, validiert ihn **vorher**, erstellt ein Recovery-Backup und ersetzt danach (all-or-nothing) die aktiven SQLite-Tabellen.
- `GET /api/admin/audit-log` liefert die letzten Audit-Einträge für Admins.
- `POST /api/admin/invite-codes` erstellt Invite-Codes für öffentliche Registrierung.
- `DELETE /api/admin/users/:id` löscht User per Soft-Delete, widerruft Sessions und Push-Subscriptions.

Profil-Aktionen:

- `GET /api/auth/sessions` listet aktive Geräte des eingeloggten Users.
- `PATCH /api/auth/sessions/:id` benennt ein Gerät um (der Name bleibt am Gerät, auch über Logout hinweg).
- `DELETE /api/auth/sessions/:id` meldet ein Gerät ab (das Gerät bleibt bekannt).
- `POST /api/auth/device/forget` vergisst das aktuelle Gerät: Sessions des Geräts werden widerrufen, Session- und Geräte-Cookie gelöscht.
- `POST /api/auth/verify-code` und `POST /api/auth/pair-redeem` liefern zusätzlich `device: { name, recognized }` und setzen das Geräte-Cookie `matchdesk_device`.
- `POST /api/auth/register` registriert neue User mit aktivem Invite-Code, sofern öffentliche Registrierung in den Settings aktiviert ist.

Wichtig: S3 ist Snapshot-Storage, kein Locking-Backend für mehrere gleichzeitig schreibende Matchdesk-Instanzen.

## Operator Runbook: Backup & Restore

**Single-Writer Warnung:** Matchdesk ist für **eine** schreibende Instanz gedacht (SQLite + S3 Snapshots). Mehrere Writer können zu inkonsistenten Snapshots führen.

### Backup prüfen

Im Adminbereich (`/#admin`) zeigt Matchdesk im Storage-Panel:

- letzte erfolgreiche Backup-Zeit
- letzte Backup-Fehlerzeit inkl. Fehlercode + kurzer Hinweis (ohne Secrets)
- Bucket/Key/Region/Endpoint (nicht geheim)

### Restore Safety

- Restore ist **validation-first** (Tabellen, Migrationen, Spalten, Foreign Keys) und ist bei Fehlern **hard-blocked**.
- Vor dem Restore erstellt Matchdesk ein **Recovery-Snapshot** unter `recoveries/<timestamp>-<id>.sqlite`.
- Restore ist **all-or-nothing** in einer Transaktion.
- Retention: Matchdesk behält die letzten **10** Recoveries (Cleanup ist best-effort).

### Rollback mit Recovery-Key

Nach einem Restore liefert Matchdesk `recovery.id` und `recovery.key`.

Recovery herunterladen:

```bash
aws s3 cp "s3://<bucket>/<recovery.key>" ./recovery.sqlite
```

Rollback:

- Recovery als Live-Key hochladen (z.B. `MATCHDESK_S3_DB_KEY=hermes.sqlite`) und Restore erneut ausführen:

```bash
aws s3 cp ./recovery.sqlite "s3://<bucket>/<MATCHDESK_S3_DB_KEY>"
```

- Oder temporär `MATCHDESK_S3_DB_KEY` auf den Recovery-Key setzen und Restore erneut starten.

Matchdesk validiert den Snapshot immer vor dem Überschreiben.
