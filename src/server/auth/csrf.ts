import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { DatabaseContext } from "../db/client";
import { getCurrentSession } from "./current-user";

export const CSRF_HEADER = "x-hermes-csrf";

function csrfSecret() {
  return process.env.HERMES_CSRF_SECRET ?? "hermes-dev-csrf-secret";
}

export function createCsrfToken(sessionId: string) {
  return createHmac("sha256", csrfSecret()).update(sessionId).digest("base64url");
}

export function verifyCsrfToken(sessionId: string, token: string | undefined) {
  if (!token) {
    return false;
  }

  const expected = createCsrfToken(sessionId);

  if (expected.length !== token.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

export function requireCsrf(context: DatabaseContext, request: Request, response: Response) {
  const current = getCurrentSession(context, request);

  if (!current) {
    response.status(401).json({ error: "nicht_angemeldet" });
    return false;
  }

  const token = request.get(CSRF_HEADER) ?? undefined;

  if (!verifyCsrfToken(current.session.id, token)) {
    response.status(403).json({ error: "csrf_token_ungueltig" });
    return false;
  }

  return true;
}

