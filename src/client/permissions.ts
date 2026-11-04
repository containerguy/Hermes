import type { User } from "./types/core";

/** Wirksame Rechte des eigenen Benutzers, wie sie der Server unter /api/auth/me liefert. */
export type PermissionSummary = {
  isAdmin: boolean;
  global: string[];
  /** Rechte nur für einzelne Events (nur solange das Event nicht beendet ist). */
  events: Record<string, string[]>;
};

/**
 * Rückfall, falls ein Benutzerobjekt keine Rechte mitbringt (ältere Antworten, Tests):
 * die mitgelieferten Rollen wie in Migration 0029.
 */
const BUILTIN_ROLE_PERMISSIONS: Record<User["role"], string[]> = {
  user: [],
  organizer: ["rounds.create", "notifications.operator", "servers.view"],
  manager: [
    "rounds.create",
    "rounds.manage",
    "main_events.manage",
    "notifications.operator",
    "servers.view",
    "servers.manage"
  ],
  admin: []
};

function summaryOf(user: Pick<User, "role" | "permissions">): PermissionSummary {
  return (
    user.permissions ?? {
      isAdmin: user.role === "admin",
      global: BUILTIN_ROLE_PERMISSIONS[user.role] ?? [],
      events: {}
    }
  );
}

/** Hat der Benutzer das Recht global, oder (mit `mainEventId`) für genau dieses Event? */
export function hasPermission(
  user: Pick<User, "role" | "permissions"> | null | undefined,
  permission: string,
  mainEventId?: string | null
) {
  if (!user) {
    return false;
  }
  const summary = summaryOf(user);
  if (summary.isAdmin || summary.global.includes(permission)) {
    return true;
  }
  return Boolean(mainEventId && summary.events[mainEventId]?.includes(permission));
}

/** Hat der Benutzer das Recht global oder für irgendein Event? */
export function hasPermissionAnywhere(user: Pick<User, "role" | "permissions"> | null | undefined, permission: string) {
  if (!user) {
    return false;
  }
  const summary = summaryOf(user);
  return hasPermission(user, permission) || Object.values(summary.events).some((keys) => keys.includes(permission));
}

export function isAdministrator(user: Pick<User, "role" | "permissions"> | null | undefined) {
  return Boolean(user && summaryOf(user).isAdmin);
}
