import type { MessageKey } from "../catalog";

/**
 * Tischtennis / Sport-Turnier: ersetzt ausgewählte UI-Texte (DE).
 * Basis bleibt lan_party in de.ts.
 */
export const tableTennisDe: Partial<Record<MessageKey, string>> = {
  "brand.displayName": "Turnierzentrale",

  "kiosk.pageTitle": "Aktuelle Matches",
  "kiosk.empty": "Derzeit keine aktiven Matches.",
  "kiosk.listAria": "Liste der aktiven Matches",

  "main.route.events.eyebrow": "Spielplan im Blick",
  "main.route.events.title": "Meldeliste, Zeiten und Hinweise an einem Ort.",
  "main.route.events.description":
    "Sieh auf einen Blick, welches Match ansteht und wie voll die Meldeliste ist. Trainer, Organisatoren oder Admins tragen neue Partien oder Zeitfenster hier ein — ohne zweite Oberfläche.",

  "events.guest.title": "Einloggen und den Spielplan prüfen.",
  "events.guest.body":
    "Nach dem Login siehst du sofort, welches Match startet, wer gemeldet ist und welche Platz- oder Join-Hinweise hinterlegt wurden.",
  "events.empty.defaultTitle": "Noch keine Einträge im Spielplan.",
  "events.empty.defaultBody":
    "Sobald ein Organisator ein Match oder Zeitfenster anlegt, erscheinen Disziplin, Start und Hinweise hier.",
  "events.organizer": "Organisation",
  "events.capacity.players": "{joined} / {max} gemeldet",
  "events.conn.server": "Platz / Tisch",
  "events.conn.join": "Hinweis zum Finden",
  "events.conn.missing":
    "Platz- oder Treffpunkt fehlen noch. Kurz bei der Organisation nachfragen, bevor ihr startet.",
  "events.form.eyebrow": "Neues Match",
  "events.form.title": "Match oder Zeitfenster eintragen.",
  "events.form.intro":
    "Lege Disziplin, Startfenster und optionale Hinweise fest, damit alle denselben Spielplan sehen.",
  "events.form.game": "Disziplin / Modus",
  "events.form.catalogToggle": "Titel: Katalog oder Freitext",
  "events.form.pickGame": "Disziplin wählen…",
  "events.form.gameTitleAria": "Disziplin oder Modus",
  "events.form.submit": "Eintrag anlegen",
  "events.board.aria": "Spielplan",
  "events.count.one": "1 Match im Spielplan",
  "events.count.many": "{n} Matches im Spielplan",
  "events.manager.denied.body":
    "Neue Einträge können Trainer, Organisatoren und Admins anlegen. Als Spieler kannst du bestehende Matches hier verfolgen.",
  "events.newCompact": "Neuer Eintrag",
  "events.overlay.aria": "Neues Match anlegen",
  "events.msg.saved": "Eintrag gespeichert.",
  "events.msg.archived": "Eintrag archiviert.",
  "events.msg.cancelled": "Eintrag storniert.",
  "events.msg.deleted": "Eintrag gelöscht.",
  "events.confirm.archive": "Eintrag wirklich archivieren?",
  "events.confirm.cancel": "Eintrag wirklich stornieren?",
  "events.confirm.delete": "Eintrag wirklich löschen?{titleSuffix} (nur Admins, nur archiviert/storniert)",
  "events.full.detail": "Meldeliste voll: Du wärst Starter {n} von {m}.",
  "events.full.simple": "Meldeliste ist voll.",
  "events.full.hint": "Vielleicht Zeit für ein weiteres Match oder ein neues Zeitfenster.",
  "events.empty.eyebrow": "Spielplan",

  "admin.catalog.label": "Disziplinen-Katalog (ein Eintrag pro Zeile)",
  "admin.catalog.help":
    "Diese Liste erscheint beim Anlegen als Auswahl. Leer lassen für freie Titel. Leere Zeilen werden beim Speichern entfernt.",
  "admin.kiosk.help":
    "Zeigt aktive Matches ohne Login auf einem festen URL-Pfad mit geheimem id-Parameter — z. B. für eine Hallenanzeige.",
  "admin.invites.title": "Turnier-Invite-Codes",
  "admin.invites.placeholderName": "Bezirksmeisterschaft"
};
