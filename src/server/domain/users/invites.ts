import { desc, eq } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { maskInviteCode, tryWriteAuditLog } from "../../audit-log";
import type { DatabaseContext } from "../../db/client";
import { inviteCodes } from "../../db/schema";

type Actor = { id: string; username: string };
type InviteRow = typeof inviteCodes.$inferSelect;
type SerializedInvite = InviteRow & { usedCount: number };

export const createInviteCodeSchema = z.object({
  code: z.string().trim().min(1).max(80).optional(),
  customCode: z.string().trim().min(1).max(80).optional(),
  label: z.string().trim().min(1).max(120),
  maxUses: z.number().int().min(1).max(500).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional()
});

export const updateInviteCodeSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  maxUses: z.number().int().min(1).max(500).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional()
});

type CreateInput = z.infer<typeof createInviteCodeSchema>;
type UpdateInput = z.infer<typeof updateInviteCodeSchema>;

function nowIso() {
  return new Date().toISOString();
}

export function normalizeInviteCode(code: string) {
  return code.trim().toUpperCase();
}

export function generateInviteCode() {
  // 10 random bytes = 80 bits entropy; encoded as 16 Crockford-base32 characters.
  const bytes = randomBytes(10);
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(buffer >> bits) & 31] ?? "0";
    }
  }

  if (bits > 0) {
    out += alphabet[(buffer << (5 - bits)) & 31] ?? "0";
  }

  return out.slice(0, 16);
}

export function getInviteUsedCount(context: DatabaseContext, inviteCodeId: string) {
  const row = context.sqlite
    .prepare("SELECT COUNT(*) AS count FROM invite_code_uses WHERE invite_code_id = ?")
    .get(inviteCodeId) as { count: number };
  return row.count;
}

export function serializeInviteCode(context: DatabaseContext, invite: InviteRow): SerializedInvite {
  return {
    ...invite,
    usedCount: getInviteUsedCount(context, invite.id)
  };
}

export function listInviteCodes(context: DatabaseContext): SerializedInvite[] {
  const invites = context.db
    .select()
    .from(inviteCodes)
    .orderBy(desc(inviteCodes.createdAt))
    .all();
  return invites.map((invite) => serializeInviteCode(context, invite));
}

export type InviteCreateResult =
  | { ok: true; invite: SerializedInvite }
  | { ok: false; status: 400 | 409; error: string };

export function createInviteCodeService(
  context: DatabaseContext,
  admin: Actor,
  input: CreateInput
): InviteCreateResult {
  if (input.code !== undefined || input.customCode !== undefined) {
    return { ok: false, status: 400, error: "invite_code_custom_deaktiviert" };
  }

  const timestamp = nowIso();
  const id = randomUUID();
  const code = normalizeInviteCode(generateInviteCode());
  const maxUses = input.maxUses === undefined ? 300 : input.maxUses;
  const expiresAt =
    input.expiresAt === undefined
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : input.expiresAt;

  try {
    context.db
      .insert(inviteCodes)
      .values({
        id,
        code,
        label: input.label,
        maxUses,
        expiresAt,
        revokedAt: null,
        createdByUserId: admin.id,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run();
  } catch (error) {
    console.error("[Hermes] Failed to create invite code", error);
    return { ok: false, status: 409, error: "invite_code_existiert" };
  }

  const created = context.db.select().from(inviteCodes).where(eq(inviteCodes.id, id)).get();
  if (!created) {
    return { ok: false, status: 409, error: "invite_code_existiert" };
  }

  tryWriteAuditLog(context, {
    actor: admin,
    action: "invite.create",
    entityType: "invite_code",
    entityId: id,
    summary: `${admin.username} hat Invite ${input.label} erstellt.`,
    metadata: {
      inviteCodeId: id,
      inviteLabel: input.label,
      inviteMaskedCode: maskInviteCode(code),
      maxUses,
      expiresAt
    }
  });

  return { ok: true, invite: serializeInviteCode(context, created) };
}

export type InviteUpdateResult =
  | { ok: true; invite: SerializedInvite }
  | { ok: false; status: 404 | 409; error: string };

export function updateInviteCodeService(
  context: DatabaseContext,
  admin: Actor,
  inviteId: string,
  patch: UpdateInput
): InviteUpdateResult {
  const existing = context.db.select().from(inviteCodes).where(eq(inviteCodes.id, inviteId)).get();
  if (!existing) {
    return { ok: false, status: 404, error: "invite_code_nicht_gefunden" };
  }

  const usedCount = getInviteUsedCount(context, existing.id);
  if (patch.maxUses !== undefined && patch.maxUses !== null && patch.maxUses < usedCount) {
    return { ok: false, status: 409, error: "invite_max_uses_unter_used_count" };
  }

  context.db
    .update(inviteCodes)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(inviteCodes.id, existing.id))
    .run();

  const updated = context.db.select().from(inviteCodes).where(eq(inviteCodes.id, existing.id)).get();
  if (!updated) {
    return { ok: false, status: 404, error: "invite_code_nicht_gefunden" };
  }

  tryWriteAuditLog(context, {
    actor: admin,
    action: "invite.update",
    entityType: "invite_code",
    entityId: existing.id,
    summary: `${admin.username} hat Invite ${existing.label} aktualisiert.`,
    metadata: {
      inviteCodeId: existing.id,
      inviteLabel: updated.label,
      inviteMaskedCode: maskInviteCode(existing.code),
      changes: patch
    }
  });

  return { ok: true, invite: serializeInviteCode(context, updated) };
}

export type InviteStatusResult =
  | { ok: true; invite: SerializedInvite }
  | { ok: false; status: 404 | 409; error: string };

export function deactivateInviteCodeService(
  context: DatabaseContext,
  admin: Actor,
  inviteId: string
): InviteStatusResult {
  const invite = context.db.select().from(inviteCodes).where(eq(inviteCodes.id, inviteId)).get();
  if (!invite) {
    return { ok: false, status: 404, error: "invite_code_nicht_gefunden" };
  }

  const timestamp = nowIso();
  const revokedAt = invite.revokedAt ?? timestamp;
  context.db
    .update(inviteCodes)
    .set({ revokedAt, updatedAt: timestamp })
    .where(eq(inviteCodes.id, invite.id))
    .run();

  tryWriteAuditLog(context, {
    actor: admin,
    action: "invite.deactivate",
    entityType: "invite_code",
    entityId: invite.id,
    summary: `${admin.username} hat Invite ${invite.label} deaktiviert.`,
    metadata: {
      inviteCodeId: invite.id,
      inviteLabel: invite.label,
      inviteMaskedCode: maskInviteCode(invite.code)
    }
  });

  const updated = context.db.select().from(inviteCodes).where(eq(inviteCodes.id, invite.id)).get();
  return { ok: true, invite: serializeInviteCode(context, updated ?? invite) };
}

export function reactivateInviteCodeService(
  context: DatabaseContext,
  admin: Actor,
  inviteId: string
): InviteStatusResult {
  const invite = context.db.select().from(inviteCodes).where(eq(inviteCodes.id, inviteId)).get();
  if (!invite) {
    return { ok: false, status: 404, error: "invite_code_nicht_gefunden" };
  }

  const now = nowIso();
  if (invite.expiresAt && invite.expiresAt < now) {
    return { ok: false, status: 409, error: "invite_abgelaufen" };
  }

  const usedCount = getInviteUsedCount(context, invite.id);
  if (invite.maxUses !== null && usedCount >= invite.maxUses) {
    return { ok: false, status: 409, error: "invite_ausgeschoepft" };
  }

  context.db
    .update(inviteCodes)
    .set({ revokedAt: null, updatedAt: nowIso() })
    .where(eq(inviteCodes.id, invite.id))
    .run();

  tryWriteAuditLog(context, {
    actor: admin,
    action: "invite.reactivate",
    entityType: "invite_code",
    entityId: invite.id,
    summary: `${admin.username} hat Invite ${invite.label} reaktiviert.`,
    metadata: {
      inviteCodeId: invite.id,
      inviteLabel: invite.label,
      inviteMaskedCode: maskInviteCode(invite.code)
    }
  });

  const updated = context.db.select().from(inviteCodes).where(eq(inviteCodes.id, invite.id)).get();
  return { ok: true, invite: serializeInviteCode(context, updated ?? invite) };
}

export type InviteDeleteResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string };

export function deleteUnusedInviteCodeService(
  context: DatabaseContext,
  admin: Actor,
  inviteId: string
): InviteDeleteResult {
  const invite = context.db.select().from(inviteCodes).where(eq(inviteCodes.id, inviteId)).get();
  if (!invite) {
    return { ok: false, status: 404, error: "invite_code_nicht_gefunden" };
  }

  const usedCount = getInviteUsedCount(context, invite.id);
  if (usedCount > 0) {
    return { ok: false, status: 409, error: "invite_hat_nutzungen" };
  }

  context.db.delete(inviteCodes).where(eq(inviteCodes.id, invite.id)).run();

  tryWriteAuditLog(context, {
    actor: admin,
    action: "invite.delete_unused",
    entityType: "invite_code",
    entityId: invite.id,
    summary: `${admin.username} hat Invite ${invite.label} gelöscht.`,
    metadata: {
      inviteCodeId: invite.id,
      inviteLabel: invite.label,
      inviteMaskedCode: maskInviteCode(invite.code)
    }
  });

  return { ok: true };
}
