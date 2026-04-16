# Hermes

Hermes ist eine responsive WebApp für LAN-Party-Spielrunden. User melden sich mit Username und E-Mail-Einmalcode an, Manager legen Events an, und Teilnehmer stimmen mit `dabei` oder `nicht dabei` ab.

## Oberfläche

Die WebApp ist in getrennte Arbeitsbereiche aufgeteilt:

- `#events`: Eventübersicht für Abstimmung, Status, Startzeit und Serverdaten.
- `#login`: Login vor der Anmeldung; nach dem Login wird daraus `Profil` mit Konto, Logout, Notification-Einstellungen und Geräteverwaltung.
- `#manager`: Eventanlage und Eventsteuerung für Manager und Admins.
- `#admin`: Userverwaltung, Rollenzuweisung, Invite-Codes, Audit-Log und globale Einstellungen.

Das Managerformular wird bewusst nur im Managerbereich angezeigt. Die Eventübersicht bleibt damit für Teilnehmer auf Abstimmung und Status fokussiert.

Im Adminbereich können zusätzlich die Designfarben gespeichert werden. Diese Werte liegen wie die übrigen App-Einstellungen in `app_settings` und werden beim Laden der WebApp angewendet.

Admins sehen im Bereich `#admin` außerdem ein Audit-Log. Dort werden Login/Logout, User- und Settingsänderungen, Eventaktionen, Teilnahmen sowie Backup/Restore-Aktionen chronologisch angezeigt.

Admins können öffentliche Registrierung aktivieren und Invite-Codes für LAN-Partys erstellen. Neue User registrieren sich dann mit Invite-Code, Username und E-Mail-Adresse; danach wird der Login-Code per E-Mail verschickt.

Invite-Codes sind dabei **credential-like**: Sie werden von Hermes generiert, sind für Admins sichtbar und sollten wie Zugangsdaten behandelt werden. Audit-Logs enthalten bewusst nur eine maskierte Variante (kein vollständiger Invite-Code in den Metadaten).

## Wo Werden Einstellungen Gespeichert?

Hermes speichert Einstellungen in SQLite in der Tabelle `app_settings`.

Die SQLite-Datei liegt lokal unter:

```text
HERMES_DB_PATH
```

Im Docker-Setup ist das:

```text
/data/hermes.sqlite
```

Mit S3-Backend bleibt SQLite die lokale Arbeitsdatenbank. S3 wird als persistentes Snapshot-Backend verwendet: Beim Start wird die Datenbank aus S3 wiederhergestellt, falls lokal keine Datenbank existiert, und nach Schreiboperationen wird ein Snapshot nach S3 hochgeladen.

Das ist absichtlich kein verteiltes Live-Dateisystem. Hermes ist für eine einzelne laufende Instanz gedacht.

## Wasabi S3

Die Vorgabe ist eingetragen:

```env
HERMES_STORAGE_BACKEND=s3
HERMES_S3_BUCKET=hermes-storage
HERMES_S3_REGION=eu-central-2
HERMES_S3_ENDPOINT=https://s3.eu-central-2.wasabisys.com
HERMES_S3_CREDS_FILE=./s3.creds
HERMES_S3_DB_KEY=hermes.sqlite
HERMES_S3_RESTORE_MODE=if-missing
```

`s3.creds` wird nicht versioniert. Unter Docker wird die Datei readonly nach `/run/secrets/s3.creds` gemountet.

Unterstützte Formate für `s3.creds`:

```env
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Alternativ:

```env
access_key=...
secret_key=...
```

Wasabi-Export mit Bindestrich wird ebenfalls erkannt:

```env
access-key=...
secret-key=...
```

Oder zwei Zeilen ohne Schlüsselname:

```text
ACCESS_KEY
SECRET_KEY
```

## Lokal Starten

```bash
npm install
cp .env.example .env
npm run db:bootstrap-admin
npm run build
npm start
```

Für produktive Deployments sollte zusätzlich ein eigenes CSRF-Secret gesetzt werden (in `.env`):

```env
HERMES_CSRF_SECRET=change-me
```

Die App läuft danach auf:

```text
http://localhost:3000
```

Direkte Einstiege:

```text
http://localhost:3000/#events
http://localhost:3000/#login
http://localhost:3000/#manager
http://localhost:3000/#admin
```

## Docker

```bash
cp .env.example .env
docker compose run --rm hermes node dist-server/db/bootstrap-admin.js
docker compose up --build
```

Das Compose-Setup nutzt:

- SQLite unter `/data/hermes.sqlite`
- Docker Volume `hermes-data`
- Wasabi S3 Snapshot `s3://hermes-storage/hermes.sqlite`
- Credentials aus `./s3.creds`

## Mail

Login-Codes werden per SMTP versendet. Für lokale Tests kann `HERMES_MAIL_MODE=console` genutzt werden.

```env
HERMES_MAIL_MODE=smtp
HERMES_MAIL_FROM=Hermes <hermes@example.test>
HERMES_SMTP_HOST=smtp.example.test
HERMES_SMTP_PORT=587
HERMES_SMTP_SECURE=false
HERMES_SMTP_SECURITY=starttls
HERMES_SMTP_USER=
HERMES_SMTP_PASSWORD=
```

Hinweis: Für Port `587` ist normalerweise STARTTLS korrekt (`HERMES_SMTP_SECURITY=starttls`). Für Port `465` ist implizites TLS korrekt (`HERMES_SMTP_SECURITY=tls`). Der Fehler `wrong version number` bedeutet fast immer, dass implizites TLS gegen einen STARTTLS-Port gesprochen wurde.

## Push Notifications

Web Push benötigt VAPID Keys:

```bash
npx web-push generate-vapid-keys
```

Danach in `.env` eintragen:

```env
HERMES_VAPID_SUBJECT=mailto:admin@example.test
HERMES_VAPID_PUBLIC_KEY=
HERMES_VAPID_PRIVATE_KEY=
```

Browser erlauben Push Notifications nur in einem Secure Context. `http://localhost` funktioniert für lokale Tests, normale HTTP-LAN-Adressen wie `http://192.168.x.x` gelten aber nicht als Secure Context. Hermes liefert kein SSL/TLS, keinen Reverse Proxy und kein Zertifikatsmanagement mit.

Hermes setzt bei Push-Benachrichtigungen eine Vibrationssequenz und nutzt `requireInteraction` für neue Runden. Ob das Smartphone vibriert oder einen Ton abspielt, entscheidet trotzdem das Betriebssystem, der Browser und die App-/PWA-Installation. Eigene Benachrichtigungstöne können Web Push Benachrichtigungen auf iOS/Android nicht zuverlässig erzwingen.

## Backup, Restore Und Reset

S3 ist das primäre persistente Snapshot-Backend. Admins können im Adminbereich aktiv ein Backup nach S3 starten oder den aktuellen Datenstand aus dem S3-Snapshot wiederherstellen.

**Single-Writer Warnung:** Hermes nutzt SQLite + S3 Snapshots. Das ist **kein** Live-Locking-Backend. Es sollte immer nur **eine** schreibende Hermes-Instanz laufen, sonst können Snapshots inkonsistent werden.

### Backup prüfen (Admin UI)

Im Adminbereich (`/#admin`) zeigt Hermes im Storage-Bereich:

- letzte erfolgreiche Backup-Zeit
- letzte Backup-Fehlerzeit inkl. Fehlercode + kurzer Hinweis (ohne Secrets)
- nicht-geheime Location-Details (Bucket/Key/Region/Endpoint)

### Restore Safety Modell

Restore ist bewusst **validation-first** und **hard-blocked**:

- Snapshot wird vor dem Überschreiben geprüft (Tabellen, Migrations-Stand, kompatible Spalten, Foreign Keys).
- Wenn die Validierung fehlschlägt, wird **nichts** mutiert (kein “force restore”).
- Vor dem eigentlichen Restore erstellt Hermes ein **Recovery-Snapshot** nach S3.
- Restore läuft all-or-nothing in einer Transaktion.

Recovery Retention: Hermes behält die letzten **10** Recoveries (ältere werden best-effort gelöscht).

### Failed-Restore Recovery (Rollback)

Bei einem erfolgreichen Restore zeigt Hermes die Recovery Info:

- `recovery.id`
- `recovery.key` (z.B. `recoveries/...sqlite`)

Recovery aus S3 herunterladen (Beispiel):

```bash
aws s3 cp "s3://<bucket>/<recovery.key>" ./recovery.sqlite
```

Rollback-Optionen:

1) Recovery-Snapshot als neues Live-Snapshot-Target hochladen (z.B. `HERMES_S3_DB_KEY=hermes.sqlite`):

```bash
aws s3 cp ./recovery.sqlite "s3://<bucket>/<HERMES_S3_DB_KEY>"
```

2) Alternativ temporär `HERMES_S3_DB_KEY` auf den Recovery-Key setzen und Restore erneut ausführen.

Hermes validiert den Snapshot immer vor dem Überschreiben.

Für lokale manuelle Backups kann zusätzlich die SQLite-Datei gesichert werden.

Backup aus Docker Volume:

```bash
docker compose stop
docker run --rm -v hermes_hermes-data:/data -v "$PWD":/backup busybox cp /data/hermes.sqlite /backup/hermes.sqlite.bak
docker compose up -d
```

Reset lokaler Docker-Daten:

```bash
docker compose down -v
```

Wenn `HERMES_S3_RESTORE_MODE=if-missing` gesetzt ist, wird beim nächsten Start wieder aus S3 geladen, sofern dort ein Snapshot existiert.

## Prüfung

```bash
npm test
npm run build
npm audit
```

Der Playwright-Test ist vorbereitet:

```bash
npm run test:e2e
```

Falls Chromium wegen fehlender Systembibliotheken nicht startet, müssen die Playwright OS-Abhängigkeiten auf dem Host installiert werden.
