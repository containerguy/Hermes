import { and, eq, isNull } from "drizzle-orm";
import type { Request } from "express";
import { SESSION_COOKIE } from "./sessions";
import type { DatabaseContext } from "../db/client";
import { sessions, users } from "../db/schema";

function nowIso() {
  return new Date().toISOString();
}

export function publicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    phoneNumber: user.phoneNumber,
    username: user.username,
    email: user.email,
    role: user.role,
    notificationsEnabled: user.notificationsEnabled,
    deletedAt: user.deletedAt
  };
}

export function getCurrentSession(context: DatabaseContext, request: Request) {
  const token = request.cookies?.[SESSION_COOKIE] as string | undefined;

  if (!token) {
    return undefined;
  }

  const result = context.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, token), isNull(sessions.revokedAt)))
    .get();

  if (!result || result.user.deletedAt) {
    return undefined;
  }

  context.db
    .update(sessions)
    .set({ lastSeenAt: nowIso() })
    .where(eq(sessions.id, result.session.id))
    .run();

  return result;
}

export function requireUser(context: DatabaseContext, request: Request) {
  const current = getCurrentSession(context, request);

  if (!current) {
    return undefined;
  }

  return current.user;
}

export function requireAdmin(context: DatabaseContext, request: Request) {
  const user = requireUser(context, request);

  if (!user || user.role !== "admin") {
    return undefined;
  }

  return user;
}
