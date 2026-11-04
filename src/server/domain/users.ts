import { z } from "zod";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { DatabaseContext } from "../db/client";
import { users } from "../db/schema";
import { can, scopedEventIds } from "./permissions";

export const userRoleSchema = z.enum(["user", "organizer", "manager", "admin"]);

export type UserRole = z.infer<typeof userRoleSchema>;

/** Vergleichsschlüssel für Anmeldenamen und Mailadressen: Groß-/Kleinschreibung egal. */
export function loginIdentityKey(value: string) {
  return value.trim().toLocaleLowerCase("de");
}

function listActiveUsers(context: DatabaseContext, options?: { excludeUserId?: string }) {
  return context.db
    .select()
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        options?.excludeUserId ? ne(users.id, options.excludeUserId) : undefined
      )
    )
    .all();
}

/**
 * Sucht einen aktiven User, dessen Feld ohne Beachtung der Groß-/Kleinschreibung passt.
 * Ein exakter Treffer gewinnt; gibt es nur mehrere Treffer, die sich bloß in der
 * Schreibweise unterscheiden (Altbestand), ist das Ergebnis mehrdeutig und null.
 *
 * Matchdesk ist auf rund 25 Teilnehmer ausgelegt, daher wird in JS verglichen statt per
 * SQLite-lower(), das Umlaute nicht faltet.
 */
function findActiveUserCaseInsensitive(
  context: DatabaseContext,
  field: "username" | "email",
  value: string
) {
  const trimmed = value.trim();
  const exact = context.db
    .select()
    .from(users)
    .where(and(eq(users[field], trimmed), isNull(users.deletedAt)))
    .get();
  if (exact) {
    return exact;
  }

  const key = loginIdentityKey(trimmed);
  const matches = listActiveUsers(context).filter((user) => loginIdentityKey(user[field]) === key);
  return matches.length === 1 ? matches[0] : undefined;
}

export function findActiveUserByEmail(context: DatabaseContext, email: string) {
  return findActiveUserCaseInsensitive(context, "email", email);
}

export function findActiveUserByUsername(context: DatabaseContext, username: string) {
  return findActiveUserCaseInsensitive(context, "username", username);
}

/**
 * Login-Kennung auflösen: Anmeldename oder Mailadresse, beides ohne Groß-/Kleinschreibung.
 * Eine Eingabe mit „@“ wird zuerst als Mailadresse gesucht, sonst als Anmeldename.
 */
export function findActiveUserByLoginIdentifier(context: DatabaseContext, identifier: string) {
  if (identifier.includes("@")) {
    // Ein exakt passender Anmeldename (Usernames dürfen „@“ enthalten) gewinnt vor der
    // Mail-Suche, damit niemand per ähnlicher Mailadresse ein fremdes Login „überdeckt“.
    const exactUsername = context.db
      .select()
      .from(users)
      .where(and(eq(users.username, identifier.trim()), isNull(users.deletedAt)))
      .get();
    return exactUsername ?? findActiveUserByEmail(context, identifier) ?? findActiveUserByUsername(context, identifier);
  }
  return findActiveUserByUsername(context, identifier);
}

export function ensureActiveEmailAvailable(
  context: DatabaseContext,
  email: string,
  options?: { excludeUserId?: string }
) {
  const key = loginIdentityKey(email);
  const found = listActiveUsers(context, options).some((user) => loginIdentityKey(user.email) === key);

  if (found) {
    return { ok: false as const, error: "email_existiert_bereits" as const };
  }

  return { ok: true as const };
}

export function ensureActiveUsernameAvailable(
  context: DatabaseContext,
  username: string,
  options?: { excludeUserId?: string }
) {
  const key = loginIdentityKey(username);
  const found = listActiveUsers(context, options).some((user) => loginIdentityKey(user.username) === key);

  if (found) {
    return { ok: false as const, error: "username_existiert_bereits" as const };
  }

  return { ok: true as const };
}

/**
 * Prüft Anmeldename und Mailadresse auf Kollisionen (ohne Groß-/Kleinschreibung).
 * Ein weggelassenes Feld wird nicht geprüft, damit Bearbeitungen an Altbeständen mit
 * nur in der Schreibweise abweichenden Namen nicht blockiert werden.
 */
export function ensureActiveIdentityAvailable(
  context: DatabaseContext,
  input: { username?: string; email?: string },
  options?: { excludeUserId?: string }
) {
  if (input.username !== undefined) {
    const usernameCheck = ensureActiveUsernameAvailable(context, input.username, options);
    if (!usernameCheck.ok) {
      return usernameCheck;
    }
  }

  if (input.email !== undefined) {
    const emailCheck = ensureActiveEmailAvailable(context, input.email, options);
    if (!emailCheck.ok) {
      return emailCheck;
    }
  }

  return { ok: true as const };
}

/*
 * Rechteprüfungen laufen über das Rechtemodell (domain/permissions.ts): Grundrolle des Benutzers
 * plus Vergaben, global oder nur für ein Event. Die Funktionen hier bleiben als sprechende Namen.
 */
type Actor = { id: string; role: UserRole };

/** Eigene Runden verwalten darf der Ersteller, fremde nur mit `rounds.manage` (global oder fürs Event). */
export function canManageEvent(
  context: DatabaseContext,
  actor: Actor,
  event: { createdByUserId: string; mainEventId?: string | null }
) {
  return (
    actor.id === event.createdByUserId ||
    can(context, actor, "rounds.manage", { mainEventId: event.mainEventId ?? null })
  );
}

export function canCreateEvent(context: DatabaseContext, actor: Actor, mainEventId?: string | null) {
  return can(context, actor, "rounds.create", { mainEventId: mainEventId ?? null });
}

/** Darf Runden anlegen, global oder für mindestens ein Event (Vorprüfung vor der Event-Auswahl). */
export function canCreateEventSomewhere(context: DatabaseContext, actor: Actor) {
  return canCreateEvent(context, actor) || scopedEventIds(context, actor, "rounds.create").length > 0;
}

/** Spiele mit Gameserver-Instanzen verknüpfen (bisher nur Admin). */
export function canBindServers(context: DatabaseContext, actor: Actor) {
  return can(context, actor, "servers.bind");
}

/** Gameserver-Instanzen sehen (Auswahl beim Anlegen von Runden). */
export function canListServers(context: DatabaseContext, actor: Actor) {
  return can(context, actor, "servers.view");
}

/** Phase 15 (D-09): Gameserver starten/stoppen/updaten und Konsole nutzen. */
export function canManageServers(context: DatabaseContext, actor: Actor) {
  return can(context, actor, "servers.manage");
}

/** Pizzabestellung verwalten (Runden, Menü, Archiv, Zahlungen). */
export function canManagePizza(context: DatabaseContext, actor: Actor) {
  return can(context, actor, "pizza.manage");
}

/**
 * Events verwalten. Ohne `mainEventId` nur global (z. B. neues Event anlegen),
 * mit `mainEventId` zählt auch ein Recht nur für dieses Event.
 */
export function canManageMainEvents(context: DatabaseContext, actor: Actor, mainEventId?: string | null) {
  return can(context, actor, "main_events.manage", { mainEventId: mainEventId ?? null });
}

/** Zugang zur Administration (nur global vergebbar). */
export function isAdministrator(context: DatabaseContext, actor: Actor) {
  return can(context, actor, "admin.access");
}
