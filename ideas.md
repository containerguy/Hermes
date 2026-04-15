# Hermes - Planungsstand

Stand: 2026-04-15

## Ziel

Hermes ist eine kleine responsive WebApp fuer eine LAN-Party mit ca. 25 Personen. Das Tool soll schnell klaeren, wer bei einem Spiel mitmachen moechte, wann gestartet wird, ob genug Leute da sind und wie man einem Server beitritt.

Der Fokus liegt auf einfacher Bedienung waehrend der LAN-Party, nicht auf einer oeffentlichen SaaS-Plattform.

## Kernfunktionen

- Login per Telefonnummer, Username und Einmalcode pro Login.
- WebApp, responsive nutzbar auf Smartphone und PC.
- User koennen gleichzeitig auf mehreren Geraeten aktiv sein.
- Alle User koennen bei Spiel-Events abstimmen bzw. Teilnahme signalisieren.
- Manager koennen neue Events anlegen und verwalten.
- Ein Event enthaelt:
  - Spiel
  - gewuenschte Startzeit oder `sofort`
  - minimale Spieleranzahl
  - maximale Spieleranzahl
  - optional: Server-Host
  - optional: Verbindungsinformationen
- Notifications sind pro User aktivierbar/deaktivierbar.
- Standard: Push-Benachrichtigungen auf allen angemeldeten Geraeten.

## Rollen

- User:
  - Login und Logout
  - eigene Geraete verwalten
  - Notifications aktivieren/deaktivieren
  - Events sehen
  - Teilnahme setzen, aendern oder zurueckziehen
- Manager:
  - alle User-Rechte
  - Events anlegen
  - Events bearbeiten
  - Events absagen oder abschliessen
  - optional spaeter: User zu Managern machen

## Annahmen

- Teilnehmerzahl ist klein, daher ist ein einfaches Rollen- und Datenmodell ausreichend.
- Telefonnummern dienen primaer zur Identifikation, nicht zwingend zur SMS-Zustellung.
- Der Einmalcode kann in der ersten Version durch einen Manager oder ueber einen lokalen Admin-Screen erzeugt und ausserhalb der App geteilt werden.
- Echte SMS-Zustellung kann spaeter als Adapter nachgeruestet werden.
- Push Notifications benoetigen HTTPS oder eine passende lokale Entwicklungs-/LAN-Loesung. Fuer den LAN-Betrieb muss frueh entschieden werden, ob Hermes lokal mit HTTPS, ueber eine Domain, ueber Tailscale/Cloudflare Tunnel oder nur als In-App-Realtime-Ansicht laufen soll.
- Die App soll eine PWA werden, damit Smartphone und Desktop dieselbe Oberflaeche nutzen koennen.

## Offene Fragen

- Soll die App nur im LAN laufen oder auch ueber das Internet erreichbar sein?
- Wie werden Manager initial festgelegt: Seed-Datei, Admin-Setup beim ersten Start oder manuell in der Datenbank?
- Soll der Einmalcode per SMS gesendet werden oder reicht fuer die LAN-Party ein manuell geteilter Code?
- Sollen Events nur Teilnahmeoptionen `dabei` und `nicht dabei` haben oder zusaetzlich `vielleicht`?
- Soll es eine Warteliste geben, wenn `maxPlayers` erreicht ist?
- Soll die Startzeit automatisch angepasst werden koennen, wenn zu wenige Spieler zugesagt haben?
- Wie lange bleiben alte Events sichtbar?

## Vorgeschlagener Tech-Stack

- Sprache: TypeScript
- WebApp: Next.js oder Remix
- UI: React mit responsivem CSS
- Datenbank: SQLite fuer lokale LAN-Nutzung, spaeter leicht auf Postgres migrierbar
- ORM: Prisma oder Drizzle
- Auth: eigene Session-Logik mit OTP-Challenges und sicheren Cookies
- Realtime: Server-Sent Events oder WebSocket
- Push: Web Push mit VAPID, pro Geraet gespeicherte Subscriptions
- Tests: Vitest fuer Logik, Playwright fuer Kernflows
- Deployment: Docker Compose fuer den LAN-Host

Begruendung: Fuer 25 Personen ist SQLite plus eine einzelne WebApp-Instanz pragmatisch. Die App bleibt einfach zu betreiben, laesst sich aber spaeter sauber erweitern.

## Grobes Datenmodell

### User

- `id`
- `phoneNumber`
- `username`
- `role` (`user`, `manager`)
- `notificationsEnabled`
- `createdAt`
- `updatedAt`

### LoginChallenge

- `id`
- `phoneNumber`
- `username`
- `codeHash`
- `expiresAt`
- `consumedAt`
- `createdAt`

### Session

- `id`
- `userId`
- `deviceName`
- `userAgent`
- `lastSeenAt`
- `createdAt`
- `revokedAt`

### PushSubscription

- `id`
- `userId`
- `sessionId`
- `endpoint`
- `p256dh`
- `auth`
- `createdAt`
- `revokedAt`

### GameEvent

- `id`
- `gameTitle`
- `startMode` (`now`, `scheduled`)
- `startsAt`
- `minPlayers`
- `maxPlayers`
- `serverHost`
- `connectionInfo`
- `status` (`open`, `ready`, `started`, `cancelled`, `completed`)
- `createdByUserId`
- `createdAt`
- `updatedAt`

### Participation

- `id`
- `eventId`
- `userId`
- `status` (`joined`, `declined`, `maybe`)
- `createdAt`
- `updatedAt`

In Version 1 kann `maybe` weggelassen werden, falls die Abstimmung bewusst binaer bleiben soll.

## Event-Statuslogik

- `open`: Event ist sichtbar und sammelt Teilnahmen.
- `ready`: `minPlayers` ist erreicht.
- `started`: Event wurde gestartet oder liegt in der Vergangenheit und wurde gestartet markiert.
- `cancelled`: Event wurde abgesagt.
- `completed`: Event ist erledigt.

Abgeleitete Anzeige:

- Zu wenige Spieler: `joinedCount < minPlayers`
- Startbereit: `joinedCount >= minPlayers`
- Voll: `joinedCount >= maxPlayers`
- Warteliste optional spaeter, falls mehr Zusagen als Plaetze erlaubt werden sollen.

## Benachrichtigungen

Standardverhalten:

- Neue Events erzeugen Push Notifications an alle User mit aktivierten Notifications.
- Bei `startMode = now` wird die Notification als dringender markiert.
- Wenn ein Event `ready` wird, erhalten Teilnehmer und Manager eine Benachrichtigung.
- Jede aktive Session bzw. jedes registrierte Geraet kann eine eigene Push-Subscription haben.

Fallback:

- Wenn Push nicht verfuegbar ist, zeigt die App neue Events per Realtime-Update und sichtbarem Hinweis an.

## Arbeitspakete

### AP 0 - Repository und Projektgrundlage

Ziel: Saubere Basis fuer nachvollziehbare Entwicklung.

Aufgaben:

- Git-Repo initialisieren.
- `ideas.md` als Planungsstand anlegen.
- Grundlegende `.gitignore` anlegen.
- Spaeter: README mit Start- und Betriebsanleitung ergaenzen.

Akzeptanzkriterien:

- Repo existiert.
- Planung liegt versioniert vor.
- Lokale Secrets und Build-Artefakte werden ignoriert.

Status: abgeschlossen.

### AP 1 - App-Grundgeruest

Ziel: Lauffaehige responsive WebApp als Basis.

Aufgaben:

- Framework auswaehlen und initialisieren.
- Basislayout fuer Smartphone und Desktop erstellen.
- Navigation fuer Login, Eventliste, Eventdetails und Managerbereich vorbereiten.
- PWA-Grundlagen vorbereiten: Manifest, Icons, Service Worker Platzhalter.

Akzeptanzkriterien:

- App startet lokal.
- Layout funktioniert auf Smartphone- und Desktop-Breiten.
- Erste leere Seiten sind erreichbar.

Status: offen.

### AP 2 - Datenbank und Domainmodell

Ziel: Persistente Grundlage fuer User, Sessions, Events und Teilnahmen.

Aufgaben:

- ORM und SQLite einrichten.
- Migrationen fuer User, LoginChallenge, Session, PushSubscription, GameEvent und Participation erstellen.
- Seed-Mechanismus fuer initiale Manager definieren.
- Validierungsregeln fuer min/max Spieler und Startzeit implementieren.

Akzeptanzkriterien:

- Migrationen laufen reproduzierbar.
- Ein initialer Manager kann angelegt werden.
- Datenmodell verhindert offensichtliche ungueltige Events.

Status: offen.

### AP 3 - Login mit Telefonnummer, Username und Einmalcode

Ziel: Einfacher, sicherer Login fuer mehrere Geraete pro User.

Aufgaben:

- LoginChallenge erzeugen.
- Code nur gehasht speichern.
- Ablaufzeit und einmalige Nutzung durchsetzen.
- Session-Cookie erstellen.
- Mehrere parallele Sessions pro User erlauben.
- Logout fuer aktuelles Geraet implementieren.

Akzeptanzkriterien:

- User kann sich mit Telefonnummer, Username und gueltigem Code einloggen.
- Derselbe User kann parallel am Smartphone und PC eingeloggt sein.
- Verbrauchte oder abgelaufene Codes funktionieren nicht mehr.

Status: offen.

### AP 4 - Rollen und Manager-Rechte

Ziel: Manager koennen Events verwalten, User nur teilnehmen.

Aufgaben:

- Role Guard fuer Manageraktionen einbauen.
- Managerbereich fuer Event-Erstellung vorbereiten.
- Serverseitige Rechtepruefungen fuer alle Schreibaktionen implementieren.

Akzeptanzkriterien:

- Nicht-Manager koennen keine Events erstellen oder bearbeiten.
- Manager koennen Eventformulare oeffnen und absenden.
- Rechte werden serverseitig erzwungen, nicht nur im UI versteckt.

Status: offen.

### AP 5 - Events erstellen und anzeigen

Ziel: Manager koennen Spielabstimmungen erfassen, User sehen sie direkt.

Aufgaben:

- Eventformular mit Spiel, Startzeit/sofort, min/max Spieler, Server-Host und Verbindungsinfo bauen.
- Eventliste mit Status, Spielerzahl und Startzeit bauen.
- Eventdetailseite mit Teilnehmern und Verbindungsinfo bauen.
- Bearbeiten, Absagen und Abschliessen fuer Manager ergaenzen.

Akzeptanzkriterien:

- Manager kann ein gueltiges Event erstellen.
- Alle User sehen neue Events.
- Ungueltige Angaben werden klar abgewiesen.

Status: offen.

### AP 6 - Teilnahme-Abstimmung

Ziel: User koennen schnell signalisieren, ob sie teilnehmen.

Aufgaben:

- Teilnahme setzen, aendern und entfernen.
- Spielerzaehlung aus Teilnahmen ableiten.
- Maximalspieler-Regel behandeln.
- Optional: `maybe` und Warteliste entscheiden und implementieren.

Akzeptanzkriterien:

- User kann fuer jedes offene Event seinen Status setzen.
- Spielerzahlen aktualisieren sich korrekt.
- Bei voller Runde ist das Verhalten eindeutig.

Status: offen.

### AP 7 - Realtime-Aktualisierung

Ziel: Eventstatus und Teilnahmen aktualisieren sich ohne manuelles Neuladen.

Aufgaben:

- Realtime-Kanal per SSE oder WebSocket einrichten.
- Eventliste bei neuen Events und Teilnahmen aktualisieren.
- Verbindungsstatus im UI anzeigen.
- Fallback auf Polling definieren, falls Realtime getrennt ist.

Akzeptanzkriterien:

- Zwei Browser sehen Teilnahmeaenderungen zeitnah.
- Verbindungsabbrueche fuehren nicht zu kaputtem UI.

Status: offen.

### AP 8 - Push Notifications pro User und Geraet

Ziel: User erhalten standardmaessig Push auf allen angemeldeten Geraeten.

Aufgaben:

- Service Worker und Push Subscription registrieren.
- Subscriptions pro Session/Geraet speichern.
- User-Toggle fuer Notifications bauen.
- Default-Verhalten bei erstem Login definieren.
- Push bei neuen Events und Statuswechseln versenden.
- Fehlerhafte Subscriptions automatisch deaktivieren.

Akzeptanzkriterien:

- Ein User mit zwei Geraeten kann auf beiden Push erhalten.
- Deaktiviert der User Notifications, werden keine Pushes mehr gesendet.
- Ohne Browser-Permission bleibt die App nutzbar.

Status: offen.

### AP 9 - UX fuer LAN-Betrieb

Ziel: Die App ist waehrend der LAN-Party schnell und robust nutzbar.

Aufgaben:

- Mobile-first Eventliste optimieren.
- Klare Hervorhebung fuer `sofort`, `ready` und `voll`.
- Schnelle Teilnahmebuttons auf Listen- und Detailansicht.
- Manageraktionen kompakt, aber nicht versehentlich ausloesbar gestalten.
- Leere Zustaende und Fehlermeldungen formulieren.

Akzeptanzkriterien:

- Wichtige Aktionen sind mit wenigen Klicks erreichbar.
- Die Oberflaeche bleibt auf kleinen Displays lesbar.
- Kritische Aktionen wie Absagen brauchen eine Bestaetigung.

Status: offen.

### AP 10 - Tests und Qualitaet

Ziel: Kernablaeufe bleiben stabil.

Aufgaben:

- Unit-Tests fuer Eventvalidierung, Statuslogik und OTP-Logik.
- Integrationstests fuer Login, Eventanlage und Teilnahme.
- Playwright-Tests fuer Manager erstellt Event und User tritt bei.
- Security-Checks fuer Sessions, Rollen und OTP-Verbrauch.

Akzeptanzkriterien:

- Kritische Logik ist automatisiert getestet.
- Kernflow laeuft in einem Browser-Test.
- Tests koennen lokal reproduzierbar gestartet werden.

Status: offen.

### AP 11 - Deployment und Betrieb

Ziel: Hermes kann auf einem LAN-Host verlaesslich gestartet werden.

Aufgaben:

- Dockerfile und Docker Compose erstellen.
- Persistenten Datenbankpfad konfigurieren.
- `.env.example` fuer Secrets und VAPID Keys anlegen.
- Backup- und Reset-Anleitung dokumentieren.
- HTTPS-/Domain-Variante fuer Push Notifications klaeren.

Akzeptanzkriterien:

- App startet per Docker Compose.
- Daten bleiben nach Neustart erhalten.
- Betriebsanleitung beschreibt Start, Stop, Backup und Reset.

Status: offen.

## Vorgeschlagene Reihenfolge

1. AP 0 abschliessen.
2. AP 1 App-Grundgeruest.
3. AP 2 Datenbank und Domainmodell.
4. AP 3 Login und Sessions.
5. AP 4 Rollen.
6. AP 5 Events.
7. AP 6 Teilnahme.
8. AP 7 Realtime.
9. AP 8 Push Notifications.
10. AP 9 UX-Feinschliff.
11. AP 10 Tests.
12. AP 11 Deployment.

## Entscheidungslog

- 2026-04-15: Projektname ist Hermes.
- 2026-04-15: Planung wird in `ideas.md` gepflegt.
- 2026-04-15: Repository wird als eigenes Git-Repo unter `/home/eluminare/Hermes` initialisiert.
- 2026-04-15: Erste Architekturannahme ist eine TypeScript WebApp mit SQLite, PWA und Web Push.

## Naechster sinnvoller Schritt

AP 1 starten: Framework final auswaehlen und ein lauffaehiges App-Grundgeruest erzeugen. Vorher sollten die offenen Fragen zu SMS-Zustellung, LAN/Internet-Erreichbarkeit und initialen Managern beantwortet werden, weil sie Auth, Push und Deployment beeinflussen.
