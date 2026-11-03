import { z } from "zod";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { DatabaseContext } from "../db/client";
import { users } from "../db/schema";

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
 * Hermes ist auf rund 25 Teilnehmer ausgelegt, daher wird in JS verglichen statt per
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
    return findActiveUserByEmail(context, identifier) ?? findActiveUserByUsername(context, identifier);
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

export function canManageEvent(
  actor: { id: string; role: UserRole },
  event: { createdByUserId: string }
) {
  return actor.role === "admin" || actor.role === "manager" || actor.id === event.createdByUserId;
}

export function canCreateEvent(actor: { role: UserRole }) {
  return actor.role === "admin" || actor.role === "manager" || actor.role === "organizer";
}

export function canAssignRoles(actor: { role: UserRole }) {
  return actor.role === "admin";
}

/** Phase 15 (D-09): Gameserver starten/stoppen/updaten und Konsole nutzen — ab manager. */
export function canManageServers(actor: { role: UserRole }) {
  return actor.role === "admin" || actor.role === "manager";
}

/** Pizzabestellung verwalten (Runden, Menü, Archiv, Zahlungen) — ab manager. */
export function canManagePizza(actor: { role: UserRole }) {
  return actor.role === "admin" || actor.role === "manager";
}

/** Events anlegen, bearbeiten, starten und beenden — ab manager. */
export function canManageMainEvents(actor: { role: UserRole }) {
  return actor.role === "admin" || actor.role === "manager";
}
