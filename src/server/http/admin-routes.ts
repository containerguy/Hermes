import { asc, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { requireCsrf } from "../auth/csrf";
import { publicUser, requireAdmin, requireUser } from "../auth/current-user";
import { enforceApiTokenWriteAccess } from "../auth/hermes-auth";
import { listAuditLogs, tryWriteAuditLog } from "../audit-log";
import {
  addRateLimitAllowlist,
  clearRateLimitBlock,
  deleteRateLimitAllowlist,
  listRateLimitAllowlist,
  listRateLimitEntries
} from "../auth/rate-limits";
import type { DatabaseContext } from "../db/client";
import { gameEvents, users } from "../db/schema";
import {
  analyzeBulkImport,
  buildBulkImportAuditMetadata,
  buildBulkImportResponse,
  bulkImportRequestSchema,
  bulkImportRowSchema,
  commitBulkImportAnalysis
} from "../domain/users/bulk-import";
import {
  createInviteCodeSchema,
  createInviteCodeService,
  deactivateInviteCodeService,
  deleteUnusedInviteCodeService,
  listInviteCodes,
  reactivateInviteCodeService,
  updateInviteCodeSchema,
  updateInviteCodeService
} from "../domain/users/invites";
import {
  createUser,
  createUserSchema,
  softDeleteUser,
  updateUser,
  updateUserSchema
} from "../domain/users/management";
import { revokeOtherUsersSessions } from "../domain/auth/sessions";
import { runBackup, runRestore } from "../domain/backup";
import { broadcastEventsChanged } from "../realtime/event-bus";
import {
  getS3LocationDetails,
  getStorageBackend,
  readBackupStatus
} from "../storage/s3-storage";
import { readSettings, settingsPartialSchema, settingsSchema, writeSettings } from "../settings";

const allowlistSchema = z.object({
  ipOrCidr: z.string().trim().min(1).max(80),
  note: z.string().trim().min(1).max(200).optional()
});

const settingsImportSchema = z.object({
  settings: settingsPartialSchema
});

const userExportBundleSchema = z.object({
  version: z.number().int().optional(),
  exportedAt: z.string().optional(),
  users: z.array(bulkImportRowSchema)
});

function nowIso() {
  return new Date().toISOString();
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
      if (!enforceApiTokenWriteAccess(request, response)) {
        return;
      }
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

  router.get("/users/export", (request, response) => {
    const admin = requireUser(context, request)!;

    const allUsers = context.db
      .select()
      .from(users)
      .where(isNull(users.deletedAt))
      .orderBy(asc(users.username))
      .all();

    const exportUsers = allUsers.map((row) => ({
      phoneNumber: row.phoneNumber,
      username: row.username,
      displayName: row.displayName ?? undefined,
      email: row.email,
      role: row.role,
      notificationsEnabled: row.notificationsEnabled
    }));

    const payload = {
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      users: exportUsers
    };

    tryWriteAuditLog(context, {
      actor: admin,
      action: "user_export_download",
      entityType: "user_batch",
      entityId: null,
      summary: `${admin.username} hat ${exportUsers.length} User exportiert.`,
      metadata: { userCount: exportUsers.length }
    });

    const stamp = payload.exportedAt.replace(/[:.]/g, "-");
    response.setHeader("Content-Disposition", `attachment; filename="hermes-users-${stamp}.json"`);
    response.type("application/json");
    response.send(JSON.stringify(payload, null, 2));
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

  router.post("/users/import/preview", (request, response) => {
    const parsed = bulkImportRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_import" });
      return;
    }

    const analysis = analyzeBulkImport(context, parsed.data);
    response.json(buildBulkImportResponse(analysis));
  });

  router.post("/users/import/commit", (request, response) => {
    const admin = requireAdmin(context, request);
    const parsed = bulkImportRequestSchema.safeParse(request.body);

    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_import" });
      return;
    }

    const analysis = analyzeBulkImport(context, parsed.data);
    if (analysis.blockingIssueCount > 0) {
      response.status(409).json({ error: "import_blockiert", ...buildBulkImportResponse(analysis) });
      return;
    }

    let insertedUsers: Array<typeof users.$inferSelect> = [];

    try {
      insertedUsers = commitBulkImportAnalysis(context, admin, analysis);
    } catch (error) {
      console.error("[Hermes] Failed to commit bulk user import", error);
      response.status(409).json({ error: "import_konnte_nicht_gespeichert_werden" });
      return;
    }

    tryWriteAuditLog(context, {
      actor: admin,
      action: "user_bulk_import",
      entityType: "user_batch",
      entityId: null,
      summary: `${admin.username} hat ${insertedUsers.length} User per Bulk-Import angelegt.`,
      metadata: buildBulkImportAuditMetadata(analysis)
    });

    response.status(201).json({
      importedCount: insertedUsers.length,
      users: insertedUsers.map(publicUser),
      import: {
        format: analysis.format,
        totalRows: analysis.totalRows,
        acceptedRows: analysis.acceptedRows,
        blockingIssueCount: 0,
        hasBlockingIssues: false,
        validCandidates: analysis.validCandidates,
        issues: []
      }
    });
  });

  router.post("/users/import/from-export", (request, response) => {
    const admin = requireAdmin(context, request);
    const parsed = userExportBundleSchema.safeParse(request.body);

    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_export_bundle" });
      return;
    }

    const analysis = analyzeBulkImport(context, {
      format: "json",
      source: JSON.stringify(parsed.data.users)
    });

    if (analysis.blockingIssueCount > 0) {
      response.status(409).json({ error: "import_blockiert", ...buildBulkImportResponse(analysis) });
      return;
    }

    let insertedUsers: Array<typeof users.$inferSelect> = [];

    try {
      insertedUsers = commitBulkImportAnalysis(context, admin, analysis);
    } catch (error) {
      console.error("[Hermes] Failed to commit user export import", error);
      response.status(409).json({ error: "import_konnte_nicht_gespeichert_werden" });
      return;
    }

    tryWriteAuditLog(context, {
      actor: admin,
      action: "user_export_import",
      entityType: "user_batch",
      entityId: null,
      summary: `${admin.username} hat ${insertedUsers.length} User aus einem Export-Archiv importiert.`,
      metadata: buildBulkImportAuditMetadata(analysis)
    });

    response.status(201).json({
      importedCount: insertedUsers.length,
      users: insertedUsers.map(publicUser),
      import: {
        format: analysis.format,
        totalRows: analysis.totalRows,
        acceptedRows: analysis.acceptedRows,
        blockingIssueCount: 0,
        hasBlockingIssues: false,
        validCandidates: analysis.validCandidates,
        issues: []
      }
    });
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

    const result = createUser(context, admin, parsed.data);
    if (!result.ok) {
      response.status(result.status).json({ error: result.error });
      return;
    }
    response.status(201).json({ user: publicUser(result.user) });
  });

  router.patch("/users/:id", (request, response) => {
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_user" });
      return;
    }

    const admin = requireAdmin(context, request);
    const result = updateUser(context, admin ?? undefined, request.params.id, parsed.data);
    if (!result.ok) {
      response.status(result.status).json({ error: result.error });
      return;
    }
    response.json({ user: publicUser(result.user) });
  });

  router.delete("/users/:id", (request, response) => {
    const admin = requireAdmin(context, request);
    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    const result = softDeleteUser(context, admin, request.params.id);
    if (!result.ok) {
      response.status(result.status).json({ error: result.error });
      return;
    }
    response.status(204).send();
  });

  router.post("/sessions/revoke-others", (request, response) => {
    const admin = requireAdmin(context, request);
    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    response.json(revokeOtherUsersSessions(context, admin));
  });

  router.delete("/events/:id", (request, response) => {
    const admin = requireAdmin(context, request);
    const event = context.db
      .select()
      .from(gameEvents)
      .where(eq(gameEvents.id, request.params.id))
      .get();

    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    if (!event || event.deletedAt) {
      response.status(404).json({ error: "event_nicht_gefunden" });
      return;
    }

    if (event.status !== "archived" && event.status !== "cancelled") {
      response.status(409).json({ error: "event_nicht_loeschbar" });
      return;
    }

    const timestamp = nowIso();
    context.db
      .update(gameEvents)
      .set({
        deletedAt: timestamp,
        deletedByUserId: admin.id,
        updatedAt: timestamp
      })
      .where(eq(gameEvents.id, event.id))
      .run();

    tryWriteAuditLog(context, {
      actor: admin,
      action: "event.soft_delete",
      entityType: "event",
      entityId: event.id,
      summary: `${admin.username} hat Event ${event.gameTitle} gelöscht.`,
      metadata: {
        gameTitle: event.gameTitle,
        status: event.status,
        deletedAt: timestamp
      }
    });

    broadcastEventsChanged("event_soft_deleted");
    response.status(204).send();
  });

  router.get("/settings", (_request, response) => {
    const backend = getStorageBackend(context.sqlite);
    const location = getS3LocationDetails(context.sqlite);
    const envS3Configured = process.env.HERMES_STORAGE_BACKEND === "s3";
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
        envS3Configured,
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
    response.json({ inviteCodes: listInviteCodes(context) });
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

    const result = createInviteCodeService(context, admin, parsed.data);
    if (!result.ok) {
      response.status(result.status).json({ error: result.error });
      return;
    }
    response.status(201).json({ inviteCode: result.invite });
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

    const result = updateInviteCodeService(context, admin, request.params.id, parsed.data);
    if (!result.ok) {
      response.status(result.status).json({ error: result.error });
      return;
    }
    response.json({ inviteCode: result.invite });
  });

  router.post("/invite-codes/:id/deactivate", (request, response) => {
    const admin = requireAdmin(context, request);
    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }
    const result = deactivateInviteCodeService(context, admin, request.params.id);
    if (!result.ok) {
      response.status(result.status).json({ error: result.error });
      return;
    }
    response.json({ inviteCode: result.invite });
  });

  router.post("/invite-codes/:id/reactivate", (request, response) => {
    const admin = requireAdmin(context, request);
    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }
    const result = reactivateInviteCodeService(context, admin, request.params.id);
    if (!result.ok) {
      response.status(result.status).json({ error: result.error });
      return;
    }
    response.json({ inviteCode: result.invite });
  });

  router.delete("/invite-codes/:id", (request, response) => {
    const admin = requireAdmin(context, request);
    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }
    const result = deleteUnusedInviteCodeService(context, admin, request.params.id);
    if (!result.ok) {
      response.status(result.status).json({ error: result.error });
      return;
    }
    response.status(204).send();
  });

  router.put("/settings", (request, response) => {
    const admin = requireAdmin(context, request);
    const parsed = settingsPartialSchema.safeParse(request.body);

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

  router.get("/settings/export", (request, response) => {
    const admin = requireUser(context, request)!;
    const settings = readSettings(context);
    const payload = {
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      settings
    };

    tryWriteAuditLog(context, {
      actor: admin,
      action: "settings_export_download",
      entityType: "settings",
      entityId: "app",
      summary: `${admin.username} hat Einstellungen exportiert.`,
      metadata: { keys: Object.keys(settings) }
    });

    const stamp = payload.exportedAt.replace(/[:.]/g, "-");
    response.setHeader("Content-Disposition", `attachment; filename="hermes-settings-${stamp}.json"`);
    response.type("application/json");
    response.send(JSON.stringify(payload, null, 2));
  });

  router.post("/settings/import", (request, response) => {
    const admin = requireAdmin(context, request);
    const parsed = settingsImportSchema.safeParse(request.body);

    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_settings_import" });
      return;
    }

    const merged = settingsSchema.parse({ ...readSettings(context), ...parsed.data.settings });
    writeSettings(context, merged, admin.id);
    tryWriteAuditLog(context, {
      actor: admin,
      action: "settings.import",
      entityType: "settings",
      entityId: "app",
      summary: `${admin.username} hat Einstellungen aus einem Export übernommen.`,
      metadata: { keys: Object.keys(parsed.data.settings) }
    });
    response.json({ settings: merged });
  });

  router.post("/backup", async (request, response) => {
    const admin = requireAdmin(context, request) ?? undefined;
    const result = await runBackup(context, admin);
    if (!result.ok) {
      response.status(result.status).json({ error: result.error });
      return;
    }
    response.json({ ok: true, message: "backup_erstellt" });
  });

  router.post("/restore", async (request, response) => {
    const admin = requireAdmin(context, request) ?? undefined;
    const result = await runRestore(context, admin);
    if (!result.ok) {
      response.status(result.status).json({ error: result.error, diagnostics: result.diagnostics });
      return;
    }
    response.json({
      ok: true,
      message: "restore_abgeschlossen",
      recovery: result.recovery,
      restoredFrom: result.restoredFrom
    });
  });

  return router;
}
