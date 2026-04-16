import { z } from "zod";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { DatabaseContext } from "../db/client";
import { users } from "../db/schema";

export const userRoleSchema = z.enum(["user", "manager", "admin"]);

export type UserRole = z.infer<typeof userRoleSchema>;

export function findActiveUserByEmail(context: DatabaseContext, email: string) {
  return context.db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .get();
}

export function ensureActiveEmailAvailable(
  context: DatabaseContext,
  email: string,
  options?: { excludeUserId?: string }
) {
  const found = options?.excludeUserId
    ? context.db
        .select()
        .from(users)
        .where(
          and(eq(users.email, email), isNull(users.deletedAt), ne(users.id, options.excludeUserId))
        )
        .get()
    : findActiveUserByEmail(context, email);

  if (found) {
    return { ok: false as const, error: "email_existiert_bereits" as const };
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
  return actor.role === "admin" || actor.role === "manager";
}

export function canAssignRoles(actor: { role: UserRole }) {
  return actor.role === "admin";
}
