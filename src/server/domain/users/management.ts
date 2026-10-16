import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { tryWriteAuditLog } from "../../audit-log";
import type { DatabaseContext } from "../../db/client";
import { devices, participations, pushSubscriptions, sessions, users } from "../../db/schema";
import { ensureActiveIdentityAvailable, userRoleSchema } from "../users";
import { readSettings } from "../../settings";
import { fallbackPhoneNumber } from "./bulk-import";

export const createUserSchema = z.object({
  phoneNumber: z.string().trim().min(3).max(40).optional(),
  username: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email().max(160),
  role: userRoleSchema.default("user")
});

export const updateUserSchema = z.object({
  phoneNumber: z.string().trim().min(3).max(40).optional(),
  username: z.string().trim().min(1).max(80).optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email().max(160).optional(),
  role: userRoleSchema.optional(),
  notificationsEnabled: z.boolean().optional()
});

type CreateInput = z.infer<typeof createUserSchema>;
type UpdateInput = z.infer<typeof updateUserSchema>;
type Actor = { id: string; username: string };
type UserRow = typeof users.$inferSelect;

export type CreateUserResult =
  | { ok: true; user: UserRow }
  | { ok: false; status: 409; error: string };

export type UpdateUserResult =
  | { ok: true; user: UserRow }
  | { ok: false; status: 404 | 409; error: string };

export type SoftDeleteResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string };

function nowIso() {
  return new Date().toISOString();
}

export function createUser(
  context: DatabaseContext,
  admin: Actor,
  input: CreateInput
): CreateUserResult {
  const identityCheck = ensureActiveIdentityAvailable(context, {
    username: input.username,
    email: input.email
  });
  if (!identityCheck.ok) {
    return { ok: false, status: 409, error: identityCheck.error };
  }

  const timestamp = nowIso();
  const id = randomUUID();

  try {
    context.db
      .insert(users)
      .values({
        id,
        phoneNumber: input.phoneNumber ?? fallbackPhoneNumber(id),
        username: input.username,
        displayName: input.displayName ?? input.username,
        email: input.email,
        role: input.role,
        notificationsEnabled: readSettings(context).defaultNotificationsEnabled,
        createdByUserId: admin.id,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run();
  } catch (error) {
    console.error("[Hermes] Failed to create user", error);
    return { ok: false, status: 409, error: "user_existiert_bereits" };
  }

  const created = context.db.select().from(users).where(eq(users.id, id)).get();
  if (!created) {
    return { ok: false, status: 409, error: "user_existiert_bereits" };
  }

  tryWriteAuditLog(context, {
    actor: admin,
    action: "user.create",
    entityType: "user",
    entityId: id,
    summary: `${admin.username} hat User ${input.username} angelegt.`,
    metadata: {
      username: input.username,
      displayName: input.displayName ?? input.username,
      email: input.email,
      role: input.role
    }
  });

  return { ok: true, user: created };
}

export function updateUser(
  context: DatabaseContext,
  admin: Actor | undefined,
  userId: string,
  patch: UpdateInput
): UpdateUserResult {
  const existing = context.db.select().from(users).where(eq(users.id, userId)).get();
  if (!existing) {
    return { ok: false, status: 404, error: "user_nicht_gefunden" };
  }

  if (patch.username !== undefined || patch.email !== undefined) {
    const identityCheck = ensureActiveIdentityAvailable(
      context,
      {
        username: patch.username ?? existing.username,
        email: patch.email ?? existing.email
      },
      { excludeUserId: existing.id }
    );
    if (!identityCheck.ok) {
      return { ok: false, status: 409, error: identityCheck.error };
    }
  }

  const shouldRevokeSessions =
    (patch.role !== undefined && patch.role !== existing.role) ||
    (patch.email !== undefined && patch.email !== existing.email);

  try {
    const updatedAt = nowIso();
    context.sqlite.transaction(() => {
      context.db
        .update(users)
        .set({ ...patch, updatedAt })
        .where(eq(users.id, existing.id))
        .run();

      if (shouldRevokeSessions) {
        context.db
          .update(sessions)
          .set({ revokedAt: updatedAt })
          .where(eq(sessions.userId, existing.id))
          .run();
      }
    })();
  } catch (error) {
    console.error("[Hermes] Failed to update user", error);
    return { ok: false, status: 409, error: "user_update_konflikt" };
  }

  const updated = context.db.select().from(users).where(eq(users.id, existing.id)).get();
  if (!updated) {
    return { ok: false, status: 404, error: "user_nicht_gefunden" };
  }

  tryWriteAuditLog(context, {
    actor: admin,
    action: "user.update",
    entityType: "user",
    entityId: existing.id,
    summary: `${admin?.username ?? "Admin"} hat User ${existing.username} aktualisiert.`,
    metadata: patch
  });

  return { ok: true, user: updated };
}

export function softDeleteUser(
  context: DatabaseContext,
  admin: Actor,
  userId: string
): SoftDeleteResult {
  const existing = context.db.select().from(users).where(eq(users.id, userId)).get();

  if (!existing || existing.deletedAt) {
    return { ok: false, status: 404, error: "user_nicht_gefunden" };
  }

  if (existing.id === admin.id) {
    return { ok: false, status: 409, error: "eigener_user_nicht_loeschbar" };
  }

  const timestamp = nowIso();

  context.sqlite.transaction(() => {
    context.db.delete(participations).where(eq(participations.userId, existing.id)).run();
    context.db
      .update(pushSubscriptions)
      .set({ revokedAt: timestamp })
      .where(eq(pushSubscriptions.userId, existing.id))
      .run();
    context.db
      .update(sessions)
      .set({ revokedAt: timestamp })
      .where(eq(sessions.userId, existing.id))
      .run();
    // Device names are personal data; drop them with the account (sessions keep a NULL device_id).
    context.db.delete(devices).where(eq(devices.userId, existing.id)).run();
    context.db
      .update(users)
      .set({
        phoneNumber: `deleted:${existing.id}`,
        username: `deleted-${existing.id.slice(0, 8)}`,
        email: `deleted-${existing.id}@deleted.hermes.local`,
        role: "user",
        notificationsEnabled: false,
        deletedAt: timestamp,
        updatedAt: timestamp
      })
      .where(eq(users.id, existing.id))
      .run();
  })();

  tryWriteAuditLog(context, {
    actor: admin,
    action: "user.delete",
    entityType: "user",
    entityId: existing.id,
    summary: `${admin.username} hat User ${existing.username} gelöscht.`,
    metadata: { username: existing.username, email: existing.email }
  });

  return { ok: true };
}
