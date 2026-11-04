import { can, effectivePermissions } from "../domain/permissions";
import type { Request } from "express";
import type { DatabaseContext } from "../db/client";
import { users } from "../db/schema";
import { resolveMatchdeskAuth } from "./matchdesk-auth";

export function publicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    phoneNumber: user.phoneNumber,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    notificationsEnabled: user.notificationsEnabled,
    locale: user.locale,
    deletedAt: user.deletedAt
  };
}

/** Wirksame Rechte für die Oberfläche: global und je Event (nur laufende oder geplante Events). */
export function permissionSummary(context: DatabaseContext, user: { id: string; role: string }) {
  const effective = effectivePermissions(context, user);
  return {
    isAdmin: effective.isAdmin,
    global: Array.from(effective.global).sort(),
    events: Object.fromEntries(
      Array.from(effective.events.entries()).map(([eventId, keys]) => [eventId, Array.from(keys).sort()])
    )
  };
}

/** Der eigene Benutzer mit seinen wirksamen Rechten (für die Oberfläche). */
export function selfUser(context: DatabaseContext, user: typeof users.$inferSelect) {
  return { ...publicUser(user), permissions: permissionSummary(context, user) };
}

export function getCurrentSession(context: DatabaseContext, request: Request) {
  resolveMatchdeskAuth(context, request);
  const auth = request.matchdeskAuth;
  if (auth?.kind === "session") {
    return { session: auth.session, user: auth.user };
  }
  return undefined;
}

export function requireUser(context: DatabaseContext, request: Request) {
  resolveMatchdeskAuth(context, request);
  return request.matchdeskAuth?.user;
}

export function requireAdmin(context: DatabaseContext, request: Request) {
  const user = requireUser(context, request);

  if (!user || !can(context, user, "admin.access")) {
    return undefined;
  }

  return user;
}
