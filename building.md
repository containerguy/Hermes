# Building Hermes

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

Hermes nutzt CSRF Tokens für mutierende, cookie-authentifizierte Requests. Für lokale Entwicklung gibt es einen Dev-Fallback; für produktive Deployments sollte ein eigenes Secret gesetzt werden:

```env
HERMES_CSRF_SECRET=change-me
```

S3/Wasabi ist in `.env.example` bereits auf diese Werte vorbereitet:

```env
HERMES_STORAGE_BACKEND=s3
HERMES_S3_BUCKET=hermes-storage
HERMES_S3_REGION=eu-central-2
HERMES_S3_ENDPOINT=https://s3.eu-central-2.wasabisys.com
HERMES_S3_CREDS_FILE=./s3.creds
HERMES_S3_DB_KEY=hermes.sqlite
HERMES_S3_RESTORE_MODE=if-missing
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

Bei UI-Änderungen sollte mindestens `npm run build` ausgeführt werden, damit TypeScript und Vite die React-Seiten prüfen.

## Tests

```bash
npm test
npm audit
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
docker build -t hermes:local .
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
ghcr.io/containerguy/hermes
```

Tags:

- `latest` für `main`
- Branch-Tag für Branch-Builds
- Git-Tag für Releases wie `v0.1.0`
- `sha-<commit>` für jeden gepushten Commit

Das Repository muss für GitHub Packages Schreibzugriff über `GITHUB_TOKEN` erlauben. Die Workflow-Datei setzt dafür:

```yaml
permissions:
  contents: read
  packages: write
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
HERMES_DB_PATH=./data/hermes.sqlite npm start
```

## S3-Verhalten

Beim Start:

- Wenn `HERMES_STORAGE_BACKEND=s3` und `HERMES_S3_RESTORE_MODE=if-missing` gesetzt ist, wird `HERMES_DB_PATH` aus `s3://hermes-storage/hermes.sqlite` wiederhergestellt, falls lokal keine Datenbank existiert.

Nach Schreiboperationen:

- Hermes erstellt einen SQLite-WAL-Checkpoint.
- Danach wird die SQLite-Datei als Snapshot nach S3 hochgeladen.

Beim Shutdown:

- Hermes versucht erneut, den aktuellen Snapshot nach S3 zu schreiben.

Admin-Aktionen:

- `POST /api/admin/backup` schreibt den aktuellen SQLite-Stand nach S3.
- `GET /api/admin/settings` liefert Settings + Storage-Status (Backup Erfolg/Fehler + Location) für die Admin UI.
- `POST /api/admin/restore` lädt den S3-Snapshot, validiert ihn **vorher**, erstellt ein Recovery-Backup und ersetzt danach (all-or-nothing) die aktiven SQLite-Tabellen.
- `GET /api/admin/audit-log` liefert die letzten Audit-Einträge für Admins.
- `POST /api/admin/invite-codes` erstellt Invite-Codes für öffentliche Registrierung.
- `DELETE /api/admin/users/:id` löscht User per Soft-Delete, widerruft Sessions und Push-Subscriptions.

Profil-Aktionen:

- `GET /api/auth/sessions` listet aktive Geräte des eingeloggten Users.
- `DELETE /api/auth/sessions/:id` meldet ein Gerät ab.
- `POST /api/auth/register` registriert neue User mit aktivem Invite-Code, sofern öffentliche Registrierung in den Settings aktiviert ist.

Wichtig: S3 ist Snapshot-Storage, kein Locking-Backend für mehrere gleichzeitig schreibende Hermes-Instanzen.

## Operator Runbook: Backup & Restore

**Single-Writer Warnung:** Hermes ist für **eine** schreibende Instanz gedacht (SQLite + S3 Snapshots). Mehrere Writer können zu inkonsistenten Snapshots führen.

### Backup prüfen

Im Adminbereich (`/#admin`) zeigt Hermes im Storage-Panel:

- letzte erfolgreiche Backup-Zeit
- letzte Backup-Fehlerzeit inkl. Fehlercode + kurzer Hinweis (ohne Secrets)
- Bucket/Key/Region/Endpoint (nicht geheim)

### Restore Safety

- Restore ist **validation-first** (Tabellen, Migrationen, Spalten, Foreign Keys) und ist bei Fehlern **hard-blocked**.
- Vor dem Restore erstellt Hermes ein **Recovery-Snapshot** unter `recoveries/<timestamp>-<id>.sqlite`.
- Restore ist **all-or-nothing** in einer Transaktion.
- Retention: Hermes behält die letzten **10** Recoveries (Cleanup ist best-effort).

### Rollback mit Recovery-Key

Nach einem Restore liefert Hermes `recovery.id` und `recovery.key`.

Recovery herunterladen:

```bash
aws s3 cp "s3://<bucket>/<recovery.key>" ./recovery.sqlite
```

Rollback:

- Recovery als Live-Key hochladen (z.B. `HERMES_S3_DB_KEY=hermes.sqlite`) und Restore erneut ausführen:

```bash
aws s3 cp ./recovery.sqlite "s3://<bucket>/<HERMES_S3_DB_KEY>"
```

- Oder temporär `HERMES_S3_DB_KEY` auf den Recovery-Key setzen und Restore erneut starten.

Hermes validiert den Snapshot immer vor dem Überschreiben.
