import type { Request, Response } from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";

export const SESSION_COOKIE = "hermes_session";
export const DEVICE_COOKIE = "hermes_device";

const DAY_MS = 1000 * 60 * 60 * 24;
const DEFAULT_SESSION_TTL_DAYS = 180;
/** Browsers (Chrome) cap cookie lifetimes at 400 days. */
const MAX_COOKIE_DAYS = 400;
/** The session cookie is re-issued at most once per interval (sliding expiration). */
export const SESSION_RENEW_INTERVAL_MS = DAY_MS;
export const DEVICE_COOKIE_MAX_AGE_MS = MAX_COOKIE_DAYS * DAY_MS;
export const DEVICE_KEY_PATTERN = /^[A-Za-z0-9_-]{22,44}$/;

/**
 * Idle timeout for sessions: a session expires when it has not been used for this long.
 * Every use within the window extends it again (cookie renewal + `lastSeenAt`).
 */
export function getSessionTtlMs() {
  const raw = Number.parseInt(process.env.HERMES_SESSION_TTL_DAYS ?? "", 10);
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_COOKIE_DAYS) : DEFAULT_SESSION_TTL_DAYS;
  return days * DAY_MS;
}

export function isSessionIdleExpired(lastSeenAt: string, now = Date.now()) {
  const lastSeen = Date.parse(lastSeenAt);
  if (Number.isNaN(lastSeen)) {
    return true;
  }
  return now - lastSeen > getSessionTtlMs();
}

export function sessionIdleCutoffIso(now = Date.now()) {
  return new Date(now - getSessionTtlMs()).toISOString();
}

export function createSessionId() {
  return randomUUID();
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function cookieSecure() {
  return process.env.HERMES_COOKIE_SECURE === "true";
}

export function setSessionCookie(response: Response, token: string) {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    maxAge: getSessionTtlMs(),
    path: "/"
  });
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/"
  });
}

/**
 * Long-lived, server-set device cookie. It only identifies the browser for device-name
 * persistence; it never authenticates on its own (a login code or pairing token is
 * always required). Server-set cookies survive Safari's 7-day purge of script storage.
 */
export function setDeviceCookie(response: Response, deviceKey: string) {
  response.cookie(DEVICE_COOKIE, deviceKey, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    maxAge: DEVICE_COOKIE_MAX_AGE_MS,
    path: "/"
  });
}

export function clearDeviceCookie(response: Response) {
  response.clearCookie(DEVICE_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/"
  });
}

export function readDeviceCookie(request: Request): string | undefined {
  const value = request.cookies?.[DEVICE_COOKIE];
  return typeof value === "string" && DEVICE_KEY_PATTERN.test(value) ? value : undefined;
}

export function createDeviceKey() {
  return randomBytes(16).toString("base64url");
}
