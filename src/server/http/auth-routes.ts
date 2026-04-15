import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCurrentSession, publicUser } from "../auth/current-user";
import {
  createSessionToken,
  clearSessionCookie,
  SESSION_COOKIE,
  setSessionCookie
} from "../auth/sessions";
import { generateOtp, hashOtp, verifyOtp } from "../auth/otp";
import type { DatabaseContext } from "../db/client";
import { loginChallenges, sessions, users } from "../db/schema";
import { sendLoginCode } from "../mail/mailer";

const requestCodeSchema = z.object({
  phoneNumber: z.string().trim().min(3).max(40),
  username: z.string().trim().min(1).max(80)
});

const verifyCodeSchema = requestCodeSchema.extend({
  code: z.string().trim().regex(/^\d{6}$/),
  deviceName: z.string().trim().max(120).optional()
});

function nowIso() {
  return new Date().toISOString();
}

export function createAuthRouter(context: DatabaseContext) {
  const router = Router();

  router.post("/request-code", async (request, response) => {
    const parsed = requestCodeSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_login_daten" });
      return;
    }

    const user = context.db
      .select()
      .from(users)
      .where(
        and(
          eq(users.phoneNumber, parsed.data.phoneNumber),
          eq(users.username, parsed.data.username)
        )
      )
      .get();

    if (!user) {
      response.status(404).json({ error: "user_nicht_gefunden" });
      return;
    }

    const code = process.env.HERMES_DEV_LOGIN_CODE ?? generateOtp();
    const timestamp = nowIso();
    const challengeId = randomUUID();

    context.db
      .insert(loginChallenges)
      .values({
        id: challengeId,
        phoneNumber: user.phoneNumber,
        username: user.username,
        email: user.email,
        codeHash: hashOtp(code),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        consumedAt: null,
        sentAt: null,
        createdAt: timestamp
      })
      .run();

    try {
      await sendLoginCode({ to: user.email, username: user.username, code });
    } catch (error) {
      console.error("[Hermes] Failed to send login code", error);
      response.status(502).json({ error: "mailversand_fehlgeschlagen" });
      return;
    }

    context.db
      .update(loginChallenges)
      .set({ sentAt: nowIso() })
      .where(eq(loginChallenges.id, challengeId))
      .run();

    response.status(202).json({ ok: true });
  });

  router.post("/verify-code", (request, response) => {
    const parsed = verifyCodeSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_code" });
      return;
    }

    const timestamp = nowIso();
    const challenge = context.db
      .select()
      .from(loginChallenges)
      .where(
        and(
          eq(loginChallenges.phoneNumber, parsed.data.phoneNumber),
          eq(loginChallenges.username, parsed.data.username),
          isNull(loginChallenges.consumedAt),
          gt(loginChallenges.expiresAt, timestamp)
        )
      )
      .orderBy(desc(loginChallenges.createdAt))
      .get();

    if (!challenge || !verifyOtp(parsed.data.code, challenge.codeHash)) {
      response.status(401).json({ error: "code_abgelehnt" });
      return;
    }

    const user = context.db
      .select()
      .from(users)
      .where(
        and(
          eq(users.phoneNumber, parsed.data.phoneNumber),
          eq(users.username, parsed.data.username)
        )
      )
      .get();

    if (!user) {
      response.status(401).json({ error: "code_abgelehnt" });
      return;
    }

    const sessionToken = createSessionToken();

    context.sqlite.transaction(() => {
      context.db
        .update(loginChallenges)
        .set({ consumedAt: timestamp })
        .where(eq(loginChallenges.id, challenge.id))
        .run();

      context.db
        .insert(sessions)
        .values({
          id: sessionToken,
          userId: user.id,
          deviceName: parsed.data.deviceName ?? null,
          userAgent: request.get("user-agent") ?? null,
          lastSeenAt: timestamp,
          createdAt: timestamp,
          revokedAt: null
        })
        .run();
    })();

    setSessionCookie(response, sessionToken);
    response.json({ user: publicUser(user) });
  });

  router.get("/me", (request, response) => {
    const current = getCurrentSession(context, request);

    if (!current) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    response.json({ user: publicUser(current.user) });
  });

  router.post("/logout", (request, response) => {
    const token = request.cookies?.[SESSION_COOKIE];

    if (token) {
      context.db
        .update(sessions)
        .set({ revokedAt: nowIso() })
        .where(eq(sessions.id, token))
        .run();
    }

    clearSessionCookie(response);
    response.status(204).send();
  });

  return router;
}
