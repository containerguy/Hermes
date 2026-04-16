import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createCsrfToken, CSRF_HEADER, requireCsrf } from "../auth/csrf";
import { getCurrentSession, publicUser } from "../auth/current-user";
import { resolveDeviceName, validateDeviceName } from "../auth/device-names";
import { maskInviteCode, tryWriteAuditLog } from "../audit-log";
import { checkRateLimit, recordRateLimitFailure } from "../auth/rate-limits";
import {
  createSessionId,
  createSessionToken,
  clearSessionCookie,
  hashSessionToken,
  setSessionCookie
} from "../auth/sessions";
import { generateOtp, hashOtp, verifyOtp } from "../auth/otp";
import type { DatabaseContext } from "../db/client";
import { emailChangeChallenges, inviteCodes, inviteCodeUses, loginChallenges, sessions, users } from "../db/schema";
import { ensureActiveEmailAvailable } from "../domain/users";
import { sendEmailChangeCode, sendLoginCode } from "../mail/mailer";
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

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80)
});

const emailChangeSchema = z
  .object({
    newEmail: z.string().trim().email().max(160).optional(),
    email: z.string().trim().email().max(160).optional()
  })
  .refine((value) => Boolean(value.newEmail ?? value.email), { message: "newEmail required" });

const emailChangeVerifySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/)
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

function getInviteRegisterRateLimitKey(input: { sourceIp?: string; inviteCode?: string }) {
  const ip = input.sourceIp ?? "";
  const normalized = input.inviteCode ? normalizeInviteCode(input.inviteCode) : "";
  return `ip:${ip}|invite:${normalized}`;
}

class InviteExhaustedError extends Error {
  constructor() {
    super("invite_exhausted");
  }
}

class InviteInvalidError extends Error {
  constructor() {
    super("invite_invalid");
  }
}

function isSqliteBusyOrLocked(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") return false;
  return code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED");
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
  const csrfExemptPaths = new Set(["/request-code", "/verify-code", "/register"]);

  router.use((request, response, next) => {
    if (
      ["POST", "PATCH", "PUT", "DELETE"].includes(request.method) &&
      !csrfExemptPaths.has(request.path)
    ) {
      if (!requireCsrf(context, request, response)) {
        return;
      }
    }
    next();
  });

  router.get("/csrf", (request, response) => {
    const current = getCurrentSession(context, request);

    if (!current) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    response.json({ token: createCsrfToken(current.session.id), header: CSRF_HEADER });
  });

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
    const registerKey = getInviteRegisterRateLimitKey({
      sourceIp: request.ip,
      inviteCode:
        typeof (request.body as { inviteCode?: unknown } | undefined)?.inviteCode === "string"
          ? (request.body as { inviteCode: string }).inviteCode
          : undefined
    });
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

    if (!settings.publicRegistrationEnabled) {
      recordRateLimitFailure(context, { scope: "invite_register", key: registerKey });
      response.status(403).json({ error: "registrierung_deaktiviert" });
      return;
    }

    if (!parsed.success) {
      recordRateLimitFailure(context, { scope: "invite_register", key: registerKey });
      response.status(400).json({ error: "ungueltige_registrierung" });
      return;
    }

    const emailCheck = ensureActiveEmailAvailable(context, parsed.data.email);
    if (!emailCheck.ok) {
      recordRateLimitFailure(context, { scope: "invite_register", key: registerKey });
      response.status(409).json({ error: emailCheck.error });
      return;
    }

    const normalizedCode = normalizeInviteCode(parsed.data.inviteCode);
    const invite = context.db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.code, normalizedCode))
      .get();

    const timestamp = nowIso();
    if (!invite || invite.revokedAt || (invite.expiresAt && invite.expiresAt < timestamp)) {
      recordRateLimitFailure(context, { scope: "invite_register", key: registerKey });
      response.status(403).json({ error: "invite_ungueltig" });
      return;
    }

    const userId = randomUUID();

    const registerInvitedUser = () => {
      return context.sqlite
        .transaction(() => {
          const transactionTimestamp = nowIso();
          const freshInvite = context.db
            .select()
            .from(inviteCodes)
            .where(eq(inviteCodes.id, invite.id))
            .get();

          if (
            !freshInvite ||
            freshInvite.revokedAt ||
            (freshInvite.expiresAt && freshInvite.expiresAt < transactionTimestamp)
          ) {
            throw new InviteInvalidError();
          }

          const usesRow = context.sqlite
            .prepare("SELECT COUNT(*) AS count FROM invite_code_uses WHERE invite_code_id = ?")
            .get(freshInvite.id) as { count: number };

          if (freshInvite.maxUses !== null && usesRow.count >= freshInvite.maxUses) {
            throw new InviteExhaustedError();
          }

          context.db
            .insert(users)
            .values({
              id: userId,
              phoneNumber: fallbackPhoneNumber(userId),
              username: parsed.data.username,
              displayName: parsed.data.username,
              email: parsed.data.email,
              role: "user",
              notificationsEnabled: settings.defaultNotificationsEnabled,
              createdByUserId: freshInvite.createdByUserId,
              deletedAt: null,
              createdAt: transactionTimestamp,
              updatedAt: transactionTimestamp
            })
            .run();

          context.db
            .insert(inviteCodeUses)
            .values({
              id: randomUUID(),
              inviteCodeId: freshInvite.id,
              userId,
              usedAt: transactionTimestamp
            })
            .run();

          const remainingUses =
            freshInvite.maxUses === null ? null : Math.max(0, freshInvite.maxUses - (usesRow.count + 1));

          return { remainingUses };
        })
        .immediate();
    };

    try {
      let result: { remainingUses: number | null } | undefined;
      try {
        result = registerInvitedUser();
      } catch (error) {
        if (isSqliteBusyOrLocked(error)) {
          try {
            result = registerInvitedUser();
          } catch (retryError) {
            if (isSqliteBusyOrLocked(retryError)) {
              console.error("[Hermes] Invite registration failed after retry (sqlite busy/locked)", retryError);
              recordRateLimitFailure(context, { scope: "invite_register", key: registerKey });
              response.status(500).json({ error: "registrierung_fehlgeschlagen" });
              return;
            }
            throw retryError;
          }
        } else {
          throw error;
        }
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

      const responseBody: Record<string, unknown> = {
        user: publicUser(created),
        codeSent: true
      };
      if (typeof result?.remainingUses === "number") {
        responseBody.remainingUses = result.remainingUses;
      }

      response.status(201).json({
        ...responseBody
      });
      return;
    } catch (error) {
      if (error instanceof InviteInvalidError) {
        recordRateLimitFailure(context, { scope: "invite_register", key: registerKey });
        response.status(403).json({ error: "invite_ungueltig" });
        return;
      }

      if (error instanceof InviteExhaustedError) {
        tryWriteAuditLog(context, {
          action: "auth.register_rejected",
          entityType: "invite_code",
          entityId: invite.id,
          summary: `Registrierung mit ausgeschöpftem Invite abgelehnt.`,
          metadata: {
            inviteCodeId: invite.id,
            inviteLabel: invite.label,
            maskedInviteCode: maskInviteCode(normalizedCode),
            username: parsed.data.username,
            sourceIp: request.ip ?? null
          }
        });

        recordRateLimitFailure(context, { scope: "invite_register", key: registerKey });
        response.status(403).json({ error: "invite_ausgeschoepft" });
        return;
      }

      console.error("[Hermes] Failed to register invited user", error);
      recordRateLimitFailure(context, { scope: "invite_register", key: registerKey });
      response.status(409).json({ error: "user_existiert_bereits" });
      return;
    }
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

    const sessionId = createSessionId();
    const sessionToken = createSessionToken();
    const sessionTokenHash = hashSessionToken(sessionToken);
    const resolvedDeviceName = resolveDeviceName(
      parsed.data.deviceName,
      request.get("user-agent") ?? undefined
    );

    context.sqlite.transaction(() => {
      context.db
        .update(loginChallenges)
        .set({ consumedAt: timestamp })
        .where(eq(loginChallenges.id, challenge.id))
        .run();

      context.db
        .insert(sessions)
        .values({
          id: sessionId,
          userId: user.id,
          deviceName: resolvedDeviceName,
          userAgent: request.get("user-agent") ?? null,
          lastSeenAt: timestamp,
          createdAt: timestamp,
          tokenHash: sessionTokenHash,
          revokedAt: null
        })
        .run();
    })();

    tryWriteAuditLog(context, {
      actor: user,
      action: "auth.login",
      entityType: "session",
      entityId: sessionId,
      summary: `${user.username} hat sich angemeldet.`,
      metadata: {
        deviceName: resolvedDeviceName
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

  router.patch("/profile", (request, response) => {
    const current = getCurrentSession(context, request);

    if (!current) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_profilname" });
      return;
    }

    const timestamp = nowIso();
    context.db
      .update(users)
      .set({ displayName: parsed.data.displayName, updatedAt: timestamp })
      .where(eq(users.id, current.user.id))
      .run();

    const updated = context.db.select().from(users).where(eq(users.id, current.user.id)).get();
    tryWriteAuditLog(context, {
      actor: current.user,
      action: "user.profile_update",
      entityType: "user",
      entityId: current.user.id,
      summary: `${current.user.username} hat sein Profil aktualisiert.`,
      metadata: { displayName: parsed.data.displayName }
    });

    response.json({ user: updated ? publicUser(updated) : publicUser(current.user) });
  });

  router.post("/email-change", async (request, response) => {
    const current = getCurrentSession(context, request);

    if (!current) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    const parsed = emailChangeSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_email" });
      return;
    }

    const newEmail = (parsed.data.newEmail ?? parsed.data.email ?? "").trim();
    const emailCheck = ensureActiveEmailAvailable(context, newEmail, { excludeUserId: current.user.id });
    if (!emailCheck.ok) {
      response.status(409).json({ error: emailCheck.error });
      return;
    }

    const timestamp = nowIso();
    const challengeId = randomUUID();
    const code = process.env.HERMES_DEV_LOGIN_CODE ?? generateOtp();

    context.sqlite.transaction(() => {
      context.db
        .delete(emailChangeChallenges)
        .where(and(eq(emailChangeChallenges.userId, current.user.id), lt(emailChangeChallenges.expiresAt, timestamp)))
        .run();

      context.db
        .update(emailChangeChallenges)
        .set({ consumedAt: timestamp })
        .where(and(eq(emailChangeChallenges.userId, current.user.id), isNull(emailChangeChallenges.consumedAt)))
        .run();

      context.db
        .insert(emailChangeChallenges)
        .values({
          id: challengeId,
          userId: current.user.id,
          newEmail,
          codeHash: hashOtp(code),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          consumedAt: null,
          sentAt: null,
          createdAt: timestamp
        })
        .run();
    })();

    try {
      await sendEmailChangeCode({ to: newEmail, username: current.user.username, code });
      context.db
        .update(emailChangeChallenges)
        .set({ sentAt: nowIso() })
        .where(eq(emailChangeChallenges.id, challengeId))
        .run();
    } catch (error) {
      console.error("[Hermes] Failed to send email-change code", error);
      response.status(502).json({ error: "mailversand_fehlgeschlagen" });
      return;
    }

    response.status(202).json({ ok: true });
  });

  router.post("/email-change/verify", (request, response) => {
    const current = getCurrentSession(context, request);

    if (!current) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    const parsed = emailChangeVerifySchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_code" });
      return;
    }

    const timestamp = nowIso();
    const challenge = context.db
      .select()
      .from(emailChangeChallenges)
      .where(
        and(
          eq(emailChangeChallenges.userId, current.user.id),
          isNull(emailChangeChallenges.consumedAt),
          gt(emailChangeChallenges.expiresAt, timestamp)
        )
      )
      .orderBy(desc(emailChangeChallenges.createdAt))
      .get();

    if (!challenge || !verifyOtp(parsed.data.code, challenge.codeHash)) {
      response.status(401).json({ error: "code_abgelehnt" });
      return;
    }

    const emailCheck = ensureActiveEmailAvailable(context, challenge.newEmail, {
      excludeUserId: current.user.id
    });
    if (!emailCheck.ok) {
      response.status(409).json({ error: emailCheck.error });
      return;
    }

    context.sqlite.transaction(() => {
      context.db
        .update(users)
        .set({ email: challenge.newEmail, updatedAt: timestamp })
        .where(eq(users.id, current.user.id))
        .run();

      context.db
        .update(emailChangeChallenges)
        .set({ consumedAt: timestamp })
        .where(eq(emailChangeChallenges.id, challenge.id))
        .run();

      context.db
        .update(sessions)
        .set({ revokedAt: timestamp })
        .where(eq(sessions.userId, current.user.id))
        .run();
    })();

    const updated = context.db.select().from(users).where(eq(users.id, current.user.id)).get();
    const domain = challenge.newEmail.split("@", 2)[1] ?? null;
    tryWriteAuditLog(context, {
      actor: current.user,
      action: "user.email_change_confirm",
      entityType: "user",
      entityId: current.user.id,
      summary: `${current.user.username} hat seine E-Mail-Adresse aktualisiert.`,
      metadata: domain ? { newEmailDomain: domain } : undefined
    });

    response.json({ user: updated ? publicUser(updated) : publicUser(current.user) });
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

  router.patch("/sessions/:id", (request, response) => {
    const current = getCurrentSession(context, request);

    if (!current) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    const parsed = z.object({ deviceName: z.string() }).safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_geraetename" });
      return;
    }

    const validated = validateDeviceName(parsed.data.deviceName);
    if (!validated.ok) {
      response.status(400).json({ error: validated.error });
      return;
    }

    const target = context.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, request.params.id), eq(sessions.userId, current.user.id), isNull(sessions.revokedAt)))
      .get();

    if (!target) {
      response.status(404).json({ error: "session_nicht_gefunden" });
      return;
    }

    context.db
      .update(sessions)
      .set({ deviceName: validated.name })
      .where(eq(sessions.id, target.id))
      .run();

    const updated = context.db.select().from(sessions).where(eq(sessions.id, target.id)).get();

    tryWriteAuditLog(context, {
      actor: current.user,
      action: "auth.session_rename",
      entityType: "session",
      entityId: target.id,
      summary: `${current.user.username} hat ein Gerät umbenannt.`,
      metadata: { deviceName: validated.name, current: target.id === current.session.id }
    });

    response.json({
      session: updated
        ? {
            id: updated.id,
            deviceName: updated.deviceName,
            userAgent: updated.userAgent,
            lastSeenAt: updated.lastSeenAt,
            createdAt: updated.createdAt,
            current: updated.id === current.session.id
          }
        : undefined
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
    const current = getCurrentSession(context, request);

    if (current) {
      context.db
        .update(sessions)
        .set({ revokedAt: nowIso() })
        .where(eq(sessions.id, current.session.id))
        .run();
    }

    if (current) {
      tryWriteAuditLog(context, {
        actor: current.user,
        action: "auth.logout",
        entityType: "session",
        entityId: current.session.id,
        summary: `${current.user.username} hat sich abgemeldet.`
      });
    }

    clearSessionCookie(response);
    response.status(204).send();
  });

  return router;
}
