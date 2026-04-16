import type { Response } from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";

export const SESSION_COOKIE = "hermes_session";
export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

export function createSessionId() {
  return randomUUID();
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function setSessionCookie(response: Response, token: string) {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.HERMES_COOKIE_SECURE === "true",
    maxAge: SESSION_MAX_AGE_MS,
    path: "/"
  });
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.HERMES_COOKIE_SECURE === "true",
    path: "/"
  });
}
