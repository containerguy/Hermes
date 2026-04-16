import { asc, desc, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireCsrf } from "../auth/csrf";
import { publicUser, requireAdmin, requireUser } from "../auth/current-user";
import { listAuditLogs, maskInviteCode, tryWriteAuditLog } from "../audit-log";
import {
  addRateLimitAllowlist,
  clearRateLimitBlock,
  deleteRateLimitAllowlist,
  listRateLimitAllowlist,
  listRateLimitEntries
} from "../auth/rate-limits";
import type { DatabaseContext } from "../db/client";
import { inviteCodes, participations, pushSubscriptions, sessions, users } from "../db/schema";
import { ensureActiveEmailAvailable, userRoleSchema } from "../domain/users";
import {
  getS3LocationDetails,
  getStorageBackend,
  persistDatabaseSnapshot,
  readBackupStatus,
  RestoreValidationError,
  restoreDatabaseSnapshotIntoLive,
  toSafeRestoreDiagnostics
} from "../storage/s3-storage";
import { readSettings, settingsSchema, writeSettings } from "../settings";

const createUserSchema = z.object({
  phoneNumber: z.string().trim().min(3).max(40).optional(),
  username: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email().max(160),
  role: userRoleSchema.default("user")
});

const updateUserSchema = z.object({
  phoneNumber: z.string().trim().min(3).max(40).optional(),
  username: z.string().trim().min(1).max(80).optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email().max(160).optional(),
  role: userRoleSchema.optional(),
  notificationsEnabled: z.boolean().optional()
});

const createInviteCodeSchema = z.object({
  code: z.string().trim().min(1).max(80).optional(),
  customCode: z.string().trim().min(1).max(80).optional(),
  label: z.string().trim().min(1).max(120),
  maxUses: z.number().int().min(1).max(500).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional()
});

const updateInviteCodeSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  maxUses: z.number().int().min(1).max(500).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional()
});

const allowlistSchema = z.object({
  ipOrCidr: z.string().trim().min(1).max(80),
  note: z.string().trim().min(1).max(200).optional()
});

function nowIso() {
  return new Date().toISOString();
}

function fallbackPhoneNumber(userId: string) {
  return `user:${userId}`;
}

function normalizeInviteCode(code: string) {
  return code.trim().toUpperCase();
}

function generateInviteCode() {
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

function serializeInviteCode(context: DatabaseContext, invite: typeof inviteCodes.$inferSelect) {
  const row = context.sqlite
    .prepare("SELECT COUNT(*) AS count FROM invite_code_uses WHERE invite_code_id = ?")
    .get(invite.id) as { count: number };

  return {
    ...invite,
    usedCount: row.count
  };
}

function getInviteUsedCount(context: DatabaseContext, inviteCodeId: string) {
  const row = context.sqlite
    .prepare("SELECT COUNT(*) AS count FROM invite_code_uses WHERE invite_code_id = ?")
    .get(inviteCodeId) as { count: number };
  return row.count;
}

export function createAdminRouter(context: DatabaseContext) {
  const router = Router();

  router.use((request, response, next) => {
    const user = requireUser(context, request);

    if (!user) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    if (user.role !== "admin") {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    next();
  });

  router.use((request, response, next) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
      if (!requireCsrf(context, request, response)) {
        return;
      }
    }
    next();
  });

  router.get("/users", (_request, response) => {
    const allUsers = context.db
      .select()
      .from(users)
      .where(isNull(users.deletedAt))
      .orderBy(asc(users.username))
      .all();
    response.json({ users: allUsers.map(publicUser) });
  });

  router.get("/audit-log", (request, response) => {
    const limit = Number(request.query.limit ?? "100");
    response.json({ auditLogs: listAuditLogs(context, limit) });
  });

  router.get("/rate-limits", (request, response) => {
    const admin = requireAdmin(context, request);
    const entries = listRateLimitEntries(context);
    tryWriteAuditLog(context, {
      actor: admin,
      action: "rate_limits.list",
      entityType: "rate_limit_entries",
      entityId: null,
      summary: `${admin?.username ?? "Admin"} hat Rate-Limits angezeigt.`,
      metadata: { count: entries.length }
    });
    response.json({ rateLimits: entries });
  });

  router.delete("/rate-limits/:id", (request, response) => {
    const admin = requireAdmin(context, request);
    clearRateLimitBlock(context, request.params.id);
    tryWriteAuditLog(context, {
      actor: admin,
      action: "rate_limits.clear",
      entityType: "rate_limit_entry",
      entityId: request.params.id,
      summary: `${admin?.username ?? "Admin"} hat ein Rate-Limit gelöscht.`
    });
    response.json({ ok: true });
  });

  router.get("/rate-limits/allowlist", (request, response) => {
    const admin = requireAdmin(context, request);
    const allowlist = listRateLimitAllowlist(context);
    tryWriteAuditLog(context, {
      actor: admin,
      action: "rate_limits.allowlist_list",
      entityType: "rate_limit_allowlist",
      entityId: null,
      summary: `${admin?.username ?? "Admin"} hat die Rate-Limit-Allowlist angezeigt.`,
      metadata: { count: allowlist.length }
    });
    response.json({ allowlist });
  });

  router.post("/rate-limits/allowlist", (request, response) => {
    const admin = requireAdmin(context, request);
    const parsed = allowlistSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_allowlist_eintrag" });
      return;
    }

    const id = addRateLimitAllowlist(context, {
      ipOrCidr: parsed.data.ipOrCidr,
      note: parsed.data.note ?? null
    });

    tryWriteAuditLog(context, {
      actor: admin,
      action: "rate_limits.allowlist_add",
      entityType: "rate_limit_allowlist",
      entityId: id,
      summary: `${admin?.username ?? "Admin"} hat einen Allowlist-Eintrag hinzugefügt.`,
      metadata: { note: parsed.data.note ?? null }
    });

    response.status(201).json({ ok: true, id });
  });

  router.delete("/rate-limits/allowlist/:id", (request, response) => {
    const admin = requireAdmin(context, request);
    deleteRateLimitAllowlist(context, request.params.id);
    tryWriteAuditLog(context, {
      actor: admin,
      action: "rate_limits.allowlist_delete",
      entityType: "rate_limit_allowlist",
      entityId: request.params.id,
      summary: `${admin?.username ?? "Admin"} hat einen Allowlist-Eintrag gelöscht.`
    });
    response.json({ ok: true });
  });

  router.post("/users", (request, response) => {
    const admin = requireAdmin(context, request);
    const parsed = createUserSchema.safeParse(request.body);

    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_user" });
      return;
    }

    const emailCheck = ensureActiveEmailAvailable(context, parsed.data.email);
    if (!emailCheck.ok) {
      response.status(409).json({ error: emailCheck.error });
      return;
    }

    const timestamp = nowIso();
    const id = randomUUID();

    try {
      context.db
        .insert(users)
        .values({
          id,
          phoneNumber: parsed.data.phoneNumber ?? fallbackPhoneNumber(id),
          username: parsed.data.username,
          displayName: parsed.data.displayName ?? parsed.data.username,
          email: parsed.data.email,
          role: parsed.data.role,
          notificationsEnabled: readSettings(context).defaultNotificationsEnabled,
          createdByUserId: admin.id,
          createdAt: timestamp,
          updatedAt: timestamp
        })
        .run();
    } catch (error) {
      console.error("[Hermes] Failed to create user", error);
      response.status(409).json({ error: "user_existiert_bereits" });
      return;
    }

    const created = context.db.select().from(users).where(eq(users.id, id)).get();
    tryWriteAuditLog(context, {
      actor: admin,
      action: "user.create",
      entityType: "user",
      entityId: id,
      summary: `${admin.username} hat User ${parsed.data.username} angelegt.`,
      metadata: {
        username: parsed.data.username,
        displayName: parsed.data.displayName ?? parsed.data.username,
        email: parsed.data.email,
        role: parsed.data.role
      }
    });
    response.status(201).json({ user: created ? publicUser(created) : undefined });
  });

  router.patch("/users/:id", (request, response) => {
    const parsed = updateUserSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_user" });
      return;
    }

    const existing = context.db.select().from(users).where(eq(users.id, request.params.id)).get();

    if (!existing) {
      response.status(404).json({ error: "user_nicht_gefunden" });
      return;
    }

    if (parsed.data.email !== undefined) {
      const emailCheck = ensureActiveEmailAvailable(context, parsed.data.email, {
        excludeUserId: existing.id
      });
      if (!emailCheck.ok) {
        response.status(409).json({ error: emailCheck.error });
        return;
      }
    }

    const shouldRevokeSessions =
      (parsed.data.role !== undefined && parsed.data.role !== existing.role) ||
      (parsed.data.email !== undefined && parsed.data.email !== existing.email);

    try {
      const updatedAt = nowIso();
      context.sqlite.transaction(() => {
        context.db
          .update(users)
          .set({
            ...parsed.data,
            updatedAt
          })
          .where(eq(users.id, existing.id))
          .run();

        if (shouldRevokeSessions) {
          context.db
            .update(sessions)
            .set({ revokedAt: updatedAt })
            .where(eq(sessions.userId, existing.id))
            .run();
        }
      })();
    } catch (error) {
      console.error("[Hermes] Failed to update user", error);
      response.status(409).json({ error: "user_update_konflikt" });
      return;
    }

    const updated = context.db.select().from(users).where(eq(users.id, existing.id)).get();
    const admin = requireAdmin(context, request);
    tryWriteAuditLog(context, {
      actor: admin,
      action: "user.update",
      entityType: "user",
      entityId: existing.id,
      summary: `${admin?.username ?? "Admin"} hat User ${existing.username} aktualisiert.`,
      metadata: parsed.data
    });
    response.json({ user: updated ? publicUser(updated) : undefined });
  });

  router.delete("/users/:id", (request, response) => {
    const admin = requireAdmin(context, request);
    const existing = context.db.select().from(users).where(eq(users.id, request.params.id)).get();

    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    if (!existing || existing.deletedAt) {
      response.status(404).json({ error: "user_nicht_gefunden" });
      return;
    }

    if (existing.id === admin.id) {
      response.status(409).json({ error: "eigener_user_nicht_loeschbar" });
      return;
    }

    const timestamp = nowIso();

    context.sqlite.transaction(() => {
      context.db
        .delete(participations)
        .where(eq(participations.userId, existing.id))
        .run();
      context.db
        .update(pushSubscriptions)
        .set({ revokedAt: timestamp })
        .where(eq(pushSubscriptions.userId, existing.id))
        .run();
      context.db
        .update(sessions)
        .set({ revokedAt: timestamp })
        .where(eq(sessions.userId, existing.id))
        .run();
      context.db
        .update(users)
        .set({
          phoneNumber: `deleted:${existing.id}`,
          username: `deleted-${existing.id.slice(0, 8)}`,
          email: `deleted-${existing.id}@deleted.hermes.local`,
          role: "user",
          notificationsEnabled: false,
          deletedAt: timestamp,
          updatedAt: timestamp
        })
        .where(eq(users.id, existing.id))
        .run();
    })();

    tryWriteAuditLog(context, {
      actor: admin,
      action: "user.delete",
      entityType: "user",
      entityId: existing.id,
      summary: `${admin.username} hat User ${existing.username} gelöscht.`,
      metadata: { username: existing.username, email: existing.email }
    });

    response.status(204).send();
  });

  router.get("/settings", (_request, response) => {
    const backend = getStorageBackend();
    const location = getS3LocationDetails();
    let backupStatus = null;
    try {
      backupStatus = readBackupStatus(context.sqlite);
    } catch (error) {
      console.error("[Hermes] Failed to read backup status", error);
      backupStatus = null;
    }

    response.json({
      settings: readSettings(context),
      storage: {
        backend,
        location,
        backupStatus: backupStatus
          ? {
              lastSuccessAt: backupStatus.lastSuccessAt,
              lastFailureAt: backupStatus.lastFailureAt,
              failureCode: backupStatus.failureCode,
              failureSummary: backupStatus.failureSummary
            }
          : null
      }
    });
  });

  router.get("/invite-codes", (_request, response) => {
    const invites = context.db
      .select()
      .from(inviteCodes)
      .orderBy(desc(inviteCodes.createdAt))
      .all();

    response.json({ inviteCodes: invites.map((invite) => serializeInviteCode(context, invite)) });
  });

  router.post("/invite-codes", (request, response) => {
    const admin = requireAdmin(context, request);
    const parsed = createInviteCodeSchema.safeParse(request.body);

    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_invite_code" });
      return;
    }

    if (parsed.data.code !== undefined || parsed.data.customCode !== undefined) {
      response.status(400).json({ error: "invite_code_custom_deaktiviert" });
      return;
    }

    const timestamp = nowIso();
    const id = randomUUID();
    const code = normalizeInviteCode(generateInviteCode());
    const maxUses = parsed.data.maxUses === undefined ? 300 : parsed.data.maxUses;
    const expiresAt =
      parsed.data.expiresAt === undefined
        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        : parsed.data.expiresAt;

    try {
      context.db
        .insert(inviteCodes)
        .values({
          id,
          code,
          label: parsed.data.label,
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
      response.status(409).json({ error: "invite_code_existiert" });
      return;
    }

    const created = context.db.select().from(inviteCodes).where(eq(inviteCodes.id, id)).get();
    tryWriteAuditLog(context, {
      actor: admin,
      action: "invite.create",
      entityType: "invite_code",
      entityId: id,
      summary: `${admin.username} hat Invite ${parsed.data.label} erstellt.`,
      metadata: {
        inviteCodeId: id,
        inviteLabel: parsed.data.label,
        inviteMaskedCode: maskInviteCode(code),
        maxUses,
        expiresAt
      }
    });
    response.status(201).json({
      inviteCode: created ? serializeInviteCode(context, created) : undefined
    });
  });

  router.patch("/invite-codes/:id", (request, response) => {
    const admin = requireAdmin(context, request);
    const parsed = updateInviteCodeSchema.safeParse(request.body);

    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_invite_code" });
      return;
    }

    const existing = context.db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.id, request.params.id))
      .get();

    if (!existing) {
      response.status(404).json({ error: "invite_code_nicht_gefunden" });
      return;
    }

    const usedCount = getInviteUsedCount(context, existing.id);
    if (
      parsed.data.maxUses !== undefined &&
      parsed.data.maxUses !== null &&
      parsed.data.maxUses < usedCount
    ) {
      response.status(409).json({ error: "invite_max_uses_unter_used_count" });
      return;
    }

    context.db
      .update(inviteCodes)
      .set({ ...parsed.data, updatedAt: nowIso() })
      .where(eq(inviteCodes.id, existing.id))
      .run();

    const updated = context.db.select().from(inviteCodes).where(eq(inviteCodes.id, existing.id)).get();
    tryWriteAuditLog(context, {
      actor: admin,
      action: "invite.update",
      entityType: "invite_code",
      entityId: existing.id,
      summary: `${admin.username} hat Invite ${existing.label} aktualisiert.`,
      metadata: {
        inviteCodeId: existing.id,
        inviteLabel: updated?.label ?? existing.label,
        inviteMaskedCode: maskInviteCode(existing.code),
        changes: parsed.data
      }
    });

    response.json({
      inviteCode: updated ? serializeInviteCode(context, updated) : undefined
    });
  });

  router.post("/invite-codes/:id/deactivate", (request, response) => {
    const admin = requireAdmin(context, request);
    const invite = context.db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.id, request.params.id))
      .get();

    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    if (!invite) {
      response.status(404).json({ error: "invite_code_nicht_gefunden" });
      return;
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
    response.json({ inviteCode: updated ? serializeInviteCode(context, updated) : undefined });
  });

  router.post("/invite-codes/:id/reactivate", (request, response) => {
    const admin = requireAdmin(context, request);
    const invite = context.db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.id, request.params.id))
      .get();

    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    if (!invite) {
      response.status(404).json({ error: "invite_code_nicht_gefunden" });
      return;
    }

    const now = nowIso();
    if (invite.expiresAt && invite.expiresAt < now) {
      response.status(409).json({ error: "invite_abgelaufen" });
      return;
    }

    const usedCount = getInviteUsedCount(context, invite.id);
    if (invite.maxUses !== null && usedCount >= invite.maxUses) {
      response.status(409).json({ error: "invite_ausgeschoepft" });
      return;
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
    response.json({ inviteCode: updated ? serializeInviteCode(context, updated) : undefined });
  });

  router.delete("/invite-codes/:id", (request, response) => {
    const admin = requireAdmin(context, request);
    const invite = context.db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.id, request.params.id))
      .get();

    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    if (!invite) {
      response.status(404).json({ error: "invite_code_nicht_gefunden" });
      return;
    }

    const usedCount = getInviteUsedCount(context, invite.id);
    if (usedCount > 0) {
      response.status(409).json({ error: "invite_hat_nutzungen" });
      return;
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

    response.status(204).send();
  });

  router.put("/settings", (request, response) => {
    const admin = requireAdmin(context, request);
    const parsed = settingsSchema.partial().safeParse(request.body);

    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_settings" });
      return;
    }

    writeSettings(context, settingsSchema.parse({ ...readSettings(context), ...parsed.data }), admin.id);
    tryWriteAuditLog(context, {
      actor: admin,
      action: "settings.update",
      entityType: "settings",
      entityId: "app",
      summary: `${admin.username} hat Einstellungen gespeichert.`,
      metadata: parsed.data
    });
    response.json({ settings: readSettings(context) });
  });

  router.post("/backup", async (request, response) => {
    const admin = requireAdmin(context, request);

    try {
      await persistDatabaseSnapshot(context.sqlite);
      tryWriteAuditLog(context, {
        actor: admin,
        action: "storage.backup",
        entityType: "storage",
        entityId: "s3",
        summary: `${admin?.username ?? "Admin"} hat ein S3-Backup erstellt.`
      });
      response.json({ ok: true, message: "backup_erstellt" });
    } catch (error) {
      console.error("[Hermes] Failed to create admin backup", error);
      response.status(500).json({ error: "backup_fehlgeschlagen" });
    }
  });

  router.post("/restore", async (request, response) => {
    const admin = requireAdmin(context, request);

    try {
      const result = await restoreDatabaseSnapshotIntoLive(context.sqlite);
      tryWriteAuditLog(context, {
        action: "storage.restore",
        entityType: "storage",
        entityId: "s3",
        summary: `${admin?.username ?? "Admin"} hat ein S3-Restore ausgeführt.`
      });
      response.json({
        ok: true,
        message: "restore_abgeschlossen",
        recovery: result?.recovery ?? null,
        restoredFrom: result?.restoredFrom ?? null
      });
    } catch (error) {
      console.error("[Hermes] Failed to restore admin backup", error);
      const diagnostics = toSafeRestoreDiagnostics(error);
      if (error instanceof RestoreValidationError) {
        response.status(400).json({ error: "restore_fehlgeschlagen", diagnostics });
        return;
      }
      response.status(500).json({ error: "restore_fehlgeschlagen", diagnostics });
    }
  });

  return router;
}
