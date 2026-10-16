import { and, eq, isNull } from "drizzle-orm";
import type { Request, Response } from "express";
import type { DatabaseContext } from "../db/client";
import { sessions, userApiTokens, users } from "../db/schema";
import {
  hashSessionToken,
  isSessionIdleExpired,
  readDeviceCookie,
  SESSION_COOKIE,
  SESSION_RENEW_INTERVAL_MS,
  setDeviceCookie,
  setSessionCookie
} from "./sessions";

export type HermesRequestAuth =
  | {
      kind: "session";
      session: typeof sessions.$inferSelect;
      user: typeof users.$inferSelect;
    }
  | {
      kind: "api_token";
      tokenId: string;
      scope: "full" | "read_only";
      user: typeof users.$inferSelect;
    };

declare global {
  namespace Express {
    interface Request {
      /** Set by `resolveHermesAuth` after first access in a request. */
      hermesAuth?: HermesRequestAuth;
      /** When true, `hermesAuth` (or anonymous) was resolved. */
      hermesAuthLoaded?: boolean;
    }
  }
}

function nowIso() {
  return new Date().toISOString();
}

function parseBearerToken(request: Request): string | undefined {
  const raw = request.get("authorization");
  if (!raw || typeof raw !== "string") {
    return undefined;
  }
  const match = raw.match(/^\s*Bearer\s+(.+)\s*$/i);
  if (!match?.[1]) {
    return undefined;
  }
  const token = match[1].trim();
  return token.length > 0 ? token : undefined;
}

function resolveApiToken(context: DatabaseContext, request: Request, rawToken: string) {
  const tokenHash = hashSessionToken(rawToken);
  const row = context.db
    .select({ token: userApiTokens, user: users })
    .from(userApiTokens)
    .innerJoin(users, eq(userApiTokens.userId, users.id))
    .where(
      and(eq(userApiTokens.tokenHash, tokenHash), isNull(userApiTokens.revokedAt), isNull(users.deletedAt))
    )
    .get();

  if (!row) {
    return;
  }

  const stamp = nowIso();
  context.db
    .update(userApiTokens)
    .set({ lastUsedAt: stamp })
    .where(eq(userApiTokens.id, row.token.id))
    .run();

  request.hermesAuth = {
    kind: "api_token",
    tokenId: row.token.id,
    scope: row.token.scope,
    user: row.user
  };
}

function resolveSessionCookie(context: DatabaseContext, request: Request) {
  const token = request.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) {
    return;
  }

  const tokenHash = hashSessionToken(token);
  const result = context.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
    .get();

  if (!result || result.user.deletedAt) {
    return;
  }

  if (isSessionIdleExpired(result.session.lastSeenAt)) {
    return;
  }

  context.db
    .update(sessions)
    .set({ lastSeenAt: nowIso() })
    .where(eq(sessions.id, result.session.id))
    .run();

  request.hermesAuth = {
    kind: "session",
    session: result.session,
    user: result.user
  };
}

/**
 * Resolves cookie session or Bearer API token once per request.
 */
export function resolveHermesAuth(context: DatabaseContext, request: Request) {
  if (request.hermesAuthLoaded) {
    return;
  }
  request.hermesAuthLoaded = true;

  const bearer = parseBearerToken(request);
  if (bearer) {
    resolveApiToken(context, request, bearer);
    return;
  }

  resolveSessionCookie(context, request);
}

/**
 * Sliding expiration: re-issue the session cookie (and the device cookie) at most once
 * per renew interval, so an actively used session never runs into the cookie max-age.
 */
function renewSessionCookieIfDue(context: DatabaseContext, request: Request, response: Response) {
  const auth = request.hermesAuth;
  if (auth?.kind !== "session") {
    return;
  }
  const token = request.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) {
    return;
  }

  const lastRenewal = Date.parse(auth.session.renewedAt ?? auth.session.createdAt);
  if (!Number.isNaN(lastRenewal) && Date.now() - lastRenewal < SESSION_RENEW_INTERVAL_MS) {
    return;
  }

  context.db
    .update(sessions)
    .set({ renewedAt: nowIso() })
    .where(eq(sessions.id, auth.session.id))
    .run();
  setSessionCookie(response, token);

  const deviceKey = readDeviceCookie(request);
  if (deviceKey && auth.session.deviceId) {
    setDeviceCookie(response, deviceKey);
  }
}

export function hermesAuthMiddleware(context: DatabaseContext) {
  return (request: Request, response: Response, next: () => void) => {
    resolveHermesAuth(context, request);
    renewSessionCookieIfDue(context, request, response);
    next();
  };
}

export function isApiTokenReadOnly(request: Request): boolean {
  return request.hermesAuth?.kind === "api_token" && request.hermesAuth.scope === "read_only";
}

export function enforceApiTokenWriteAccess(request: Request, response: import("express").Response) {
  if (!isApiTokenReadOnly(request)) {
    return true;
  }
  response.status(403).json({ error: "api_token_nur_lesen" });
  return false;
}
