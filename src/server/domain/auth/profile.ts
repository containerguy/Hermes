import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { tryWriteAuditLog } from "../../audit-log";
import { generateOtp, hashOtp, verifyOtp } from "../../auth/otp";
import type { DatabaseContext } from "../../db/client";
import { emailChangeChallenges, sessions, users } from "../../db/schema";
import { ensureActiveEmailAvailable } from "../users";
import { sendEmailChangeCode } from "../../mail/mailer";

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type CurrentAuth = { user: UserRow; session: SessionRow };

export const profileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    locale: z.union([z.enum(["de", "en"]), z.null()]).optional()
  })
  .refine((data) => data.displayName !== undefined || data.locale !== undefined, {
    message: "leerer_profil_patch"
  });

export const emailChangeSchema = z
  .object({
    newEmail: z.string().trim().email().max(160).optional(),
    email: z.string().trim().email().max(160).optional()
  })
  .refine((value) => Boolean(value.newEmail ?? value.email), { message: "newEmail required" });

export const emailChangeVerifySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/)
});

type ProfilePatch = z.infer<typeof profileSchema>;
type EmailChangeInput = z.infer<typeof emailChangeSchema>;

function nowIso() {
  return new Date().toISOString();
}

export function updateProfile(
  context: DatabaseContext,
  current: CurrentAuth,
  patch: ProfilePatch
): UserRow {
  const timestamp = nowIso();
  const update: { displayName?: string; locale?: string | null; updatedAt: string } = {
    updatedAt: timestamp
  };
  if (patch.displayName !== undefined) update.displayName = patch.displayName;
  if (patch.locale !== undefined) update.locale = patch.locale;

  context.db.update(users).set(update).where(eq(users.id, current.user.id)).run();

  const updated = context.db.select().from(users).where(eq(users.id, current.user.id)).get();
  tryWriteAuditLog(context, {
    actor: current.user,
    action: "user.profile_update",
    entityType: "user",
    entityId: current.user.id,
    summary: `${current.user.username} hat sein Profil aktualisiert.`,
    metadata: { displayName: patch.displayName, locale: patch.locale }
  });

  return updated ?? current.user;
}

export type EmailChangeRequestResult =
  | { ok: true }
  | { ok: false; status: 409 | 502; error: string };

export async function requestEmailChange(
  context: DatabaseContext,
  current: CurrentAuth,
  input: EmailChangeInput
): Promise<EmailChangeRequestResult> {
  const newEmail = (input.newEmail ?? input.email ?? "").trim();
  const emailCheck = ensureActiveEmailAvailable(context, newEmail, {
    excludeUserId: current.user.id
  });
  if (!emailCheck.ok) {
    return { ok: false, status: 409, error: emailCheck.error };
  }

  const timestamp = nowIso();
  const challengeId = randomUUID();
  const code = process.env.HERMES_DEV_LOGIN_CODE ?? generateOtp();

  context.sqlite.transaction(() => {
    context.db
      .delete(emailChangeChallenges)
      .where(
        and(
          eq(emailChangeChallenges.userId, current.user.id),
          lt(emailChangeChallenges.expiresAt, timestamp)
        )
      )
      .run();

    context.db
      .update(emailChangeChallenges)
      .set({ consumedAt: timestamp })
      .where(
        and(
          eq(emailChangeChallenges.userId, current.user.id),
          isNull(emailChangeChallenges.consumedAt)
        )
      )
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
    return { ok: false, status: 502, error: "mailversand_fehlgeschlagen" };
  }

  return { ok: true };
}

export type EmailChangeVerifyResult =
  | { ok: true; user: UserRow }
  | { ok: false; status: 401 | 409; error: string };

export function verifyEmailChange(
  context: DatabaseContext,
  current: CurrentAuth,
  code: string
): EmailChangeVerifyResult {
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

  if (!challenge || !verifyOtp(code, challenge.codeHash)) {
    return { ok: false, status: 401, error: "code_abgelehnt" };
  }

  const emailCheck = ensureActiveEmailAvailable(context, challenge.newEmail, {
    excludeUserId: current.user.id
  });
  if (!emailCheck.ok) {
    return { ok: false, status: 409, error: emailCheck.error };
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

  return { ok: true, user: updated ?? current.user };
}
