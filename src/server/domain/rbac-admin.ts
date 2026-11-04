import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { tryWriteAuditLog } from "../audit-log";
import type { DatabaseContext } from "../db/client";
import { mainEvents, permissions, rolePermissions, roles, userGrants, users } from "../db/schema";

/*
 * Verwaltung von Rollen, Rechten und Vergaben (nur für Admins).
 * Die Grundrolle bleibt users.role; Vergaben kommen zusätzlich dazu, global oder für ein Event.
 */

type Actor = { id: string; username: string; role: string };
type Failure = { ok: false; status: 400 | 403 | 404 | 409; error: string };

const permissionKeySchema = z.string().min(1).max(80);

export const roleInputSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9_-]*$/),
  label: z.string().trim().min(1).max(60),
  permissions: z.array(permissionKeySchema).max(200)
});

export const roleUpdateSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  permissions: z.array(permissionKeySchema).max(200).optional()
});

export const grantInputSchema = z
  .object({
    roleKey: z.string().min(1).max(40).optional(),
    permissionKey: permissionKeySchema.optional(),
    mainEventId: z.string().min(1).max(64).nullable().optional()
  })
  .refine((value) => Boolean(value.roleKey) !== Boolean(value.permissionKey), {
    message: "role_oder_recht"
  });

function nowIso() {
  return new Date().toISOString();
}

export function listPermissionCatalog(context: DatabaseContext) {
  const permissionRows = context.db
    .select()
    .from(permissions)
    .orderBy(asc(permissions.moduleId), asc(permissions.key))
    .all();
  const roleRows = context.db.select().from(roles).orderBy(asc(roles.createdAt), asc(roles.key)).all();
  const assignments = context.db.select().from(rolePermissions).all();
  return {
    permissions: permissionRows.map((row) => ({
      key: row.key,
      moduleId: row.moduleId,
      label: row.label,
      description: row.description,
      scopable: row.scopable
    })),
    roles: roleRows.map((row) => ({
      id: row.id,
      key: row.key,
      label: row.label,
      builtin: row.builtin,
      // Admin hat immer alle Rechte, auch künftige Modulrechte.
      permissions:
        row.key === "admin"
          ? permissionRows.map((permission) => permission.key)
          : assignments.filter((assignment) => assignment.roleId === row.id).map((assignment) => assignment.permissionKey)
    }))
  };
}

function unknownPermissions(context: DatabaseContext, keys: string[]) {
  if (keys.length === 0) {
    return [];
  }
  const known = new Set(
    context.db
      .select({ key: permissions.key })
      .from(permissions)
      .where(inArray(permissions.key, keys))
      .all()
      .map((row) => row.key)
  );
  return keys.filter((key) => !known.has(key));
}

function setRolePermissions(context: DatabaseContext, roleId: string, keys: string[]) {
  context.db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId)).run();
  for (const key of new Set(keys)) {
    context.db.insert(rolePermissions).values({ roleId, permissionKey: key }).run();
  }
}

export function createRole(
  context: DatabaseContext,
  actor: Actor,
  input: z.infer<typeof roleInputSchema>
): { ok: true; roleId: string } | Failure {
  if (context.db.select().from(roles).where(eq(roles.key, input.key)).get()) {
    return { ok: false, status: 409, error: "rolle_existiert" };
  }
  if (input.permissions.includes("admin.access")) {
    return { ok: false, status: 400, error: "admin_recht_nur_admin_rolle" };
  }
  if (unknownPermissions(context, input.permissions).length > 0) {
    return { ok: false, status: 400, error: "recht_unbekannt" };
  }
  const id = randomUUID();
  const timestamp = nowIso();
  context.sqlite.transaction(() => {
    context.db
      .insert(roles)
      .values({ id, key: input.key, label: input.label, builtin: false, createdAt: timestamp, updatedAt: timestamp })
      .run();
    setRolePermissions(context, id, input.permissions);
  })();
  tryWriteAuditLog(context, {
    actor,
    action: "role.create",
    entityType: "role",
    entityId: id,
    summary: `${actor.username} hat die Rolle ${input.label} angelegt.`,
    metadata: { key: input.key, permissions: input.permissions }
  });
  return { ok: true, roleId: id };
}

export function updateRole(
  context: DatabaseContext,
  actor: Actor,
  roleId: string,
  input: z.infer<typeof roleUpdateSchema>
): { ok: true } | Failure {
  const role = context.db.select().from(roles).where(eq(roles.id, roleId)).get();
  if (!role) {
    return { ok: false, status: 404, error: "rolle_nicht_gefunden" };
  }
  // Admin bleibt immer vollständig, sonst könnte man sich aussperren.
  if (role.key === "admin") {
    return { ok: false, status: 409, error: "admin_rolle_fest" };
  }
  if (input.permissions) {
    if (input.permissions.includes("admin.access")) {
      return { ok: false, status: 400, error: "admin_recht_nur_admin_rolle" };
    }
    if (unknownPermissions(context, input.permissions).length > 0) {
      return { ok: false, status: 400, error: "recht_unbekannt" };
    }
  }
  context.sqlite.transaction(() => {
    context.db
      .update(roles)
      .set({ label: input.label ?? role.label, updatedAt: nowIso() })
      .where(eq(roles.id, roleId))
      .run();
    if (input.permissions) {
      setRolePermissions(context, roleId, input.permissions);
    }
  })();
  tryWriteAuditLog(context, {
    actor,
    action: "role.update",
    entityType: "role",
    entityId: roleId,
    summary: `${actor.username} hat die Rolle ${input.label ?? role.label} geändert.`,
    metadata: input
  });
  return { ok: true };
}

export function deleteRole(context: DatabaseContext, actor: Actor, roleId: string): { ok: true } | Failure {
  const role = context.db.select().from(roles).where(eq(roles.id, roleId)).get();
  if (!role) {
    return { ok: false, status: 404, error: "rolle_nicht_gefunden" };
  }
  if (role.builtin) {
    return { ok: false, status: 409, error: "rolle_mitgeliefert" };
  }
  // Vergaben dieser Rolle verschwinden per Fremdschlüssel mit.
  context.db.delete(roles).where(eq(roles.id, roleId)).run();
  tryWriteAuditLog(context, {
    actor,
    action: "role.delete",
    entityType: "role",
    entityId: roleId,
    summary: `${actor.username} hat die Rolle ${role.label} gelöscht.`,
    metadata: { key: role.key }
  });
  return { ok: true };
}

/** Aktive Vergaben (nicht widerrufen, Event nicht beendet), optional nur für bestimmte Benutzer. */
export function listActiveGrants(context: DatabaseContext, userIds?: string[]) {
  const rows = context.db
    .select({
      id: userGrants.id,
      userId: userGrants.userId,
      roleKey: roles.key,
      roleLabel: roles.label,
      permissionKey: userGrants.permissionKey,
      permissionLabel: permissions.label,
      mainEventId: userGrants.mainEventId,
      mainEventName: mainEvents.name,
      mainEventStatus: mainEvents.status,
      createdAt: userGrants.createdAt
    })
    .from(userGrants)
    .leftJoin(roles, eq(userGrants.roleId, roles.id))
    .leftJoin(permissions, eq(userGrants.permissionKey, permissions.key))
    .leftJoin(mainEvents, eq(userGrants.mainEventId, mainEvents.id))
    .where(
      userIds
        ? and(isNull(userGrants.revokedAt), inArray(userGrants.userId, userIds))
        : isNull(userGrants.revokedAt)
    )
    .orderBy(asc(userGrants.createdAt))
    .all();
  return rows
    .filter((row) => row.mainEventId === null || (row.mainEventStatus !== null && row.mainEventStatus !== "ended"))
    .map(({ mainEventStatus: _status, ...row }) => row);
}

export function addGrant(
  context: DatabaseContext,
  actor: Actor,
  userId: string,
  input: z.infer<typeof grantInputSchema>
): { ok: true; grantId: string } | Failure {
  const target = context.db.select().from(users).where(eq(users.id, userId)).get();
  if (!target || target.deletedAt) {
    return { ok: false, status: 404, error: "user_nicht_gefunden" };
  }
  const mainEventId = input.mainEventId ?? null;

  let roleId: string | null = null;
  let label: string;
  if (input.roleKey) {
    const role = context.db.select().from(roles).where(eq(roles.key, input.roleKey)).get();
    if (!role) {
      return { ok: false, status: 400, error: "rolle_nicht_gefunden" };
    }
    // Admin pro Event ergibt keinen Sinn: Administration gilt nur global.
    if (mainEventId && role.key === "admin") {
      return { ok: false, status: 400, error: "admin_nur_global" };
    }
    roleId = role.id;
    label = role.label;
  } else {
    const permission = context.db
      .select()
      .from(permissions)
      .where(eq(permissions.key, input.permissionKey!))
      .get();
    if (!permission) {
      return { ok: false, status: 400, error: "recht_unbekannt" };
    }
    if (mainEventId && !permission.scopable) {
      return { ok: false, status: 400, error: "recht_nicht_pro_event" };
    }
    label = permission.label;
  }

  let eventName: string | null = null;
  if (mainEventId) {
    const event = context.db.select().from(mainEvents).where(eq(mainEvents.id, mainEventId)).get();
    if (!event) {
      return { ok: false, status: 400, error: "hauptevent_nicht_gefunden" };
    }
    if (event.status === "ended") {
      return { ok: false, status: 409, error: "hauptevent_beendet" };
    }
    eventName = event.name;
  }

  const duplicate = context.db
    .select({ id: userGrants.id })
    .from(userGrants)
    .where(
      and(
        eq(userGrants.userId, userId),
        isNull(userGrants.revokedAt),
        roleId ? eq(userGrants.roleId, roleId) : eq(userGrants.permissionKey, input.permissionKey!),
        mainEventId ? eq(userGrants.mainEventId, mainEventId) : isNull(userGrants.mainEventId)
      )
    )
    .get();
  if (duplicate) {
    return { ok: false, status: 409, error: "vergabe_existiert" };
  }

  const id = randomUUID();
  context.db
    .insert(userGrants)
    .values({
      id,
      userId,
      roleId,
      permissionKey: roleId ? null : input.permissionKey!,
      mainEventId,
      grantedByUserId: actor.id,
      createdAt: nowIso()
    })
    .run();
  tryWriteAuditLog(context, {
    actor,
    action: "user.grant",
    entityType: "user",
    entityId: userId,
    summary: `${actor.username} hat ${target.username} ${label} gegeben${eventName ? ` (nur für ${eventName})` : ""}.`,
    metadata: { grantId: id, roleKey: input.roleKey ?? null, permissionKey: input.permissionKey ?? null, mainEventId }
  });
  return { ok: true, grantId: id };
}

export function revokeGrant(
  context: DatabaseContext,
  actor: Actor,
  userId: string,
  grantId: string
): { ok: true } | Failure {
  const grant = context.db
    .select()
    .from(userGrants)
    .where(and(eq(userGrants.id, grantId), eq(userGrants.userId, userId), isNull(userGrants.revokedAt)))
    .get();
  if (!grant) {
    return { ok: false, status: 404, error: "vergabe_nicht_gefunden" };
  }
  context.db.update(userGrants).set({ revokedAt: nowIso() }).where(eq(userGrants.id, grantId)).run();
  const target = context.db.select({ username: users.username }).from(users).where(eq(users.id, userId)).get();
  tryWriteAuditLog(context, {
    actor,
    action: "user.revoke_grant",
    entityType: "user",
    entityId: userId,
    summary: `${actor.username} hat eine Vergabe bei ${target?.username ?? "Benutzer"} zurückgenommen.`,
    metadata: { grantId, roleId: grant.roleId, permissionKey: grant.permissionKey, mainEventId: grant.mainEventId }
  });
  return { ok: true };
}
