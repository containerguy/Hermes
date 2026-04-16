import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCurrentSession, publicUser } from "../auth/current-user";
import { tryWriteAuditLog } from "../audit-log";
import { checkRateLimit, recordRateLimitFailure } from "../auth/rate-limits";
import {
  createSessionToken,
  clearSessionCookie,
  SESSION_COOKIE,
  setSessionCookie
} from "../auth/sessions";
import { generateOtp, hashOtp, verifyOtp } from "../auth/otp";
import type { DatabaseContext } from "../db/client";
import { inviteCodes, inviteCodeUses, loginChallenges, sessions, users } from "../db/schema";
import { sendLoginCode } from "../mail/mailer";
import { readSettings } from "../settings";

const requestCodeSchema = z.object({
  username: z.string().trim().min(1).max(80)
});

const verifyCodeSchema = requestCodeSchema.extend({
  code: z.string().trim().regex(/^\d{6}$/),
  deviceName: z.string().trim().max(120).optional()
});

const registerSchema = z.object({
  inviteCode: z.string().trim().min(1).max(80),
  username: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(160)
});

function nowIso() {
  return new Date().toISOString();
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function fallbackPhoneNumber(userId: string) {
  return `user:${userId}`;
}

function normalizeInviteCode(code: string) {
  return code.trim().toUpperCase();
}

function issueLoginChallenge(context: DatabaseContext, user: typeof users.$inferSelect) {
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

  return { challengeId, code };
}

async function sendIssuedLoginCode(
  context: DatabaseContext,
  user: typeof users.$inferSelect,
  issued: { challengeId: string; code: string }
) {
  await sendLoginCode({ to: user.email, username: user.username, code: issued.code });

  context.db
    .update(loginChallenges)
    .set({ sentAt: nowIso() })
    .where(eq(loginChallenges.id, issued.challengeId))
    .run();
}

export function createAuthRouter(context: DatabaseContext) {
  const router = Router();

  router.post("/request-code", async (request, response) => {
    const parsed = requestCodeSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_login_daten" });
      return;
    }

    const usernameKey = normalizeUsername(parsed.data.username);
    const requestKey = `username:${usernameKey}|ip:${request.ip ?? ""}`;
    const rateLimit = checkRateLimit(context, {
      scope: "login_request",
      key: requestKey,
      sourceIp: request.ip
    });

    if (!rateLimit.ok) {
      response.status(429).json({
        error: rateLimit.error,
        retryAfterSeconds: rateLimit.retryAfterSeconds
      });
      return;
    }

    recordRateLimitFailure(context, { scope: "login_request", key: requestKey });

    const user = context.db
      .select()
      .from(users)
      .where(and(eq(users.username, parsed.data.username), isNull(users.deletedAt)))
      .get();

    if (!user) {
      tryWriteAuditLog(context, {
        action: "auth.request_unknown",
        entityType: "user",
        entityId: null,
        summary: `Unbekannter Login-Code-Request für ${usernameKey}.`,
        metadata: { username: usernameKey.slice(0, 3) + "***" }
      });
      response.status(202).json({ ok: true });
      return;
    }

    const timestamp = nowIso();
    const issued = context.sqlite.transaction(() => {
      context.db
        .delete(loginChallenges)
        .where(and(eq(loginChallenges.username, user.username), lt(loginChallenges.expiresAt, timestamp)))
        .run();

      context.db
        .update(loginChallenges)
        .set({ consumedAt: timestamp })
        .where(and(eq(loginChallenges.username, user.username), isNull(loginChallenges.consumedAt)))
        .run();

      return issueLoginChallenge(context, user);
    })();

    try {
      await sendIssuedLoginCode(context, user, issued);
    } catch (error) {
      console.error("[Hermes] Failed to send login code", error);
      response.status(502).json({ error: "mailversand_fehlgeschlagen" });
      return;
    }

    response.status(202).json({ ok: true });
  });

  router.post("/register", async (request, response) => {
    const settings = readSettings(context);
    const parsed = registerSchema.safeParse(request.body);

    if (!settings.publicRegistrationEnabled) {
      response.status(403).json({ error: "registrierung_deaktiviert" });
      return;
    }

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_registrierung" });
      return;
    }

    const usernameKey = normalizeUsername(parsed.data.username);
    const registerKey = `username:${usernameKey}|ip:${request.ip ?? ""}`;
    const registerRateLimit = checkRateLimit(context, {
      scope: "invite_register",
      key: registerKey,
      sourceIp: request.ip
    });
    if (!registerRateLimit.ok) {
      response.status(429).json({
        error: registerRateLimit.error,
        retryAfterSeconds: registerRateLimit.retryAfterSeconds
      });
      return;
    }
    recordRateLimitFailure(context, { scope: "invite_register", key: registerKey });

    const timestamp = nowIso();
    const normalizedCode = normalizeInviteCode(parsed.data.inviteCode);
    const invite = context.db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.code, normalizedCode))
      .get();

    if (!invite || invite.revokedAt || (invite.expiresAt && invite.expiresAt < timestamp)) {
      response.status(403).json({ error: "invite_ungueltig" });
      return;
    }

    const uses = context.db
      .select()
      .from(inviteCodeUses)
      .where(eq(inviteCodeUses.inviteCodeId, invite.id))
      .all();

    if (invite.maxUses !== null && uses.length >= invite.maxUses) {
      response.status(403).json({ error: "invite_ausgeschoepft" });
      return;
    }

    const userId = randomUUID();

    try {
      context.sqlite.transaction(() => {
        context.db
          .insert(users)
          .values({
            id: userId,
            phoneNumber: fallbackPhoneNumber(userId),
            username: parsed.data.username,
            email: parsed.data.email,
            role: "user",
            notificationsEnabled: settings.defaultNotificationsEnabled,
            createdByUserId: invite.createdByUserId,
            deletedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp
          })
          .run();

        context.db
          .insert(inviteCodeUses)
          .values({
            id: randomUUID(),
            inviteCodeId: invite.id,
            userId,
            usedAt: timestamp
          })
          .run();
      })();
    } catch (error) {
      console.error("[Hermes] Failed to register invited user", error);
      response.status(409).json({ error: "user_existiert_bereits" });
      return;
    }

    const created = context.db.select().from(users).where(eq(users.id, userId)).get();

    if (!created) {
      response.status(500).json({ error: "registrierung_fehlgeschlagen" });
      return;
    }

    const issued = issueLoginChallenge(context, created);

    try {
      await sendIssuedLoginCode(context, created, issued);
    } catch (error) {
      console.error("[Hermes] Failed to send registration login code", error);
      response.status(502).json({ error: "mailversand_fehlgeschlagen" });
      return;
    }

    tryWriteAuditLog(context, {
      actor: created,
      action: "auth.register",
      entityType: "user",
      entityId: created.id,
      summary: `${created.username} hat sich mit Invite ${invite.label} registriert.`,
      metadata: { inviteCodeId: invite.id, inviteLabel: invite.label }
    });

    response.status(201).json({ user: publicUser(created), codeSent: true });
  });

  router.post("/verify-code", (request, response) => {
    const parsed = verifyCodeSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_code" });
      return;
    }

    const usernameKey = normalizeUsername(parsed.data.username);
    const verifyKey = `username:${usernameKey}|ip:${request.ip ?? ""}`;
    const verifyRateLimit = checkRateLimit(context, {
      scope: "login_verify",
      key: verifyKey,
      sourceIp: request.ip
    });
    if (!verifyRateLimit.ok) {
      response.status(429).json({
        error: verifyRateLimit.error,
        retryAfterSeconds: verifyRateLimit.retryAfterSeconds
      });
      return;
    }

    const timestamp = nowIso();
    const challenge = context.db
      .select()
      .from(loginChallenges)
      .where(
        and(
          eq(loginChallenges.username, parsed.data.username),
          isNull(loginChallenges.consumedAt),
          gt(loginChallenges.expiresAt, timestamp)
        )
      )
      .orderBy(desc(loginChallenges.createdAt))
      .get();

    if (!challenge || !verifyOtp(parsed.data.code, challenge.codeHash)) {
      recordRateLimitFailure(context, { scope: "login_verify", key: verifyKey });
      response.status(401).json({ error: "code_abgelehnt" });
      return;
    }

    const user = context.db
      .select()
      .from(users)
      .where(and(eq(users.username, parsed.data.username), isNull(users.deletedAt)))
      .get();

    if (!user) {
      recordRateLimitFailure(context, { scope: "login_verify", key: verifyKey });
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

    tryWriteAuditLog(context, {
      actor: user,
      action: "auth.login",
      entityType: "session",
      entityId: sessionToken,
      summary: `${user.username} hat sich angemeldet.`,
      metadata: {
        deviceName: parsed.data.deviceName ?? null
      }
    });
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

  router.get("/sessions", (request, response) => {
    const current = getCurrentSession(context, request);

    if (!current) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    const userSessions = context.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, current.user.id), isNull(sessions.revokedAt)))
      .orderBy(desc(sessions.lastSeenAt))
      .all();

    response.json({
      sessions: userSessions.map((session) => ({
        id: session.id,
        deviceName: session.deviceName,
        userAgent: session.userAgent,
        lastSeenAt: session.lastSeenAt,
        createdAt: session.createdAt,
        current: session.id === current.session.id
      }))
    });
  });

  router.delete("/sessions/:id", (request, response) => {
    const current = getCurrentSession(context, request);

    if (!current) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    const target = context.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, request.params.id), eq(sessions.userId, current.user.id)))
      .get();

    if (!target) {
      response.status(404).json({ error: "session_nicht_gefunden" });
      return;
    }

    context.db
      .update(sessions)
      .set({ revokedAt: nowIso() })
      .where(eq(sessions.id, target.id))
      .run();

    tryWriteAuditLog(context, {
      actor: current.user,
      action: "auth.session_revoke",
      entityType: "session",
      entityId: target.id,
      summary: `${current.user.username} hat ein Gerät abgemeldet.`,
      metadata: { deviceName: target.deviceName, current: target.id === current.session.id }
    });

    if (target.id === current.session.id) {
      clearSessionCookie(response);
    }

    response.json({ revokedCurrent: target.id === current.session.id });
  });

  router.post("/logout", (request, response) => {
    const token = request.cookies?.[SESSION_COOKIE];
    const current = getCurrentSession(context, request);

    if (token) {
      context.db
        .update(sessions)
        .set({ revokedAt: nowIso() })
        .where(eq(sessions.id, token))
        .run();
    }

    if (current) {
      tryWriteAuditLog(context, {
        actor: current.user,
        action: "auth.logout",
        entityType: "session",
        entityId: token,
        summary: `${current.user.username} hat sich abgemeldet.`
      });
    }

    clearSessionCookie(response);
    response.status(204).send();
  });

  return router;
}
