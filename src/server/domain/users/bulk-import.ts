import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseContext } from "../../db/client";
import { users } from "../../db/schema";
import { ensureActiveIdentityAvailable, userRoleSchema } from "../users";
import { readSettings } from "../../settings";

export const bulkImportFormatSchema = z.enum(["csv", "json"]);

export const bulkImportRequestSchema = z.object({
  format: bulkImportFormatSchema,
  source: z.string().min(1).max(500_000)
});

export const bulkImportRowSchema = z
  .object({
    phoneNumber: z.string().trim().min(3).max(40).optional(),
    username: z.string().trim().min(1).max(80),
    displayName: z.string().trim().min(1).max(80).optional(),
    email: z.string().trim().email().max(160),
    role: userRoleSchema.default("user"),
    notificationsEnabled: z.boolean().optional()
  })
  .strict();

export type BulkImportFormat = z.infer<typeof bulkImportFormatSchema>;
export type BulkImportCandidate = z.infer<typeof bulkImportRowSchema>;

export type BulkImportIssueCode =
  | "ungueltige_import_daten"
  | "ungueltige_import_zeile"
  | "doppelte_dateiwerte"
  | "bestehender_user_konflikt";

export type BulkImportIssue = {
  row: number;
  code: BulkImportIssueCode;
  field: "source" | "username" | "email" | "row";
  message: string;
  value?: string;
  conflictWithRow?: number;
};

export type BulkImportAnalysis = {
  format: BulkImportFormat;
  totalRows: number;
  acceptedRows: number;
  blockingIssueCount: number;
  validCandidates: BulkImportCandidate[];
  issues: BulkImportIssue[];
};

type RawImportRow = Record<string, unknown>;
type BulkImportRowResult = { row: number; candidate: BulkImportCandidate };

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

export function fallbackPhoneNumber(userId: string) {
  return `user:${userId}`;
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
    .replace(/^﻿/, "")
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

export function analyzeBulkImport(
  context: DatabaseContext,
  input: { format: BulkImportFormat; source: string }
): BulkImportAnalysis {
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
      role:
        parsedRow.raw.role === undefined || parsedRow.raw.role === ""
          ? undefined
          : parsedRow.raw.role,
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
          value:
            path && normalizedInput[path as keyof typeof normalizedInput] !== undefined
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
    issues.filter((issue) => issue.row > 0).map((issue) => issue.row)
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
    issues: issues.sort(
      (left, right) => left.row - right.row || left.field.localeCompare(right.field)
    )
  };
}

export function buildBulkImportResponse(analysis: BulkImportAnalysis) {
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

export function buildBulkImportAuditMetadata(analysis: BulkImportAnalysis) {
  return {
    format: analysis.format,
    totalRows: analysis.totalRows,
    importedCount: analysis.acceptedRows,
    issueCount: analysis.blockingIssueCount,
    sampleUsernames: analysis.validCandidates.slice(0, 5).map((candidate) => candidate.username),
    sampleEmails: analysis.validCandidates.slice(0, 5).map((candidate) => candidate.email)
  };
}

export function commitBulkImportAnalysis(
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
          notificationsEnabled:
            candidate.notificationsEnabled ?? settings.defaultNotificationsEnabled,
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
