import { asc, desc, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireCsrf } from "../auth/csrf";
import { publicUser, requireAdmin, requireUser } from "../auth/current-user";
import { enforceApiTokenWriteAccess } from "../auth/hermes-auth";
import { listAuditLogs, maskInviteCode, tryWriteAuditLog } from "../audit-log";
import {
  addRateLimitAllowlist,
  clearRateLimitBlock,
  deleteRateLimitAllowlist,
  listRateLimitAllowlist,
  listRateLimitEntries
} from "../auth/rate-limits";
import type { DatabaseContext } from "../db/client";
import { gameEvents, inviteCodes, participations, pushSubscriptions, sessions, users } from "../db/schema";
import { ensureActiveEmailAvailable, ensureActiveIdentityAvailable, userRoleSchema } from "../domain/users";
import { broadcastEventsChanged } from "../realtime/event-bus";
import {
  getS3LocationDetails,
  getS3CredentialSourcePresence,
  getStorageBackend,
  persistDatabaseSnapshot,
  readBackupStatus,
  RestoreValidationError,
  restoreDatabaseSnapshotIntoLive,
  toSafeBackupFailureSummary,
  toSafeRestoreDiagnostics
} from "../storage/s3-storage";
import { readSettings, settingsPartialSchema, settingsSchema, writeSettings } from "../settings";

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

const bulkImportFormatSchema = z.enum(["csv", "json"]);

const bulkImportRequestSchema = z.object({
  format: bulkImportFormatSchema,
  source: z.string().min(1).max(500_000)
});

const bulkImportRowSchema = createUserSchema.extend({ notificationsEnabled: z.boolean().optional() }).strict();

const settingsImportSchema = z.object({
  settings: settingsPartialSchema
});

const userExportBundleSchema = z.object({
  version: z.number().int().optional(),
  exportedAt: z.string().optional(),
  users: z.array(bulkImportRowSchema)
});

type BulkImportFormat = z.infer<typeof bulkImportFormatSchema>;
type BulkImportCandidate = z.infer<typeof bulkImportRowSchema>;
type BulkImportIssueCode =
  | "ungueltige_import_daten"
  | "ungueltige_import_zeile"
  | "doppelte_dateiwerte"
  | "bestehender_user_konflikt";
type BulkImportIssue = {
  row: number;
  code: BulkImportIssueCode;
  field: "source" | "username" | "email" | "row";
  message: string;
  value?: string;
  conflictWithRow?: number;
};
type BulkImportRowResult = {
  row: number;
  candidate: BulkImportCandidate;
};
type BulkImportAnalysis = {
  format: BulkImportFormat;
  totalRows: number;
  acceptedRows: number;
  blockingIssueCount: number;
  validCandidates: BulkImportCandidate[];
  issues: BulkImportIssue[];
};

type RawImportRow = Record<string, unknown>;

const csvHeaderAliases: Record<keyof BulkImportCandidate, string[]> = {
  phoneNumber: ["phonenumber", "phone_number", "phone", "telefonnummer", "telefon"],
  username: ["username", "user", "benutzername"],
  displayName: ["displayname", "display_name", "name", "anzeigename"],
  email: ["email", "e-mail", "mail"],
  role: ["role", "rolle"],
  notificationsEnabled: [
    "notificationsenabled",
    "notifications_enabled",
    "benachrichtigungen",
    "push"
  ]
};

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

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  if (inQuotes) {
    throw new Error("csv_quote_mismatch");
  }

  values.push(current.trim());
  return values;
}

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function mapCsvHeader(header: string) {
  const normalized = normalizeHeader(header);
  for (const [field, aliases] of Object.entries(csvHeaderAliases) as Array<
    [keyof BulkImportCandidate, string[]]
  >) {
    if (aliases.includes(normalized)) {
      return field;
    }
  }
  return undefined;
}

function parseCsvSource(source: string) {
  const lines = source
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error("csv_empty");
  }

  const headerValues = parseCsvLine(lines[0] ?? "");
  const fields = headerValues.map((header) => mapCsvHeader(header));

  if (!fields.includes("username") || !fields.includes("email")) {
    throw new Error("csv_missing_required_headers");
  }

  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const row: RawImportRow = {};

    fields.forEach((field, valueIndex) => {
      if (!field) {
        return;
      }
      row[field] = values[valueIndex] ?? "";
    });

    return {
      rowNumber: index + 2,
      raw: row
    };
  });
}

function parseJsonSource(source: string) {
  const parsed = JSON.parse(source) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("json_not_array");
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`json_row_invalid:${index + 1}`);
    }

    return {
      rowNumber: index + 1,
      raw: entry as RawImportRow
    };
  });
}

function parseBulkImportRows(format: BulkImportFormat, source: string) {
  return format === "csv" ? parseCsvSource(source) : parseJsonSource(source);
}

function toIssueMessage(issue: z.ZodIssue) {
  if (issue.code === "invalid_type") {
    const got =
      "input" in issue && issue.input !== undefined
        ? typeof issue.input === "object" && issue.input !== null
          ? JSON.stringify(issue.input)
          : String(issue.input)
        : "unbekannt";
    return `Erwartet ${issue.expected}, erhalten ${got}.`;
  }
  return issue.message;
}

function analyzeBulkImport(context: DatabaseContext, input: { format: BulkImportFormat; source: string }): BulkImportAnalysis {
  const issues: BulkImportIssue[] = [];
  let parsedRows: Array<{ rowNumber: number; raw: RawImportRow }> = [];

  try {
    parsedRows = parseBulkImportRows(input.format, input.source);
  } catch (error) {
    const message = error instanceof Error ? error.message : "import_parse_failed";
    issues.push({
      row: 0,
      code: "ungueltige_import_daten",
      field: "source",
      message:
        message === "csv_missing_required_headers"
          ? "CSV-Header muss mindestens username und email enthalten."
          : message === "csv_quote_mismatch"
            ? "CSV enthält nicht geschlossene Anführungszeichen."
            : message === "csv_empty"
              ? "Importquelle ist leer."
              : message === "json_not_array"
                ? "JSON-Import muss ein Array von User-Objekten sein."
                : message.startsWith("json_row_invalid:")
                  ? `JSON-Zeile ${message.split(":")[1]} ist kein Objekt.`
                  : "Importquelle konnte nicht gelesen werden."
    });

    return {
      format: input.format,
      totalRows: 0,
      acceptedRows: 0,
      blockingIssueCount: issues.length,
      validCandidates: [],
      issues
    };
  }

  const rowResults: BulkImportRowResult[] = [];
  const usernameRows = new Map<string, number>();
  const emailRows = new Map<string, number>();

  for (const parsedRow of parsedRows) {
    const rawNe = parsedRow.raw.notificationsEnabled;
    let notificationsEnabled: boolean | undefined;
    if (rawNe === true || rawNe === false) {
      notificationsEnabled = rawNe;
    } else if (typeof rawNe === "string") {
      const t = rawNe.trim().toLowerCase();
      if (t === "true" || t === "1" || t === "ja" || t === "yes") {
        notificationsEnabled = true;
      }
      if (t === "false" || t === "0" || t === "nein" || t === "no") {
        notificationsEnabled = false;
      }
    }

    const normalizedInput: RawImportRow = {
      phoneNumber:
        typeof parsedRow.raw.phoneNumber === "string" && parsedRow.raw.phoneNumber.trim().length > 0
          ? parsedRow.raw.phoneNumber.trim()
          : undefined,
      username: parsedRow.raw.username,
      displayName:
        typeof parsedRow.raw.displayName === "string" && parsedRow.raw.displayName.trim().length > 0
          ? parsedRow.raw.displayName.trim()
          : undefined,
      email: parsedRow.raw.email,
      role: parsedRow.raw.role === undefined || parsedRow.raw.role === "" ? undefined : parsedRow.raw.role,
      notificationsEnabled
    };

    const result = bulkImportRowSchema.safeParse(normalizedInput);
    if (!result.success) {
      result.error.issues.forEach((issue) => {
        const path = issue.path[0];
        issues.push({
          row: parsedRow.rowNumber,
          code: "ungueltige_import_zeile",
          field:
            path === "username" || path === "email" || path === "row" || path === "source"
              ? path
              : "row",
          message: toIssueMessage(issue),
          value: path && normalizedInput[path as keyof typeof normalizedInput] !== undefined
            ? String(normalizedInput[path as keyof typeof normalizedInput])
            : undefined
        });
      });
      continue;
    }

    rowResults.push({ row: parsedRow.rowNumber, candidate: result.data });
  }

  for (const rowResult of rowResults) {
    const usernameConflictRow = usernameRows.get(rowResult.candidate.username);
    if (usernameConflictRow !== undefined) {
      issues.push({
        row: rowResult.row,
        code: "doppelte_dateiwerte",
        field: "username",
        message: `Username ${rowResult.candidate.username} ist in der Importdatei mehrfach vorhanden.`,
        value: rowResult.candidate.username,
        conflictWithRow: usernameConflictRow
      });
    } else {
      usernameRows.set(rowResult.candidate.username, rowResult.row);
    }

    const emailConflictRow = emailRows.get(rowResult.candidate.email);
    if (emailConflictRow !== undefined) {
      issues.push({
        row: rowResult.row,
        code: "doppelte_dateiwerte",
        field: "email",
        message: `E-Mail ${rowResult.candidate.email} ist in der Importdatei mehrfach vorhanden.`,
        value: rowResult.candidate.email,
        conflictWithRow: emailConflictRow
      });
    } else {
      emailRows.set(rowResult.candidate.email, rowResult.row);
    }
  }

  const blockedRows = new Set(
    issues
      .filter((issue) => issue.row > 0)
      .map((issue) => issue.row)
  );

  for (const rowResult of rowResults) {
    if (blockedRows.has(rowResult.row)) {
      continue;
    }

    const availability = ensureActiveIdentityAvailable(context, {
      username: rowResult.candidate.username,
      email: rowResult.candidate.email
    });

    if (!availability.ok) {
      issues.push({
        row: rowResult.row,
        code: "bestehender_user_konflikt",
        field: availability.error === "username_existiert_bereits" ? "username" : "email",
        message:
          availability.error === "username_existiert_bereits"
            ? `Username ${rowResult.candidate.username} existiert bereits als aktiver User.`
            : `E-Mail ${rowResult.candidate.email} existiert bereits als aktiver User.`,
        value:
          availability.error === "username_existiert_bereits"
            ? rowResult.candidate.username
            : rowResult.candidate.email
      });
      blockedRows.add(rowResult.row);
    }
  }

  const validCandidates = rowResults
    .filter((rowResult) => !blockedRows.has(rowResult.row))
    .map((rowResult) => rowResult.candidate);

  return {
    format: input.format,
    totalRows: parsedRows.length,
    acceptedRows: validCandidates.length,
    blockingIssueCount: issues.length,
    validCandidates,
    issues: issues.sort((left, right) => left.row - right.row || left.field.localeCompare(right.field))
  };
}

function buildBulkImportResponse(analysis: BulkImportAnalysis) {
  return {
    import: {
      format: analysis.format,
      totalRows: analysis.totalRows,
      acceptedRows: analysis.acceptedRows,
      blockingIssueCount: analysis.blockingIssueCount,
      hasBlockingIssues: analysis.blockingIssueCount > 0,
      validCandidates: analysis.validCandidates,
      issues: analysis.issues
    }
  };
}

function buildBulkImportAuditMetadata(analysis: BulkImportAnalysis) {
  return {
    format: analysis.format,
    totalRows: analysis.totalRows,
    importedCount: analysis.acceptedRows,
    issueCount: analysis.blockingIssueCount,
    sampleUsernames: analysis.validCandidates.slice(0, 5).map((candidate) => candidate.username),
    sampleEmails: analysis.validCandidates.slice(0, 5).map((candidate) => candidate.email)
  };
}

function commitBulkImportAnalysis(
  context: DatabaseContext,
  admin: { id: string; username: string },
  analysis: BulkImportAnalysis
) {
  const settings = readSettings(context);
  const timestamp = nowIso();
  const insertedUsers: Array<typeof users.$inferSelect> = [];

  context.sqlite.transaction(() => {
    for (const candidate of analysis.validCandidates) {
      const id = randomUUID();
      context.db
        .insert(users)
        .values({
          id,
          phoneNumber: candidate.phoneNumber ?? fallbackPhoneNumber(id),
          username: candidate.username,
          displayName: candidate.displayName ?? candidate.username,
          email: candidate.email,
          role: candidate.role,
          notificationsEnabled: candidate.notificationsEnabled ?? settings.defaultNotificationsEnabled,
          createdByUserId: admin.id,
          createdAt: timestamp,
          updatedAt: timestamp
        })
        .run();

      const created = context.db.select().from(users).where(eq(users.id, id)).get();
      if (created) {
        insertedUsers.push(created);
      }
    }
  })();

  return insertedUsers;
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

    const identityCheck = ensureActiveIdentityAvailable(context, {
      username: parsed.data.username,
      email: parsed.data.email
    });
    if (!identityCheck.ok) {
      response.status(409).json({ error: identityCheck.error });
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

    if (parsed.data.username !== undefined || parsed.data.email !== undefined) {
      const identityCheck = ensureActiveIdentityAvailable(
        context,
        {
          username: parsed.data.username ?? existing.username,
          email: parsed.data.email ?? existing.email
        },
        { excludeUserId: existing.id }
      );
      if (!identityCheck.ok) {
        response.status(409).json({ error: identityCheck.error });
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
    const admin = requireAdmin(context, request);
    const backend = getStorageBackend(context.sqlite);
    const location = getS3LocationDetails(context.sqlite);
    const creds = getS3CredentialSourcePresence();

    tryWriteAuditLog(context, {
      actor: admin,
      action: "storage.config_check",
      entityType: "storage",
      entityId: "s3",
      summary: `${admin?.username ?? "Admin"} hat Storage-Konfiguration geprüft.`,
      metadata: {
        backend,
        location,
        credentialSource: {
          envAccessKeyPresent: creds.envAccessKeyPresent,
          envSecretPresent: creds.envSecretPresent,
          credsFileConfigured: creds.credsFileConfigured,
          credsFileExists: creds.credsFileExists
        }
      }
    });

    tryWriteAuditLog(context, {
      actor: admin,
      action: "storage.backup_start",
      entityType: "storage",
      entityId: "s3",
      summary: `${admin?.username ?? "Admin"} hat ein S3-Backup gestartet.`
    });

    try {
      await persistDatabaseSnapshot(context.sqlite);
      tryWriteAuditLog(context, {
        actor: admin,
        action: "storage.backup_success",
        entityType: "storage",
        entityId: "s3",
        summary: `${admin?.username ?? "Admin"} hat ein S3-Backup erstellt.`
      });
      response.json({ ok: true, message: "backup_erstellt" });
    } catch (error) {
      console.error("[Hermes] Failed to create admin backup", error);
      tryWriteAuditLog(context, {
        actor: admin,
        action: "storage.backup_failed",
        entityType: "storage",
        entityId: "s3",
        summary: `${admin?.username ?? "Admin"} konnte kein S3-Backup erstellen.`,
        metadata: {
          hint: toSafeBackupFailureSummary(error),
          backend,
          location
        }
      });
      response.status(500).json({ error: "backup_fehlgeschlagen" });
    }
  });

  router.post("/restore", async (request, response) => {
    const admin = requireAdmin(context, request);
    const backend = getStorageBackend(context.sqlite);
    const location = getS3LocationDetails(context.sqlite);
    const creds = getS3CredentialSourcePresence();

    tryWriteAuditLog(context, {
      actor: admin,
      action: "storage.config_check",
      entityType: "storage",
      entityId: "s3",
      summary: `${admin?.username ?? "Admin"} hat Storage-Konfiguration geprüft.`,
      metadata: {
        backend,
        location,
        credentialSource: {
          envAccessKeyPresent: creds.envAccessKeyPresent,
          envSecretPresent: creds.envSecretPresent,
          credsFileConfigured: creds.credsFileConfigured,
          credsFileExists: creds.credsFileExists
        }
      }
    });

    tryWriteAuditLog(context, {
      actor: admin,
      action: "storage.restore_start",
      entityType: "storage",
      entityId: "s3",
      summary: `${admin?.username ?? "Admin"} hat ein S3-Restore gestartet.`
    });

    try {
      const result = await restoreDatabaseSnapshotIntoLive(context.sqlite);
      tryWriteAuditLog(context, {
        actor: admin,
        action: "storage.restore_validated",
        entityType: "storage",
        entityId: "s3",
        summary: `${admin?.username ?? "Admin"} hat ein Restore validiert.`
      });
      if (result?.recovery) {
        tryWriteAuditLog(context, {
          actor: admin,
          action: "storage.restore_recovery_created",
          entityType: "storage",
          entityId: "s3",
          summary: `${admin?.username ?? "Admin"} hat ein Recovery-Snapshot erstellt.`,
          metadata: { recoveryId: result.recovery.id, recoveryKey: result.recovery.key }
        });
      }
      tryWriteAuditLog(context, {
        actor: admin,
        action: "storage.restore_completed",
        entityType: "storage",
        entityId: "s3",
        summary: `${admin?.username ?? "Admin"} hat ein S3-Restore abgeschlossen.`
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
      const kind = diagnostics.kind;

      if (kind !== "validation_failed") {
        tryWriteAuditLog(context, {
          actor: admin,
          action: "storage.restore_validated",
          entityType: "storage",
          entityId: "s3",
          summary: `${admin?.username ?? "Admin"} hat ein Restore validiert.`
        });
      }
      if (diagnostics.recovery) {
        tryWriteAuditLog(context, {
          actor: admin,
          action: "storage.restore_recovery_created",
          entityType: "storage",
          entityId: "s3",
          summary: `${admin?.username ?? "Admin"} hat ein Recovery-Snapshot erstellt.`,
          metadata: { recoveryId: diagnostics.recovery.id, recoveryKey: diagnostics.recovery.key }
        });
      }
      tryWriteAuditLog(context, {
        actor: admin,
        action: "storage.restore_failed",
        entityType: "storage",
        entityId: "s3",
        summary: `${admin?.username ?? "Admin"} konnte kein S3-Restore durchführen.`,
        metadata: {
          kind,
          summary: diagnostics.summary,
          snapshotKey: diagnostics.snapshot?.key ?? null,
          recoveryId: diagnostics.recovery?.id ?? null
        }
      });
      if (error instanceof RestoreValidationError) {
        response.status(400).json({ error: "restore_fehlgeschlagen", diagnostics });
        return;
      }
      response.status(500).json({ error: "restore_fehlgeschlagen", diagnostics });
    }
  });

  return router;
}
