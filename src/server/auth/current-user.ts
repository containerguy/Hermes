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

  if (!user || user.role !== "admin") {
    return undefined;
  }

  return user;
}
