# Hermes - Planungsstand

Stand: 2026-04-15

## Ziel

Hermes ist eine kleine responsive WebApp fuer eine LAN-Party mit ca. 25 Personen. Das Tool soll schnell klaeren, wer bei einem Spiel mitmachen moechte, wann gestartet wird, ob genug Leute da sind und wie man einem Server beitritt.

Der Fokus liegt auf einfacher Bedienung waehrend der LAN-Party, nicht auf einer oeffentlichen SaaS-Plattform.

## Kernfunktionen

- Login per Telefonnummer, Username und Einmalcode pro Login.
- Der Einmalcode wird per E-Mail an die beim User gespeicherte Adresse gesendet.
- WebApp, responsive nutzbar auf Smartphone und PC.
- User koennen gleichzeitig auf mehreren Geraeten aktiv sein.
- Alle User koennen bei Spiel-Events abstimmen bzw. Teilnahme signalisieren.
- Manager koennen neue Events anlegen und verwalten.
- Der Haupt-Admin verwaltet User, Manager und globale Einstellungen.
- Einstellungen muessen dauerhaft gespeichert werden.
- Ein Event enthaelt:
  - Spiel
  - gewuenschte Startzeit oder `sofort`
  - minimale Spieleranzahl
  - maximale Spieleranzahl
  - optional: Server-Host
  - optional: Verbindungsinformationen
- Die Startzeit eines Events kann nachtraeglich angepasst werden.
- Alte Events wechseln nach Start automatisch in `laeuft bereits` und werden 8 Stunden nach Start automatisch archiviert.
- Notifications sind pro User aktivierbar/deaktivierbar.
- Standard: Push-Benachrichtigungen auf allen angemeldeten Geraeten.

## Rollen

- User:
  - Login und Logout
  - eigene Geraete verwalten
  - Notifications aktivieren/deaktivieren
  - Events sehen
  - Teilnahme auf `dabei` oder `nicht dabei` setzen
- Manager:
  - alle User-Rechte
  - Events anlegen
  - Events bearbeiten
  - eigene Events archivieren oder stornieren
  - fremde Events archivieren oder stornieren
- Admin:
  - alle Manager-Rechte
  - User verwalten
  - Manager festlegen oder entziehen
  - globale Einstellungen speichern

## Annahmen

- Teilnehmerzahl ist klein, daher ist ein einfaches Rollen- und Datenmodell ausreichend.
- Telefonnummern dienen primaer zur Identifikation.
- E-Mail-Adressen werden fuer Login-Codes benoetigt und muessen pro User gespeichert werden.
- Der Haupt-Admin wird beim ersten Start oder per Bootstrap-Konfiguration angelegt.
- Mailversand erfolgt ueber SMTP-Konfiguration. Ein lokaler Mailserver oder ein kostenloser SMTP-Anbieter kann genutzt werden.
- Hermes wird als fertiges Docker Image bereitgestellt. Docker Compose kann fuer lokale Persistenz und Konfiguration ergaenzt werden.
- SSL/TLS, Reverse Proxy, Domain-Handling und Zertifikatsverwaltung sind out of scope.
- Push Notifications benoetigen browserseitig trotzdem eine passende Secure-Context-Umgebung. Hermes liefert die App-Funktionalitaet, aber kein SSL-Setup.
- Die App soll eine PWA werden, damit Smartphone und Desktop dieselbe Oberflaeche nutzen koennen.
- Es gibt keine Warteliste.
- Teilnahmeoptionen sind nur `dabei` und `nicht dabei`.

## Beantwortete Produktentscheidungen

- Auslieferung: Docker Image ist Pflicht. Mehrere Images sind erlaubt, falls technisch sinnvoll.
- SSL Handling ist out of scope.
- Manager werden durch den Haupt-Admin definiert.
- Einstellungen muessen in der Anwendung gespeichert werden koennen.
- Einmalcodes werden per E-Mail versendet.
- Teilnahmeoptionen: nur `dabei` und `nicht dabei`.
- Keine Warteliste.
- Startzeiten koennen angepasst werden.
- Events wechseln nach Start in `laeuft bereits`.
- Events werden 8 Stunden nach Start automatisch archiviert.
- Event-Ersteller, Manager und Admin koennen Events manuell archivieren oder stornieren.

## Noch technische Entscheidungen

- SMTP-Provider und konkrete Mail-Absenderadresse fuer den Betrieb festlegen.
- Entscheiden, ob Realtime per Server-Sent Events oder WebSocket umgesetzt wird.

## Vorgeschlagener Tech-Stack

- Sprache: TypeScript
- WebApp: React/Vite mit spaeterem Express-Backend im selben Docker Image
- UI: React mit responsivem CSS
- Datenbank: SQLite fuer lokale LAN-Nutzung, spaeter leicht auf Postgres migrierbar
- ORM: Drizzle mit expliziten SQL-Migrationen
- Auth: eigene Session-Logik mit OTP-Challenges und sicheren Cookies
- Mail: SMTP-Adapter fuer Einmalcodes
- Realtime: Server-Sent Events oder WebSocket
- Push: Web Push mit VAPID, pro Geraet gespeicherte Subscriptions
- Tests: Vitest fuer Logik, Playwright fuer Kernflows
- Deployment: fertiges Docker Image, optional Docker Compose fuer Persistenz und Konfiguration

Begruendung: Fuer 25 Personen ist SQLite plus eine einzelne WebApp-Instanz pragmatisch. Die App bleibt einfach zu betreiben, laesst sich aber spaeter sauber erweitern. Ein einzelnes Docker Image ist voraussichtlich ausreichend; ein zusaetzlicher Container ist nur noetig, wenn ein eigener Mail-Relay oder eine separate Datenbank gewuenscht wird.

## Grobes Datenmodell

### User

- `id`
- `phoneNumber`
- `username`
- `email`
- `role` (`user`, `manager`, `admin`)
- `notificationsEnabled`
- `createdByUserId`
- `createdAt`
- `updatedAt`

### LoginChallenge

- `id`
- `phoneNumber`
- `username`
- `email`
- `codeHash`
- `expiresAt`
- `consumedAt`
- `sentAt`
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
- `status` (`open`, `ready`, `running`, `cancelled`, `archived`)
- `createdByUserId`
- `cancelledByUserId`
- `archivedByUserId`
- `cancelledAt`
- `archivedAt`
- `createdAt`
- `updatedAt`

### Participation

- `id`
- `eventId`
- `userId`
- `status` (`joined`, `declined`)
- `createdAt`
- `updatedAt`

### AppSetting

- `key`
- `value`
- `updatedByUserId`
- `updatedAt`

Settings koennen SMTP-Konfiguration, App-Name, Default-Notification-Verhalten und spaeter weitere Betriebsoptionen abbilden. Secrets sollten bevorzugt ueber Umgebungsvariablen kommen; in der Datenbank gespeicherte Einstellungen duerfen keine unnoetigen Klartext-Secrets enthalten.

## Event-Statuslogik

- `open`: Event ist sichtbar und sammelt Teilnahmen.
- `ready`: `minPlayers` ist erreicht.
- `running`: Die Startzeit ist erreicht oder ueberschritten. In der UI heisst dieser Status `laeuft bereits`.
- `cancelled`: Event wurde abgesagt.
- `archived`: Event ist nicht mehr aktiv sichtbar.

Abgeleitete Anzeige:

- Zu wenige Spieler: `joinedCount < minPlayers`
- Startbereit: `joinedCount >= minPlayers`
- Voll: `joinedCount >= maxPlayers`
- Keine Warteliste: Wenn `maxPlayers` erreicht ist, koennen keine weiteren User auf `dabei` wechseln.
- Automatische Archivierung: `startsAt + 8 Stunden`, sofern das Event nicht vorher storniert oder manuell archiviert wurde.

Manuelle Aktionen:

- Event-Ersteller koennen eigene Events archivieren oder stornieren.
- Manager koennen alle Events archivieren oder stornieren.
- Admins koennen alle Events archivieren oder stornieren.
- Startzeiten koennen von berechtigten Usern angepasst werden, solange das Event nicht archiviert oder storniert ist.

## Benachrichtigungen

Standardverhalten:

- Neue Events erzeugen Push Notifications an alle User mit aktivierten Notifications.
- Bei `startMode = now` wird die Notification als dringender markiert.
- Wenn ein Event `ready` wird, erhalten Teilnehmer und Manager eine Benachrichtigung.
- Jede aktive Session bzw. jedes registrierte Geraet kann eine eigene Push-Subscription haben.
- Login-Codes werden per E-Mail versendet.
- Mailversand-Fehler werden sichtbar protokolliert und im Adminbereich diagnostizierbar gemacht.

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
- Navigation fuer Login, Eventliste, Eventdetails, Managerbereich und Adminbereich vorbereiten.
- PWA-Grundlagen vorbereiten: Manifest, Icons, Service Worker Platzhalter.

Akzeptanzkriterien:

- App startet lokal.
- Layout funktioniert auf Smartphone- und Desktop-Breiten.
- Erste leere Seiten fuer User, Manager und Admin sind erreichbar.

Paketpruefung:

- Funktional: Build laeuft, Preview liefert HTML, Manifest und Service Worker aus.
- Produktziel: User-, Manager- und Adminbereiche sind als navigierbare Einstiegspunkte vorbereitet.
- Release-Relevanz: Legt eine kleine, Docker-taugliche Frontend-Basis ohne unnoetige Infrastruktur fest.

Status: abgeschlossen.

### AP 2 - Datenbank und Domainmodell

Ziel: Persistente Grundlage fuer User, Sessions, Events und Teilnahmen.

Aufgaben:

- ORM und SQLite einrichten.
- Migrationen fuer User, LoginChallenge, Session, PushSubscription, GameEvent, Participation und AppSetting erstellen.
- Bootstrap-Mechanismus fuer den ersten Admin definieren.
- Validierungsregeln fuer min/max Spieler, Startzeit und Startzeit-Aenderungen implementieren.
- Eventstatus `running`, `cancelled` und `archived` abbilden.

Akzeptanzkriterien:

- Migrationen laufen reproduzierbar.
- Ein initialer Admin kann angelegt werden.
- Datenmodell verhindert offensichtliche ungueltige Events.
- Teilnahme kennt nur `joined` und `declined`.
- Settings koennen persistent gespeichert werden.

Paketpruefung:

- Funktional: Migrationen laufen gegen SQLite, Admin-Bootstrap erzeugt einen Admin und Default-Settings.
- Produktziel: Rollen, Settings, Events, Teilnahme, Sessions und Push-Subscriptions sind im Datenmodell abgebildet.
- Release-Relevanz: SQLite bleibt Docker-freundlich und der erste Admin kann reproduzierbar per Umgebungsvariablen bereitgestellt werden.

Status: abgeschlossen.

### AP 3 - Login mit Telefonnummer, Username und E-Mail-Einmalcode

Ziel: Einfacher, sicherer Login fuer mehrere Geraete pro User.

Aufgaben:

- LoginChallenge erzeugen.
- Einmalcode per SMTP an die gespeicherte E-Mail-Adresse senden.
- Code nur gehasht speichern.
- Ablaufzeit und einmalige Nutzung durchsetzen.
- Mailversand-Fehler behandeln und protokollieren.
- Session-Cookie erstellen.
- Mehrere parallele Sessions pro User erlauben.
- Logout fuer aktuelles Geraet implementieren.

Akzeptanzkriterien:

- User kann mit Telefonnummer, Username und per E-Mail erhaltenem gueltigem Code einloggen.
- Derselbe User kann parallel am Smartphone und PC eingeloggt sein.
- Verbrauchte oder abgelaufene Codes funktionieren nicht mehr.
- Ohne funktionierende SMTP-Konfiguration ist der Fehler fuer Admins klar erkennbar.

Paketpruefung:

- Funktional: HTTP-Flow fuer Code-Anforderung, Code-Verifikation, Session-Cookie, `/me` und Logout ist lauffaehig.
- Produktziel: Login nutzt Telefonnummer und Username, sendet den Code ueber Mail-Adapter und erlaubt parallele Sessions.
- Release-Relevanz: Der Flow funktioniert mit SMTP-Konfiguration und besitzt einen Console-Modus fuer lokale Tests und Docker-Diagnose.

Status: abgeschlossen.

### AP 4 - Admin, Einstellungen und Rollen

Ziel: Admin verwaltet Manager und Einstellungen; Manager koennen Events verwalten, User nur teilnehmen.

Aufgaben:

- Role Guard fuer User-, Manager- und Adminaktionen einbauen.
- Adminbereich fuer Userverwaltung und Managerzuweisung bauen.
- Settingsbereich fuer globale Einstellungen bauen.
- Managerbereich fuer Event-Erstellung vorbereiten.
- Serverseitige Rechtepruefungen fuer alle Schreibaktionen implementieren.

Akzeptanzkriterien:

- Nicht-Manager koennen keine Events erstellen oder bearbeiten.
- Manager koennen keine Admin-Einstellungen veraendern und keine Rollen vergeben.
- Admin kann User zu Managern machen oder Managerrechte entziehen.
- Einstellungen bleiben nach Neustart erhalten.
- Manager koennen Eventformulare oeffnen und absenden.
- Rechte werden serverseitig erzwungen, nicht nur im UI versteckt.

Paketpruefung:

- Funktional: Admin kann User anlegen, Rollen aendern und Settings speichern; Nicht-Admins erhalten 403.
- Produktziel: Haupt-Admin kann Manager definieren und globale Einstellungen persistent pflegen.
- Release-Relevanz: Rollen- und Settings-API schafft die Grundlage fuer Eventrechte, Notifications und Auto-Archivierung.

Status: abgeschlossen.

### AP 5 - Events erstellen und anzeigen

Ziel: Manager koennen Spielabstimmungen erfassen, User sehen sie direkt.

Aufgaben:

- Eventformular mit Spiel, Startzeit/sofort, min/max Spieler, Server-Host und Verbindungsinfo bauen.
- Eventliste mit Status, Spielerzahl und Startzeit bauen.
- Eventdetailseite mit Teilnehmern und Verbindungsinfo bauen.
- Startzeit-Aenderung fuer berechtigte User ergaenzen.
- Archivieren und Stornieren fuer Event-Ersteller, Manager und Admin ergaenzen.
- Statusanzeige `laeuft bereits` fuer gestartete Events ergaenzen.

Akzeptanzkriterien:

- Manager kann ein gueltiges Event erstellen.
- Alle User sehen neue Events.
- Berechtigte User koennen die Startzeit anpassen.
- Events zeigen nach erreichter Startzeit `laeuft bereits`.
- Event-Ersteller, Manager und Admin koennen Events archivieren oder stornieren.
- Ungueltige Angaben werden klar abgewiesen.

Paketpruefung:

- Funktional: Manager koennen Events anlegen, listen, Startzeiten aendern, stornieren und archivieren; normale User koennen keine Events anlegen.
- Produktziel: Spiel, Startzeit/sofort, min/max Spieler, Server und Verbindung sind abgebildet und fuer eingeloggte User sichtbar.
- Release-Relevanz: `laeuft bereits` und automatische Archivierung nach 8 Stunden sind serverseitig verankert.

Status: abgeschlossen.

### AP 6 - Teilnahme-Abstimmung

Ziel: User koennen schnell signalisieren, ob sie teilnehmen.

Aufgaben:

- Teilnahme auf `dabei` oder `nicht dabei` setzen und aendern.
- Spielerzaehlung aus Teilnahmen ableiten.
- Maximalspieler-Regel behandeln.
- Keine Warteliste implementieren.

Akzeptanzkriterien:

- User kann fuer jedes offene Event `dabei` oder `nicht dabei` setzen.
- Spielerzahlen aktualisieren sich korrekt.
- Wenn `maxPlayers` erreicht ist, koennen keine weiteren User auf `dabei` wechseln.

Paketpruefung:

- Funktional: User koennen `dabei` und `nicht dabei` setzen; Zaehler und Eventstatus wechseln korrekt.
- Produktziel: Die Abstimmung ist bewusst binaer und verzichtet auf Warteliste.
- Release-Relevanz: Die Maximalspieler-Regel wird serverseitig erzwungen und verhindert ueberfuellte Runden.

Status: abgeschlossen.

### AP 7 - Realtime-Aktualisierung

Ziel: Eventstatus und Teilnahmen aktualisieren sich ohne manuelles Neuladen.

Aufgaben:

- Realtime-Kanal per SSE oder WebSocket einrichten.
- Eventliste bei neuen Events und Teilnahmen aktualisieren.
- Eventstatus bei Startzeit-Aenderungen, `laeuft bereits`, Archivierung und Stornierung aktualisieren.
- Verbindungsstatus im UI anzeigen.
- Fallback auf Polling definieren, falls Realtime getrennt ist.

Akzeptanzkriterien:

- Zwei Browser sehen Teilnahmeaenderungen zeitnah.
- Zwei Browser sehen Status- und Startzeit-Aenderungen zeitnah.
- Verbindungsabbrueche fuehren nicht zu kaputtem UI.

Paketpruefung:

- Funktional: SSE-Client erhaelt `events_changed`; UI verbindet per EventSource und pollt als Fallback.
- Produktziel: Neue Events, Teilnahme- und Statusaenderungen koennen ohne manuelles Neuladen sichtbar werden.
- Release-Relevanz: Server refresh’t zeitbasierte Statuswechsel regelmaessig und broadcastet Aenderungen.

Status: abgeschlossen.

### AP 8 - Push Notifications pro User und Geraet

Ziel: User erhalten standardmaessig Push auf allen angemeldeten Geraeten.

Aufgaben:

- Service Worker und Push Subscription registrieren.
- Subscriptions pro Session/Geraet speichern.
- User-Toggle fuer Notifications bauen.
- Default-Verhalten bei erstem Login definieren.
- Push bei neuen Events und Statuswechseln versenden.
- Secure-Context-Einschraenkung dokumentieren, ohne SSL in Hermes selbst einzubauen.
- Fehlerhafte Subscriptions automatisch deaktivieren.

Akzeptanzkriterien:

- Ein User mit zwei Geraeten kann auf beiden Push erhalten.
- Deaktiviert der User Notifications, werden keine Pushes mehr gesendet.
- Ohne Browser-Permission bleibt die App nutzbar.
- Docker Image enthaelt keine eigene SSL-/Reverse-Proxy-Logik.

Paketpruefung:

- Funktional: VAPID Public Key, Subscription-Speicherung pro Session und User-Toggle funktionieren per API.
- Produktziel: Push ist pro User deaktivierbar; Subscriptions sind geraetebezogen und neue Events/Statuswechsel triggern Versandversuche.
- Release-Relevanz: Fehlende VAPID-Konfiguration fuehrt zu sichtbarem Skip statt kaputtem Eventflow; SSL bleibt out of scope.

Status: abgeschlossen.

### AP 9 - UX fuer LAN-Betrieb

Ziel: Die App ist waehrend der LAN-Party schnell und robust nutzbar.

Aufgaben:

- Mobile-first Eventliste optimieren.
- Klare Hervorhebung fuer `sofort`, `ready`, `laeuft bereits`, `voll`, `archiviert` und `storniert`.
- Schnelle Teilnahmebuttons auf Listen- und Detailansicht.
- Manageraktionen kompakt, aber nicht versehentlich ausloesbar gestalten.
- Admin- und Settingsseiten schlicht und eindeutig gestalten.
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
- Tests fuer Admin verwaltet Manager und speichert Settings.
- Tests fuer automatische Umstellung auf `running` und Archivierung nach 8 Stunden.
- Tests fuer manuelle Archivierung/Stornierung durch Ersteller, Manager und Admin.
- Tests fuer Mail-OTP-Versand mit mockbarem SMTP-Adapter.
- Security-Checks fuer Sessions, Rollen und OTP-Verbrauch.

Akzeptanzkriterien:

- Kritische Logik ist automatisiert getestet.
- Kernflow laeuft in einem Browser-Test.
- Tests koennen lokal reproduzierbar gestartet werden.

Status: offen.

### AP 11 - Deployment und Betrieb

Ziel: Hermes kann auf einem LAN-Host verlaesslich gestartet werden.

Aufgaben:

- Produktionsfaehiges Dockerfile erstellen.
- Docker Compose fuer lokale Persistenz und einfache Konfiguration erstellen.
- Persistenten Datenbankpfad konfigurieren.
- `.env.example` fuer Session-Secrets, Admin-Bootstrap, SMTP und VAPID Keys anlegen.
- Backup- und Reset-Anleitung dokumentieren.
- Image-Build dokumentieren.
- SSL/TLS und Reverse Proxy explizit als out of scope dokumentieren.
- Optional: Healthcheck fuer Container bereitstellen.

Akzeptanzkriterien:

- Docker Image kann reproduzierbar gebaut werden.
- App startet per Docker Compose.
- Daten bleiben nach Neustart erhalten.
- Betriebsanleitung beschreibt Start, Stop, Backup und Reset.
- Betriebsanleitung beschreibt benoetigte SMTP- und Push-Konfiguration.
- Keine Produktanforderung haengt von einem mitgelieferten SSL-Container ab.

Status: offen.

## Vorgeschlagene Reihenfolge

1. AP 0 ist abgeschlossen.
2. AP 1 App-Grundgeruest.
3. AP 2 Datenbank und Domainmodell.
4. AP 3 Login mit E-Mail-Einmalcode und Sessions.
5. AP 4 Admin, Einstellungen und Rollen.
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
- 2026-04-15: AP 1 legt React/Vite als Frontend-Grundlage fest; das Backend soll spaeter als Express-Server im selben Image laufen.
- 2026-04-15: AP 2 legt Drizzle mit expliziten SQL-Migrationen als Datenzugriff fest.
- 2026-04-15: Der erste Admin wird per Bootstrap-Umgebungsvariablen erzeugt oder aktualisiert.
- 2026-04-15: AP 3 implementiert E-Mail-Einmalcodes, Session-Cookies, Logout und parallele Sessions.
- 2026-04-15: AP 4 implementiert Admin-Userverwaltung, Rollenpflege und persistente Settings.
- 2026-04-15: AP 5 implementiert Eventanlage, Eventliste, Startzeit-Aenderung, Stornieren, Archivieren und Auto-Archivierung.
- 2026-04-15: AP 6 implementiert Teilnahme mit `dabei`/`nicht dabei` und serverseitiger Maximalspieler-Regel.
- 2026-04-15: AP 7 implementiert Server-Sent Events mit Polling-Fallback und Status-Refresh.
- 2026-04-15: AP 8 implementiert Web Push mit VAPID, geraetebezogenen Subscriptions und User-Praeferenz.
- 2026-04-15: Hermes wird als Docker Image ausgeliefert; SSL/TLS, Reverse Proxy und Domain-Handling sind out of scope.
- 2026-04-15: Manager werden durch den Haupt-Admin definiert; globale Einstellungen werden persistent gespeichert.
- 2026-04-15: Login-Einmalcodes werden per E-Mail versendet.
- 2026-04-15: Teilnahmeoptionen sind nur `dabei` und `nicht dabei`; es gibt keine Warteliste.
- 2026-04-15: Startzeiten koennen angepasst werden.
- 2026-04-15: Events gehen nach Start in `laeuft bereits` und werden 8 Stunden nach Start automatisch archiviert.
- 2026-04-15: Event-Ersteller, Manager und Admin koennen Events manuell archivieren oder stornieren.

## Naechster sinnvoller Schritt

AP 1 starten: Framework final auswaehlen und ein lauffaehiges App-Grundgeruest erzeugen. Danach sollten AP 2 und AP 3 frueh die Admin-Bootstrap-, Settings- und SMTP-Grundlagen schaffen, weil diese Auth, Rollen und Betrieb beeinflussen.
