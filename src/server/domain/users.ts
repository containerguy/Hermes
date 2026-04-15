import { z } from "zod";

export const userRoleSchema = z.enum(["user", "manager", "admin"]);

export type UserRole = z.infer<typeof userRoleSchema>;

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
