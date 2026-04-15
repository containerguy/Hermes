# Hermes

Hermes ist eine responsive WebApp fuer LAN-Party-Spielrunden. User melden sich mit Telefonnummer, Username und E-Mail-Einmalcode an, Manager legen Events an, und Teilnehmer stimmen mit `dabei` oder `nicht dabei` ab.

## Lokal starten

```bash
npm install
cp .env.example .env
npm run db:bootstrap-admin
npm run build
npm start
```

Die App laeuft danach auf `http://localhost:3000`.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

Das Image speichert SQLite-Daten unter `/data/hermes.sqlite`. In `docker-compose.yml` ist dafuer das Volume `hermes-data` eingebunden.

## Admin-Bootstrap

Beim Bootstrap wird der Haupt-Admin anhand dieser Variablen angelegt oder aktualisiert:

```env
HERMES_ADMIN_PHONE=+491700000000
HERMES_ADMIN_USERNAME=admin
HERMES_ADMIN_EMAIL=admin@example.test
```

Im Docker-Betrieb kann der Bootstrap innerhalb des Containers ausgefuehrt werden:

```bash
docker compose run --rm hermes node dist-server/db/bootstrap-admin.js
```

Der Server fuehrt Migrationen beim Start automatisch aus. Der Admin-Bootstrap ist fuer den ersten Admin in der lokalen Entwicklung vorgesehen; im Container kann alternativ ein initiales Datenbank-Volume mit bereits gebootstrapptem Admin genutzt werden.

## Mail

Login-Codes werden per SMTP versendet. Fuer lokale Tests kann `HERMES_MAIL_MODE=console` genutzt werden.

```env
HERMES_MAIL_MODE=smtp
HERMES_MAIL_FROM=Hermes <hermes@example.test>
HERMES_SMTP_HOST=smtp.example.test
HERMES_SMTP_PORT=587
HERMES_SMTP_SECURE=false
HERMES_SMTP_USER=
HERMES_SMTP_PASSWORD=
```

## Push Notifications

Web Push benoetigt VAPID Keys:

```bash
npx web-push generate-vapid-keys
```

Danach in `.env` eintragen:

```env
HERMES_VAPID_SUBJECT=mailto:admin@example.test
HERMES_VAPID_PUBLIC_KEY=
HERMES_VAPID_PRIVATE_KEY=
```

Browser erlauben Push Notifications nur in einem Secure Context. Hermes liefert kein SSL/TLS, keinen Reverse Proxy und kein Zertifikatsmanagement mit.

## Backup und Reset

Backup:

```bash
docker compose stop
docker run --rm -v hermes_hermes-data:/data -v "$PWD":/backup busybox cp /data/hermes.sqlite /backup/hermes.sqlite.bak
docker compose up -d
```

Reset:

```bash
docker compose down -v
```

## Pruefung

```bash
npm test
npm run build
npm audit
```

Der Playwright-Test ist vorbereitet:

```bash
npm run test:e2e
```

Falls Chromium wegen fehlender Systembibliotheken nicht startet, muessen die Playwright OS-Abhaengigkeiten auf dem Host installiert werden.
