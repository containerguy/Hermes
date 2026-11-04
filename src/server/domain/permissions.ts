import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DatabaseContext } from "../db/client";
import { mainEvents, permissions, rolePermissions, roles, userGrants, users } from "../db/schema";

/**
 * Rechte des Kerns. Module melden eigene Rechte mit `registerModulePermissions` an
 * (Schlüssel mit Modul-Präfix, z. B. `polls.manage`).
 */
export const CORE_PERMISSIONS = [
  "rounds.create",
  "rounds.manage",
  "main_events.manage",
  "notifications.operator",
  "pizza.manage",
  "servers.view",
  "servers.manage",
  "servers.bind",
  "admin.access"
] as const;

export type CorePermission = (typeof CORE_PERMISSIONS)[number];
export type PermissionKey = CorePermission | (string & {});

type Actor = { id: string; role: string };

export type EffectivePermissions = {
  /** Wer `admin.access` global hat, darf alles, auch alle Modulrechte. */
  isAdmin: boolean;
  global: Set<string>;
  /** Rechte nur für einzelne Events (nur solange das Event nicht beendet ist). */
  events: Map<string, Set<string>>;
};

function permissionsOfRoles(context: DatabaseContext, roleIds: string[]) {
  if (roleIds.length === 0) {
    return new Map<string, string[]>();
  }
  const rows = context.db
    .select({ roleId: rolePermissions.roleId, key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, roleIds))
    .all();
  const byRole = new Map<string, string[]>();
  for (const row of rows) {
    byRole.set(row.roleId, [...(byRole.get(row.roleId) ?? []), row.key]);
  }
  return byRole;
}

/** Alle wirksamen Rechte eines Benutzers: Grundrolle plus aktive Vergaben. */
export function effectivePermissions(context: DatabaseContext, actor: Actor): EffectivePermissions {
  const baseRole = context.db.select({ id: roles.id }).from(roles).where(eq(roles.key, actor.role)).get();
  const grants = context.db
    .select({
      roleId: userGrants.roleId,
      permissionKey: userGrants.permissionKey,
      mainEventId: userGrants.mainEventId,
      eventStatus: mainEvents.status
    })
    .from(userGrants)
    .leftJoin(mainEvents, eq(userGrants.mainEventId, mainEvents.id))
    .where(and(eq(userGrants.userId, actor.id), isNull(userGrants.revokedAt)))
    .all()
    // Event-Vergaben erlöschen mit dem Ende des Events.
    .filter((grant) => grant.mainEventId === null || (grant.eventStatus !== null && grant.eventStatus !== "ended"));

  const roleIds = [
    ...(baseRole ? [baseRole.id] : []),
    ...grants.map((grant) => grant.roleId).filter((id): id is string => Boolean(id))
  ];
  const byRole = permissionsOfRoles(context, Array.from(new Set(roleIds)));

  const global = new Set<string>(baseRole ? (byRole.get(baseRole.id) ?? []) : []);
  const events = new Map<string, Set<string>>();
  for (const grant of grants) {
    const keys = grant.roleId ? (byRole.get(grant.roleId) ?? []) : grant.permissionKey ? [grant.permissionKey] : [];
    const target = grant.mainEventId
      ? (events.get(grant.mainEventId) ?? events.set(grant.mainEventId, new Set()).get(grant.mainEventId)!)
      : global;
    for (const key of keys) {
      target.add(key);
    }
  }
  // Administration wird nur global wirksam, nie über ein einzelnes Event.
  for (const scoped of events.values()) {
    scoped.delete("admin.access");
  }

  return { isAdmin: global.has("admin.access"), global, events };
}

/**
 * Prüft ein Recht. Mit `mainEventId` zählen auch Vergaben für genau dieses Event,
 * ohne nur globale Vergaben und die Grundrolle.
 */
export function can(
  context: DatabaseContext,
  actor: Actor,
  permission: PermissionKey,
  options: { mainEventId?: string | null } = {}
) {
  const effective = effectivePermissions(context, actor);
  if (effective.isAdmin || effective.global.has(permission)) {
    return true;
  }
  return Boolean(options.mainEventId && effective.events.get(options.mainEventId)?.has(permission));
}

/** Events, für die der Benutzer ein Recht nur per Event-Vergabe hat. */
export function scopedEventIds(context: DatabaseContext, actor: Actor, permission: PermissionKey) {
  const effective = effectivePermissions(context, actor);
  return Array.from(effective.events.entries())
    .filter(([, keys]) => keys.has(permission))
    .map(([id]) => id);
}

/** Aktive Benutzer mit einem Recht (global oder für das angegebene Event). */
export function userIdsWithPermission(
  context: DatabaseContext,
  permission: PermissionKey,
  options: { mainEventId?: string | null } = {}
) {
  return context.db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(isNull(users.deletedAt))
    .all()
    .filter((user) => can(context, user, permission, options))
    .map((user) => user.id);
}

export type ModulePermissionDefinition = {
  key: string;
  label: string;
  description?: string;
  scopable?: boolean;
  /** Mitgelieferte Rollen, die das Recht beim Anmelden bekommen (Admin hat immer alles). */
  defaultRoles?: Array<"organizer" | "manager">;
};

/** Rechte eines Moduls anmelden (beim Installieren oder Start). Bestehende Rechte bleiben unverändert. */
export function registerModulePermissions(
  context: DatabaseContext,
  moduleId: string,
  definitions: ModulePermissionDefinition[]
) {
  const timestamp = new Date().toISOString();
  context.sqlite.transaction(() => {
    for (const definition of definitions) {
      if (!definition.key.startsWith(`${moduleId}.`)) {
        throw new Error(`Modulrecht ${definition.key} muss mit ${moduleId}. beginnen`);
      }
      const inserted = context.db
        .insert(permissions)
        .values({
          key: definition.key,
          moduleId,
          label: definition.label,
          description: definition.description ?? null,
          scopable: definition.scopable ?? false,
          createdAt: timestamp
        })
        .onConflictDoNothing()
        .run();
      if (inserted.changes === 0) {
        continue;
      }
      for (const roleKey of definition.defaultRoles ?? []) {
        const role = context.db.select({ id: roles.id }).from(roles).where(eq(roles.key, roleKey)).get();
        if (role) {
          context.db
            .insert(rolePermissions)
            .values({ roleId: role.id, permissionKey: definition.key })
            .onConflictDoNothing()
            .run();
        }
      }
    }
  })();
}

/** Beim Deinstallieren: Rechte des Moduls samt Rollenzuordnung und Vergaben entfernen. */
export function removeModulePermissions(context: DatabaseContext, moduleId: string) {
  return context.db.delete(permissions).where(eq(permissions.moduleId, moduleId)).run().changes;
}

/** Beim Eventende: Vergaben für das Event als widerrufen markieren (Verlauf bleibt erhalten). */
export function revokeEventGrants(context: DatabaseContext, mainEventId: string, timestamp: string) {
  return context.db
    .update(userGrants)
    .set({ revokedAt: timestamp })
    .where(and(eq(userGrants.mainEventId, mainEventId), isNull(userGrants.revokedAt)))
    .run().changes;
}
