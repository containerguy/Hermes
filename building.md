# Building Hermes

## Voraussetzungen

- Node.js 22
- npm
- Docker fuer Container-Builds
- Zugriff auf den Wasabi Bucket `hermes-storage`
- lokale Datei `s3.creds` mit Access Key und Secret Key

## Abhaengigkeiten Installieren

```bash
npm install
```

## Konfiguration

```bash
cp .env.example .env
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

## Build

```bash
npm run build
```

Der Build erzeugt:

- `dist/` fuer die WebApp
- `dist-server/` fuer den Node-Server

## Tests

```bash
npm test
npm audit
```

Browser-E2E:

```bash
npm run test:e2e
```

Falls Playwright Systembibliotheken fehlen:

```bash
npx playwright install-deps chromium
```

Das benoetigt auf vielen Systemen sudo-Rechte.

## Docker Image Bauen

```bash
docker build -t hermes:local .
```

## GitHub Actions Image Pipeline

Die Pipeline liegt unter:

```text
.github/workflows/docker-image.yml
```

Sie fuehrt bei Pull Requests aus:

- `npm ci`
- `npm test`
- `npm run build`
- `npm audit --omit=dev`
- Docker Build ohne Push

Sie fuehrt bei Push auf `main`, Tags `v*` und manuellem Start aus:

- dieselben Pruefungen
- Docker Build
- Push nach GitHub Container Registry

Image:

```text
ghcr.io/containerguy/hermes
```

Tags:

- `latest` fuer `main`
- Branch-Tag fuer Branch-Builds
- Git-Tag fuer Releases wie `v0.1.0`
- `sha-<commit>` fuer jeden gepushten Commit

Das Repository muss fuer GitHub Packages Schreibzugriff ueber `GITHUB_TOKEN` erlauben. Die Workflow-Datei setzt dafuer:

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

Wichtig: S3 ist Snapshot-Storage, kein Locking-Backend fuer mehrere gleichzeitig schreibende Hermes-Instanzen.
