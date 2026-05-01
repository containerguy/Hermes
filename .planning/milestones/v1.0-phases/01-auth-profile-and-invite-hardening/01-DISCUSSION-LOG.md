# Phase 1: Auth, Profile, And Invite Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 1 - Auth, Profile, And Invite Hardening
**Areas discussed:** Auth-Schutz, Profil und E-Mail, Invite-Lifecycle, Session und Audit-Sicherheit

---

## Auth-Schutz

| Option | Description | Selected |
|--------|-------------|----------|
| Immer gleich | Antwortet immer mit Erfolgstext wie 'Falls der User existiert, wurde ein Code gesendet'; verhindert User-Enumeration. | |
| UI gleich, Audit intern | Nutzer sieht generisch Erfolg, Admin-Audit bekommt zusätzlich einen redaktionierten Hinweis auf unbekannte Loginversuche. | ✓ |
| Fehler anzeigen | Zeigt weiterhin 'User nicht gefunden'; einfacher für kleine Gruppen, aber sichtbar enumerierbar. | |

**User's choice:** UI gleich, Audit intern
**Notes:** Extern keine User-Enumeration; intern sollen Admins verdächtige unbekannte Loginversuche nachvollziehen können.

| Option | Description | Selected |
|--------|-------------|----------|
| Moderat | Mehrere legitime Versuche bleiben möglich; wiederholte Versuche pro Username und IP werden zeitweise gebremst. | ✓ |
| Streng | Wenige Fehlversuche führen schnell zu Sperrfenstern; sicherer, aber störanfälliger bei LAN-Setup-Problemen. | |
| Nur minimal | Nur grobe Abuse-Bremse ohne spürbare Sperrwirkung; komfortabler, aber schwächer. | |

**User's choice:** Moderat, plus Admins sollen geblockte IPs freigeben und whitelisten dürfen.
**Notes:** Admins brauchen während der LAN ein kleines Operationswerkzeug für aktive Blocks und Whitelist.

| Option | Description | Selected |
|--------|-------------|----------|
| Klar mit Wartezeit | Zeigt eine verständliche Meldung wie 'Bitte in X Minuten erneut versuchen', ohne sicherheitsrelevante Details. | ✓ |
| Sehr generisch | Zeigt nur 'Versuche es später erneut'; weniger Information, aber schlechtere Bedienbarkeit. | |
| Admin kontaktieren | Verweist direkt auf Admin/Manager; passend, wenn Sperren selten und manuell gelöst werden sollen. | |

**User's choice:** Klar mit Wartezeit
**Notes:** Nutzer sollen verstehen, wann sie es erneut versuchen können.

| Option | Description | Selected |
|--------|-------------|----------|
| Blockliste + Whitelist | Admin sieht aktive IP-/Username-Sperren, kann sie löschen und IPs whitelisten. | ✓ |
| Nur Blockliste | Admin kann Sperren sehen und lösen, aber keine dauerhafte Whitelist pflegen. | |
| Konfig-Datei | Whitelist nur über Env/Config, keine Admin-UI. | |

**User's choice:** Blockliste + Whitelist
**Notes:** Whitelist soll per Adminbereich bedienbar sein.

| Option | Description | Selected |
|--------|-------------|----------|
| Nur neuester gültig | Jede neue Code-Anforderung invalidiert ältere offene Codes. | ✓ |
| Alle bis Ablauf gültig | Nutzer können mehrere aktive Codes in Mails haben. | |
| Keine neue Mail | Wenn ein Code offen ist, wird keine neue Mail versendet. | |

**User's choice:** Nur neuester gültig
**Notes:** Weniger Verwirrung und geringere Angriffsfläche.

---

## Profil und E-Mail

| Option | Description | Selected |
|--------|-------------|----------|
| Username ändern | Bestehender Username ist Login-Name und Anzeigename. | |
| Displayname zusätzlich | Login-Username bleibt stabil, zusätzlich kommt ein frei änderbarer Anzeigename dazu. | ✓ |
| Nur Admin ändert | Nutzer sehen ihren Namen, aber nur Admins ändern Namen. | |

**User's choice:** Displayname zusätzlich
**Notes:** Username bleibt eindeutiger Login-Identifier.

| Option | Description | Selected |
|--------|-------------|----------|
| Code an neue Mail | Neue E-Mail wird erst nach Code-Bestätigung aktiv. | ✓ |
| Code an alt und neu | Sicherer bei Account-Übernahme, aber aufwendiger. | |
| Sofort ändern | Einfachste UX, aber riskanter. | |

**User's choice:** Code an neue Mail
**Notes:** Bis zur Bestätigung bleibt die alte E-Mail aktiv.

| Option | Description | Selected |
|--------|-------------|----------|
| Aus Browserdaten | Automatisch aus User-Agent grob ableiten; Nutzer kann überschreiben. | ✓ |
| Pflichtfeld | Nutzer muss einen Gerätenamen eingeben. | |
| Einfacher Fallback | Ohne Eingabe nur 'Neues Gerät'. | |

**User's choice:** Aus Browserdaten
**Notes:** Gewünscht sind sinnvolle Labels wie Windows-PC, iPhone oder Android-Smartphone.

| Option | Description | Selected |
|--------|-------------|----------|
| Nicht unique | Mehrere Nutzer dürfen denselben Anzeigenamen haben. | ✓ |
| Unique | Displayname muss eindeutig sein. | |
| Nur optional | Wenn leer, wird nur Username angezeigt. | |

**User's choice:** Nicht unique
**Notes:** Login-Eindeutigkeit bleibt beim Username.

| Option | Description | Selected |
|--------|-------------|----------|
| Alte bis bestätigt | Login bleibt stabil bis neue E-Mail bestätigt ist. | ✓ |
| Neue sofort | Neue Adresse bekommt sofort Login-Codes. | |
| Beide temporär | Alt und neu funktionieren während der Bestätigung. | |

**User's choice:** Alte bis bestätigt
**Notes:** Verhindert Lockout durch Tippfehler.

| Option | Description | Selected |
|--------|-------------|----------|
| Admin darf direkt | Admin ändert E-Mail/Displayname direkt mit Audit. | ✓ |
| E-Mail nur mit User-Code | Admin-Änderungen brauchen Bestätigung durch User. | |
| Nur Displayname direkt | E-Mail läuft immer über Bestätigung. | |

**User's choice:** Admin darf direkt
**Notes:** Kleine LAN-Organisation priorisiert Admin-Handlungsfähigkeit; Audit ist Pflicht.

---

## Invite-Lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Nur beim Erstellen komplett | Später nur maskiert anzeigen. | |
| Immer komplett für Admins | Codes bleiben dauerhaft in UI/API sichtbar. | ✓ |
| Immer maskiert | Admin muss Code direkt beim Erstellen sichern. | |

**User's choice:** Immer komplett für Admins
**Notes:** Praktischer LAN-Betrieb gewinnt hier bewusst gegenüber stärkerer Geheimnisreduktion.

| Option | Description | Selected |
|--------|-------------|----------|
| Nur ungenutzt hart löschen | Unbenutzte Invites können verschwinden; genutzte werden deaktiviert. | ✓ |
| Immer soft-delete | Alle Invites bleiben historisch erhalten. | |
| Immer hart löschen | Kann Audit- und Nutzungshistorie beschädigen. | |

**User's choice:** Nur ungenutzt hart löschen
**Notes:** Historie genutzter Invites bleibt erhalten.

| Option | Description | Selected |
|--------|-------------|----------|
| Label, Max, Ablauf | Code bleibt stabil; MaxUses darf nicht unter UsedCount fallen. | ✓ |
| Auch Code ändern | Bestehender Zugang kann andere Bedeutung bekommen. | |
| Nur deaktivieren | Erfüllt Änderungswunsch kaum. | |

**User's choice:** Label, Max, Ablauf
**Notes:** Code selbst wird nach Erstellung nicht bearbeitet.

| Option | Description | Selected |
|--------|-------------|----------|
| Audit maskiert | Audit speichert ID/Label/maskierten Code. | ✓ |
| Audit komplett | Audit wird zur Secrets-Ablage. | |
| Audit ohne Code | Audit nennt nur Invite-ID und Label. | |

**User's choice:** Audit maskiert
**Notes:** Admin-UI darf vollständige Codes zeigen, Audit nicht.

| Option | Description | Selected |
|--------|-------------|----------|
| Nur wenn gültig | Reaktivieren entfernt Deaktivierung, aber abgelaufene Invites brauchen neues Ablaufdatum. | ✓ |
| Ablauf ignorieren | Reaktivieren macht Invite sofort nutzbar. | |
| Immer Datum setzen | Beim Reaktivieren muss Admin ein neues Ablaufdatum wählen. | |

**User's choice:** Nur wenn gültig
**Notes:** Ablauf bleibt eine echte Nutzbarkeitsgrenze.

| Option | Description | Selected |
|--------|-------------|----------|
| Kein Limit, kein Ablauf | Alte Codes bleiben nutzbar bis Admin deaktiviert. | |
| Limit 25, kein Ablauf | Passt zur LAN-Größe ohne Zeitdruck. | |
| Limit 25, Ablauf 7 Tage | Sicherer, aber Admin muss häufiger anpassen. | |
| Other | Freitext. | ✓ |

**User's choice:** Limit 300, Ablauf 30 Tage
**Notes:** Diese Werte sind die Defaults für neue Invites.

| Option | Description | Selected |
|--------|-------------|----------|
| Über Label | Label ist Pflicht und wird als LAN-Party-/Planungsname genutzt. | ✓ |
| Separates Feld | Invite bekommt zusätzlich ein Party-/Event-Feld. | |
| Noch offen | Zentrale LAN-Party-Planung kommt später. | |

**User's choice:** Über Label
**Notes:** Kein separates Party-Modell in Phase 1.

---

## Session und Audit-Sicherheit

| Option | Description | Selected |
|--------|-------------|----------|
| Alle neu einloggen | Bestehende Sessions werden beim Upgrade invalidiert. | |
| Nahtlos migrieren | Komfortabler, aber komplexer. | ✓ |
| Nur neue Sessions | Bestehende rohe Tokens bleiben bis Logout bestehen. | |

**User's choice:** Nahtlos migrieren
**Notes:** Später als Best-effort präzisiert; erneuter Login ist akzeptabel, wenn sichere Migration nicht möglich ist.

| Option | Description | Selected |
|--------|-------------|----------|
| Alle Sessions widerrufen | Nach Rollenänderung, Löschung oder Admin-E-Mail-Änderung muss sich der User neu anmelden. | ✓ |
| Nur bei Löschung | Rollenänderungen wirken ab nächstem Request. | |
| Admin entscheidet | UI bietet Checkbox 'Sessions beenden'. | |

**User's choice:** Alle Sessions widerrufen
**Notes:** Sicherheitszustand soll sauber greifen.

| Option | Description | Selected |
|--------|-------------|----------|
| CSRF Token | Server gibt Token aus, Client sendet Header bei mutierenden API-Requests. | ✓ |
| Origin Check | Server prüft Origin/Host. | |
| Dokumentieren | Keine technische Änderung in Phase 1. | |

**User's choice:** CSRF Token
**Notes:** Expliziter Token-Header für mutierende Requests.

| Option | Description | Selected |
|--------|-------------|----------|
| Best effort | Sessions funktionieren, wenn sicher migrierbar; sonst neuer Login akzeptabel. | ✓ |
| Muss nahtlos sein | Kein Nutzer soll ausgeloggt werden. | |
| Admin-Hinweis reicht | Hinweis in Release Notes/UI reicht. | |

**User's choice:** Best effort
**Notes:** Sicherheit gewinnt, falls nahtlose Migration nicht sauber möglich ist.

| Option | Description | Selected |
|--------|-------------|----------|
| Aktion nicht blockieren | Business-Aktion bleibt erfolgreich; Fehler wird geloggt und optional als Warnung sichtbar. | ✓ |
| Admin-Aktionen blockieren | Kritische Admin-Aktionen brauchen Audit-Erfolg. | |
| Immer blockieren | Audit-Störung kann App lahmlegen. | |

**User's choice:** Aktion nicht blockieren
**Notes:** App-Betrieb soll durch Audit-Fehler nicht ausfallen.

| Option | Description | Selected |
|--------|-------------|----------|
| Secrets + PII sparsam | Keine OTPs, Tokens, vollständigen Invite-Codes; E-Mails nur wo nötig. | ✓ |
| Nur Secrets | E-Mail-Adressen bleiben vollständig. | |
| Alles für Admins | Vollständiges Admin-Protokoll. | |

**User's choice:** Secrets + PII sparsam
**Notes:** Audit ist kein Secret- oder PII-Dump.

| Option | Description | Selected |
|--------|-------------|----------|
| Ja, nach Soft-Delete | Nur aktive Accounts müssen unique sein; gelöschte User geben E-Mail frei. | ✓ |
| Nein, nie wieder | Historie bleibt stärker, aber Fehlanlagen sind unpraktisch. | |
| Admin entscheidet | Beim Löschen gibt es eine Option. | |

**User's choice:** Ja, nach Soft-Delete
**Notes:** Soft-delete anonymisiert, damit die E-Mail wiederverwendet werden kann.

---

## the agent's Discretion

- Konkrete Rate-Limit-Zahlen, CSRF-Headernamen, User-Agent-Heuristik und genaue deutsche UI-Texte.

## Deferred Ideas

- Eigenes LAN-Party-Modell für Invite-Gruppierung.
- Garantierte eigene Mobile-Push-Sounds.
- Active/active Multi-Instance-Betrieb.
