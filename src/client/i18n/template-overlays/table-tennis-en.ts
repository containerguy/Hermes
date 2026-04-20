import type { MessageKey } from "../catalog";

/**
 * Table tennis / sports tournament copy (EN). Base remains lan_party in en.ts.
 */
export const tableTennisEn: Partial<Record<MessageKey, string>> = {
  "brand.displayName": "Tournament desk",

  "kiosk.pageTitle": "Current matches",
  "kiosk.empty": "No active matches right now.",
  "kiosk.listAria": "Active matches",

  "main.route.events.eyebrow": "Draw sheet at a glance",
  "main.route.events.title": "Entries, times, and notes in one place.",
  "main.route.events.description":
    "See which match is on and how full the sign-up is. Coaches, organizers, or admins add matches or time slots here—no second UI.",

  "events.guest.title": "Sign in to view the draw.",
  "events.guest.body":
    "After sign-in you see which match is starting, who is signed up, and any table or meeting-point notes.",
  "events.empty.defaultTitle": "No entries on the board yet.",
  "events.empty.defaultBody":
    "Once an organizer adds a match or time slot, discipline, start, and notes appear here.",
  "events.organizer": "Hosted by",
  "events.capacity.players": "{joined} / {max} signed up",
  "events.conn.server": "Table / court",
  "events.conn.join": "Finding / notes",
  "events.conn.missing": "Table or meeting info is missing. Check with staff before you start.",
  "events.form.eyebrow": "New match",
  "events.form.title": "Add a match or time slot.",
  "events.form.intro":
    "Set discipline, start window, and optional notes so everyone sees the same draw.",
  "events.form.game": "Discipline / format",
  "events.form.catalogToggle": "Title: catalog or custom",
  "events.form.pickGame": "Pick a discipline…",
  "events.form.gameTitleAria": "Discipline or format",
  "events.form.submit": "Create entry",
  "events.board.aria": "Draw",
  "events.count.one": "1 match on the board",
  "events.count.many": "{n} matches on the board",
  "events.manager.denied.body":
    "Only coaches, organizers, and admins create new entries. As a player you can follow existing matches here.",
  "events.newCompact": "New entry",
  "events.overlay.aria": "Create new match",
  "events.msg.saved": "Entry saved.",
  "events.msg.archived": "Entry archived.",
  "events.msg.cancelled": "Entry cancelled.",
  "events.msg.deleted": "Entry deleted.",
  "events.confirm.archive": "Really archive this entry?",
  "events.confirm.cancel": "Really cancel this entry?",
  "events.confirm.delete": "Really delete this entry?{titleSuffix} (admins only, archived/cancelled only)",
  "events.full.detail": "Sign-up is full: you would be player {n} of {m}.",
  "events.full.simple": "Sign-up is full.",
  "events.full.hint": "Maybe time for another match or slot.",
  "events.empty.eyebrow": "Draw",

  "admin.catalog.label": "Discipline catalog (one entry per line)",
  "admin.catalog.help":
    "Organizers see this list when creating an entry. Leave empty for free titles only. Empty lines are dropped on save.",
  "admin.kiosk.help":
    "Shows active matches without login at a fixed URL path with a secret id query parameter—e.g. for a hall display.",
  "admin.invites.title": "Tournament invite codes",
  "admin.invites.placeholderName": "Spring open"
};
