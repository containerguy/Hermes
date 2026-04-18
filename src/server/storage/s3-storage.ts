import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getDatabasePath } from "../env";

type S3Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
};

export type StorageBackend = "s3" | "disabled";

export type S3LocationDetails = {
  bucket: string;
  key: string;
  region: string;
  endpoint: string;
};

export type BackupStatusRow = {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCode: string | null;
  failureSummary: string | null;
  location: S3LocationDetails | null;
  updatedAt: string;
};

export type RestoreDiagnostics = {
  kind: "validation_failed" | "copy_failed" | "recovery_failed";
  summary: string;
  snapshot?: { bucket: string; key: string; region: string; endpoint: string };
  recovery?: { id: string; key: string };
  missingTables?: string[];
  columnMismatches?: Array<{ table: string; missingInSnapshot: string[]; extraInSnapshot: string[] }>;
  foreignKeyFailures?: Array<{ table: string; rowid: number; parent: string; fkid: number }>;
  migrations?: {
    liveLatest?: string | null;
    snapshotLatest?: string | null;
    liveCount?: number;
    snapshotCount?: number;
  };
};

export class RestoreValidationError extends Error {
  diagnostics: RestoreDiagnostics;

  constructor(message: string, diagnostics: RestoreDiagnostics) {
    super(message);
    this.diagnostics = diagnostics;
  }
}

let snapshotTimer: NodeJS.Timeout | undefined;

const restorableTables = [
  "users",
  "login_challenges",
  "sessions",
  "push_subscriptions",
  "game_events",
  "participations",
  "app_settings",
  "audit_logs",
  "invite_codes",
  "invite_code_uses",
  "schema_migrations"
];

function envS3StorageEnabled() {
  return process.env.HERMES_STORAGE_BACKEND === "s3";
}

/**
 * App-Einstellung (Default: an). Nur lesbar, wenn SQLite bereits geöffnet ist.
 */
export function readS3SnapshotAppEnabled(sqlite: Database.Database): boolean {
  const row = sqlite
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get("s3SnapshotEnabled") as { value: string } | undefined;
  if (!row) {
    return true;
  }
  try {
    return JSON.parse(row.value) !== false;
  } catch {
    return true;
  }
}

/** Env s3 + App-Schalter: für alle Laufzeit-Operationen mit SQLite. */
export function isS3SnapshotOperational(sqlite: Database.Database): boolean {
  return envS3StorageEnabled() && readS3SnapshotAppEnabled(sqlite);
}

export function getStorageBackend(sqlite: Database.Database): StorageBackend {
  return isS3SnapshotOperational(sqlite) ? "s3" : "disabled";
}

function normalizeCredentialKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCredentialFileContent(content: string): Partial<S3Credentials> {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("["));
  const values: Record<string, string> = {};
  const bareValues: string[] = [];

  for (const line of lines) {
    if (line.includes(",") && !line.includes("=") && !line.includes(":")) {
      bareValues.push(
        ...line
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      );
      continue;
    }

    const equalsIndex = line.indexOf("=");
    const colonIndex = line.indexOf(":");
    const separatorIndex =
      equalsIndex !== -1
        ? equalsIndex
        : colonIndex !== -1
          ? colonIndex
          : -1;

    if (separatorIndex === -1) {
      bareValues.push(line);
      continue;
    }

    values[normalizeCredentialKey(line.slice(0, separatorIndex).trim())] = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }

  return {
    accessKeyId:
      values.awsaccesskeyid ??
      values.accesskeyid ??
      values.accesskey ??
      values.accessid ??
      bareValues[0],
    secretAccessKey:
      values.awssecretaccesskey ??
      values.secretaccesskey ??
      values.secretkey ??
      values.secret ??
      bareValues[1]
  };
}

export function readCredentialFile(filePath: string): Partial<S3Credentials> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`S3 credentials file not found: ${filePath}`);
  }

  return parseCredentialFileContent(fs.readFileSync(filePath, "utf8"));
}

function readS3Credentials(): S3Credentials {
  const fromFile = process.env.HERMES_S3_CREDS_FILE
    ? readCredentialFile(process.env.HERMES_S3_CREDS_FILE)
    : {};
  const accessKeyId =
    process.env.HERMES_S3_ACCESS_KEY_ID ??
    process.env.AWS_ACCESS_KEY_ID ??
    fromFile.accessKeyId;
  const secretAccessKey =
    process.env.HERMES_S3_SECRET_ACCESS_KEY ??
    process.env.AWS_SECRET_ACCESS_KEY ??
    fromFile.secretAccessKey;

  if (!accessKeyId || !secretAccessKey) {
    const fileHint = process.env.HERMES_S3_CREDS_FILE
      ? ` File configured: ${process.env.HERMES_S3_CREDS_FILE}.`
      : " No HERMES_S3_CREDS_FILE configured.";
    throw new Error(
      `S3 storage is enabled, but S3 credentials are missing or not parseable.${fileHint} Supported keys include AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, access-key/secret-key, access_key/secret_key, or two bare lines.`
    );
  }

  return { accessKeyId, secretAccessKey };
}

function readS3Config() {
  const region = process.env.HERMES_S3_REGION ?? "eu-central-2";
  const bucket = process.env.HERMES_S3_BUCKET ?? "hermes-storage";

  return {
    bucket,
    key: process.env.HERMES_S3_DB_KEY ?? "hermes.sqlite",
    region,
    endpoint: process.env.HERMES_S3_ENDPOINT ?? `https://s3.${region}.wasabisys.com`,
    credentials: readS3Credentials()
  };
}

function readS3LocationConfig(): S3LocationDetails {
  const region = process.env.HERMES_S3_REGION ?? "eu-central-2";
  const bucket = process.env.HERMES_S3_BUCKET ?? "hermes-storage";

  return {
    bucket,
    key: process.env.HERMES_S3_DB_KEY ?? "hermes.sqlite",
    region,
    endpoint: process.env.HERMES_S3_ENDPOINT ?? `https://s3.${region}.wasabisys.com`
  };
}

export function getS3LocationDetails(sqlite: Database.Database): S3LocationDetails | null {
  if (!isS3SnapshotOperational(sqlite)) {
    return null;
  }
  return readS3LocationConfig();
}

export function getS3CredentialSourcePresence() {
  const credsFile = process.env.HERMES_S3_CREDS_FILE ?? null;
  const envAccessKeyPresent = Boolean(
    process.env.HERMES_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID
  );
  const envSecretPresent = Boolean(
    process.env.HERMES_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY
  );
  const credsFileConfigured = Boolean(credsFile);
  const credsFileExists = credsFileConfigured ? fs.existsSync(credsFile as string) : false;
  return { envAccessKeyPresent, envSecretPresent, credsFileConfigured, credsFileExists, credsFile };
}

function createS3Client() {
  const config = readS3Config();

  return {
    ...config,
    client: new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: config.credentials,
      forcePathStyle: true
    })
  };
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function truncate(input: string, max = 240) {
  if (input.length <= max) return input;
  return input.slice(0, max - 1) + "…";
}

function looksSensitive(value: string) {
  const lowered = value.toLowerCase();
  return (
    lowered.includes("authorization") ||
    lowered.includes("cookie") ||
    lowered.includes("x-amz-") ||
    lowered.includes("x-amzn-") ||
    lowered.includes("accesskey") ||
    lowered.includes("secret") ||
    lowered.includes("token")
  );
}

export function toSafeBackupFailureSummary(error: unknown) {
  if (!error) {
    return "Unbekannter Fehler.";
  }

  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  const code =
    typeof (error as { code?: unknown } | null | undefined)?.code === "string"
      ? ((error as { code: string }).code as string)
      : "";

  const parts = [name, code, message].filter(Boolean).join(": ");
  const summarized = parts || "Backup fehlgeschlagen.";

  const cleaned = summarized.replace(/\s+/g, " ").trim();
  if (looksSensitive(cleaned)) {
    return "Backup fehlgeschlagen. Details wurden aus Sicherheitsgründen entfernt.";
  }
  return truncate(cleaned, 240);
}

function toSafeRestoreSummary(error: unknown) {
  if (!error) {
    return "Restore fehlgeschlagen.";
  }

  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  const code =
    typeof (error as { code?: unknown } | null | undefined)?.code === "string"
      ? ((error as { code: string }).code as string)
      : "";

  const parts = [name, code, message].filter(Boolean).join(": ");
  const summarized = parts || "Restore fehlgeschlagen.";
  const cleaned = summarized.replace(/\s+/g, " ").trim();
  if (looksSensitive(cleaned)) {
    return "Restore fehlgeschlagen. Details wurden aus Sicherheitsgründen entfernt.";
  }
  return truncate(cleaned, 240);
}

function capList<T>(items: T[] | undefined, max = 20) {
  if (!items) return undefined;
  if (items.length <= max) return items;
  return items.slice(0, max);
}

function sanitizeDiagnostics(input: RestoreDiagnostics): RestoreDiagnostics {
  const safeSummary = looksSensitive(input.summary)
    ? "Restore fehlgeschlagen. Details wurden aus Sicherheitsgründen entfernt."
    : truncate(input.summary.replace(/\s+/g, " ").trim(), 240);

  return {
    ...input,
    summary: safeSummary,
    missingTables: capList(input.missingTables, 20),
    columnMismatches: capList(input.columnMismatches, 20)?.map((entry) => ({
      table: entry.table,
      missingInSnapshot: capList(entry.missingInSnapshot, 20) ?? [],
      extraInSnapshot: capList(entry.extraInSnapshot, 20) ?? []
    })),
    foreignKeyFailures: capList(input.foreignKeyFailures, 20)
  };
}

export function toSafeRestoreDiagnostics(error: unknown): RestoreDiagnostics {
  if (error instanceof RestoreValidationError) {
    return sanitizeDiagnostics(error.diagnostics);
  }

  return sanitizeDiagnostics({
    kind: "copy_failed",
    summary: toSafeRestoreSummary(error)
  });
}

export function readBackupStatus(sqlite: Database.Database): BackupStatusRow | null {
  const row = sqlite
    .prepare(
      `
      SELECT
        last_success_at AS lastSuccessAt,
        last_failure_at AS lastFailureAt,
        failure_code AS failureCode,
        failure_summary AS failureSummary,
        bucket,
        key,
        region,
        endpoint,
        updated_at AS updatedAt
      FROM storage_backup_status
      WHERE backend = ?
    `
    )
    .get("s3") as
    | (Record<string, unknown> & {
        lastSuccessAt: string | null;
        lastFailureAt: string | null;
        failureCode: string | null;
        failureSummary: string | null;
        bucket: string | null;
        key: string | null;
        region: string | null;
        endpoint: string | null;
        updatedAt: string;
      })
    | undefined;

  if (!row) {
    return null;
  }

  const location =
    row.bucket && row.key && row.region && row.endpoint
      ? {
          bucket: row.bucket,
          key: row.key,
          region: row.region,
          endpoint: row.endpoint
        }
      : null;

  return {
    lastSuccessAt: row.lastSuccessAt,
    lastFailureAt: row.lastFailureAt,
    failureCode: row.failureCode,
    failureSummary: row.failureSummary,
    location,
    updatedAt: row.updatedAt
  };
}

type BackupStatusPatch = Partial<{
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCode: string | null;
  failureSummary: string | null;
  location: S3LocationDetails | null;
}>;

export function writeBackupStatus(sqlite: Database.Database, patch: BackupStatusPatch) {
  const existing = sqlite
    .prepare(
      `
      SELECT
        last_success_at AS lastSuccessAt,
        last_failure_at AS lastFailureAt,
        failure_code AS failureCode,
        failure_summary AS failureSummary,
        bucket,
        key,
        region,
        endpoint
      FROM storage_backup_status
      WHERE backend = ?
    `
    )
    .get("s3") as
    | {
        lastSuccessAt: string | null;
        lastFailureAt: string | null;
        failureCode: string | null;
        failureSummary: string | null;
        bucket: string | null;
        key: string | null;
        region: string | null;
        endpoint: string | null;
      }
    | undefined;

  const resolvedLocation = patch.location ?? undefined;
  const next = {
    lastSuccessAt: patch.lastSuccessAt !== undefined ? patch.lastSuccessAt : existing?.lastSuccessAt ?? null,
    lastFailureAt: patch.lastFailureAt !== undefined ? patch.lastFailureAt : existing?.lastFailureAt ?? null,
    failureCode: patch.failureCode !== undefined ? patch.failureCode : existing?.failureCode ?? null,
    failureSummary: patch.failureSummary !== undefined ? patch.failureSummary : existing?.failureSummary ?? null,
    bucket:
      resolvedLocation !== undefined
        ? resolvedLocation?.bucket ?? null
        : existing?.bucket ?? null,
    key:
      resolvedLocation !== undefined
        ? resolvedLocation?.key ?? null
        : existing?.key ?? null,
    region:
      resolvedLocation !== undefined
        ? resolvedLocation?.region ?? null
        : existing?.region ?? null,
    endpoint:
      resolvedLocation !== undefined
        ? resolvedLocation?.endpoint ?? null
        : existing?.endpoint ?? null,
    updatedAt: new Date().toISOString()
  };

  sqlite
    .prepare(
      `
      INSERT INTO storage_backup_status (
        backend,
        last_success_at,
        last_failure_at,
        failure_code,
        failure_summary,
        bucket,
        key,
        region,
        endpoint,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(backend) DO UPDATE SET
        last_success_at = excluded.last_success_at,
        last_failure_at = excluded.last_failure_at,
        failure_code = excluded.failure_code,
        failure_summary = excluded.failure_summary,
        bucket = excluded.bucket,
        key = excluded.key,
        region = excluded.region,
        endpoint = excluded.endpoint,
        updated_at = excluded.updated_at
    `
    )
    .run(
      "s3",
      next.lastSuccessAt,
      next.lastFailureAt,
      next.failureCode,
      next.failureSummary,
      next.bucket,
      next.key,
      next.region,
      next.endpoint,
      next.updatedAt
    );
}

function tryWriteBackupStatus(sqlite: Database.Database, patch: BackupStatusPatch) {
  try {
    writeBackupStatus(sqlite, patch);
  } catch (error) {
    console.error("[Hermes] Failed to persist backup status", error);
  }
}

async function downloadSnapshotToFile(targetPath: string) {
  const { bucket, key, client } = createS3Client();
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await result.Body?.transformToByteArray();

  if (!bytes) {
    throw new Error(`S3 snapshot at s3://${bucket}/${key} is empty.`);
  }

  fs.writeFileSync(targetPath, Buffer.from(bytes));
  return { bucket, key };
}

function listTableNames(db: Database.Database) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
}

function readColumns(db: Database.Database, table: string) {
  return db
    .prepare(`SELECT name FROM pragma_table_info(${quoteIdentifier(table)}) ORDER BY cid`)
    .all()
    .map((row) => (row as { name: string }).name);
}

function readLatestMigration(db: Database.Database) {
  const row = db
    .prepare("SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1")
    .get() as { name?: string } | undefined;
  return row?.name ?? null;
}

function readMigrationCount(db: Database.Database) {
  const row = db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

function validateSnapshotBeforeRestore(input: {
  sqlite: Database.Database;
  snapshotDb: Database.Database;
  snapshotLocation: S3LocationDetails & { bucket: string; key: string };
}) {
  const missingTables: string[] = [];
  const snapshotTables = new Set(listTableNames(input.snapshotDb));
  for (const table of restorableTables) {
    if (!snapshotTables.has(table)) {
      missingTables.push(table);
    }
  }

  const diagnosticsBase: RestoreDiagnostics = {
    kind: "validation_failed",
    summary: "Snapshot ist nicht kompatibel.",
    snapshot: {
      bucket: input.snapshotLocation.bucket,
      key: input.snapshotLocation.key,
      region: input.snapshotLocation.region,
      endpoint: input.snapshotLocation.endpoint
    }
  };

  if (missingTables.length > 0) {
    throw new RestoreValidationError("Snapshot missing tables", {
      ...diagnosticsBase,
      summary: "Snapshot fehlt erwartete Tabellen.",
      missingTables
    });
  }

  let liveLatest: string | null = null;
  let snapshotLatest: string | null = null;
  let liveCount = 0;
  let snapshotCount = 0;
  try {
    liveLatest = readLatestMigration(input.sqlite);
    snapshotLatest = readLatestMigration(input.snapshotDb);
    liveCount = readMigrationCount(input.sqlite);
    snapshotCount = readMigrationCount(input.snapshotDb);
  } catch (error) {
    throw new RestoreValidationError("Snapshot migrations unreadable", {
      ...diagnosticsBase,
      summary: "Snapshot enthält keine gültigen Migrationen (schema_migrations).",
      migrations: { liveLatest, snapshotLatest, liveCount, snapshotCount }
    });
  }

  if (liveLatest !== snapshotLatest) {
    throw new RestoreValidationError("Migration mismatch", {
      ...diagnosticsBase,
      summary: "Snapshot hat eine andere Schema-Version als die Live-Datenbank.",
      migrations: { liveLatest, snapshotLatest, liveCount, snapshotCount }
    });
  }

  const mismatches: Array<{ table: string; missingInSnapshot: string[]; extraInSnapshot: string[] }> = [];
  for (const table of restorableTables) {
    const liveColumns = new Set(readColumns(input.sqlite, table));
    const snapshotColumns = new Set(readColumns(input.snapshotDb, table));
    const missingInSnapshot = [...liveColumns].filter((col) => !snapshotColumns.has(col));
    const extraInSnapshot = [...snapshotColumns].filter((col) => !liveColumns.has(col));
    if (missingInSnapshot.length > 0) {
      mismatches.push({ table, missingInSnapshot, extraInSnapshot });
    }
  }

  if (mismatches.length > 0) {
    throw new RestoreValidationError("Column mismatch", {
      ...diagnosticsBase,
      summary: "Snapshot fehlt erwartete Spalten.",
      columnMismatches: mismatches,
      migrations: { liveLatest, snapshotLatest, liveCount, snapshotCount }
    });
  }

  input.snapshotDb.pragma("foreign_keys = ON");
  const fkFailures = input.snapshotDb
    .prepare("PRAGMA foreign_key_check;")
    .all() as Array<{ table: string; rowid: number; parent: string; fkid: number }>;
  if (fkFailures.length > 0) {
    throw new RestoreValidationError("Snapshot foreign keys invalid", {
      ...diagnosticsBase,
      summary: "Snapshot hat Foreign-Key Fehler.",
      foreignKeyFailures: fkFailures,
      migrations: { liveLatest, snapshotLatest, liveCount, snapshotCount }
    });
  }

  const integrity = input.snapshotDb.prepare("PRAGMA integrity_check;").get() as { integrity_check?: string } | undefined;
  const integrityValue = String(integrity?.integrity_check ?? "");
  if (integrityValue && integrityValue !== "ok") {
    throw new RestoreValidationError("Snapshot integrity check failed", {
      ...diagnosticsBase,
      summary: "Snapshot integrity_check ist fehlgeschlagen."
    });
  }
}

function makeRecoveryKey(recoveryId: string) {
  const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
  return `recoveries/${timestamp}-${recoveryId}.sqlite`;
}

async function cleanupOldRecoveries(client: S3Client, bucket: string, keep = 10) {
  try {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "recoveries/"
      })
    );
    const objects = (listed.Contents ?? [])
      .filter((entry) => entry.Key && entry.LastModified)
      .map((entry) => ({ key: entry.Key as string, lastModified: entry.LastModified as Date }))
      .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

    const toDelete = objects.slice(keep);
    for (const entry of toDelete) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: entry.key }));
    }
  } catch (error) {
    console.error("[Hermes] Failed to cleanup old restore recoveries", error);
  }
}

async function createRecoverySnapshot(
  sqlite: Database.Database,
  databasePath = getDatabasePath()
): Promise<{ id: string; key: string; location: Omit<S3LocationDetails, "key"> & { bucket: string } }> {
  if (!isS3SnapshotOperational(sqlite)) {
    throw new Error("S3 storage is not enabled.");
  }

  const recoveryId = randomUUID().replace(/-/g, "").slice(0, 10);
  const recoveryKey = makeRecoveryKey(recoveryId);

  sqlite.pragma("wal_checkpoint(TRUNCATE)");
  const { bucket, region, endpoint, client } = createS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: recoveryKey,
      Body: fs.createReadStream(databasePath),
      ContentType: "application/vnd.sqlite3"
    })
  );

  try {
    sqlite
      .prepare(
        `
        INSERT INTO storage_restore_recoveries (id, key, bucket, region, endpoint, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      )
      .run(recoveryId, recoveryKey, bucket, region, endpoint, new Date().toISOString());
  } catch (error) {
    console.error("[Hermes] Failed to persist recovery metadata", error);
  }

  return {
    id: recoveryId,
    key: recoveryKey,
    location: { bucket, region, endpoint }
  };
}

/**
 * Erst-Start / leere DB: nur Umgebungsvariable, noch kein app_settings-Eintrag.
 * App-Schalter „S3 aus“ wirkt nach dem Start für Backups; initialer Download bleibt deploy-gesteuert.
 */
export async function restoreDatabaseFromStorageIfNeeded(databasePath = getDatabasePath()) {
  if (!envS3StorageEnabled()) {
    return;
  }

  const restoreMode = process.env.HERMES_S3_RESTORE_MODE ?? "if-missing";

  if (restoreMode === "never") {
    return;
  }

  if (restoreMode === "if-missing" && fs.existsSync(databasePath)) {
    return;
  }

  const { bucket, key } = readS3Config();

  try {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    await downloadSnapshotToFile(databasePath);
    console.log(`[Hermes] Restored SQLite snapshot from s3://${bucket}/${key}`);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";

    if (name === "NoSuchKey" || name === "NotFound") {
      console.warn(`[Hermes] No S3 snapshot found at s3://${bucket}/${key}; starting locally.`);
      return;
    }

    throw error;
  }
}

export async function restoreDatabaseSnapshotIntoLive(sqlite: Database.Database) {
  if (!isS3SnapshotOperational(sqlite)) {
    throw new RestoreValidationError("Storage disabled", {
      kind: "validation_failed",
      summary: "S3 Snapshot Storage ist deaktiviert (Umgebung oder App-Einstellung)."
    });
  }

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-restore-"));
  const tempPath = path.join(tempDirectory, "snapshot.sqlite");
  const snapshotLocation = readS3LocationConfig();

  try {
    let restoredFrom: { bucket: string; key: string } | null = null;
    try {
      restoredFrom = await downloadSnapshotToFile(tempPath);
    } catch (error) {
      throw new RestoreValidationError("Snapshot download failed", {
        kind: "validation_failed",
        summary: toSafeRestoreSummary(error),
        snapshot: {
          bucket: snapshotLocation.bucket,
          key: snapshotLocation.key,
          region: snapshotLocation.region,
          endpoint: snapshotLocation.endpoint
        }
      });
    }

    const snapshotDb = new Database(tempPath, { readonly: true });
    try {
      validateSnapshotBeforeRestore({
        sqlite,
        snapshotDb,
        snapshotLocation: { ...snapshotLocation, bucket: restoredFrom.bucket, key: restoredFrom.key }
      });
    } finally {
      snapshotDb.close();
    }

    let recovery: { id: string; key: string } | null = null;
    try {
      const created = await createRecoverySnapshot(sqlite);
      recovery = { id: created.id, key: created.key };
      cleanupOldRecoveries(createS3Client().client, created.location.bucket, 10).catch(() => undefined);
    } catch (error) {
      throw new RestoreValidationError("Recovery snapshot failed", {
        kind: "recovery_failed",
        summary: toSafeRestoreSummary(error),
        snapshot: {
          bucket: snapshotLocation.bucket,
          key: snapshotLocation.key,
          region: snapshotLocation.region,
          endpoint: snapshotLocation.endpoint
        }
      });
    }

    const attachedName = "restore_snapshot";
    sqlite.prepare(`ATTACH DATABASE ? AS ${quoteIdentifier(attachedName)}`).run(tempPath);
    try {
      sqlite.pragma("foreign_keys = OFF");
      sqlite.transaction(() => {
        for (const table of restorableTables) {
          const quotedTable = quoteIdentifier(table);
          const sourceTable = `${quoteIdentifier(attachedName)}.${quotedTable}`;
          const columns = readColumns(sqlite, table);
          const quotedColumns = columns.map(quoteIdentifier).join(", ");
          sqlite.exec(`DELETE FROM ${quotedTable};`);
          sqlite.exec(
            `INSERT INTO ${quotedTable} (${quotedColumns}) SELECT ${quotedColumns} FROM ${sourceTable};`
          );
        }
      })();

      sqlite.pragma("foreign_keys = ON");
      const fkFailures = sqlite
        .prepare("PRAGMA foreign_key_check;")
        .all() as Array<{ table: string; rowid: number; parent: string; fkid: number }>;
      if (fkFailures.length > 0) {
        throw new RestoreValidationError("Live foreign key check failed after restore", {
          kind: "copy_failed",
          summary: "Restore hat Foreign-Key Fehler erzeugt.",
          recovery: recovery ?? undefined,
          foreignKeyFailures: fkFailures
        });
      }

      console.log(
        `[Hermes] Restored live SQLite data from s3://${restoredFrom.bucket}/${restoredFrom.key}`
      );

      return {
        restoredFrom: restoredFrom,
        recovery: recovery ?? undefined
      };
    } catch (error) {
      if (error instanceof RestoreValidationError) {
        throw error;
      }
      throw new RestoreValidationError("Restore copy failed", {
        kind: "copy_failed",
        summary: toSafeRestoreSummary(error),
        snapshot: {
          bucket: snapshotLocation.bucket,
          key: snapshotLocation.key,
          region: snapshotLocation.region,
          endpoint: snapshotLocation.endpoint
        },
        recovery: recovery ?? undefined
      });
    } finally {
      sqlite.prepare(`DETACH DATABASE ${quoteIdentifier(attachedName)}`).run();
      sqlite.pragma("foreign_keys = ON");
    }
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

export async function persistDatabaseSnapshot(sqlite: Database.Database, databasePath = getDatabasePath()) {
  if (!isS3SnapshotOperational(sqlite)) {
    return;
  }

  if (!fs.existsSync(databasePath)) {
    return;
  }

  sqlite.pragma("wal_checkpoint(TRUNCATE)");

  const location = readS3LocationConfig();
  try {
    const { bucket, key, client } = createS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fs.createReadStream(databasePath),
        ContentType: "application/vnd.sqlite3"
      })
    );
    tryWriteBackupStatus(sqlite, {
      lastSuccessAt: new Date().toISOString(),
      lastFailureAt: null,
      failureCode: null,
      failureSummary: null,
      location
    });
  } catch (error) {
    tryWriteBackupStatus(sqlite, {
      lastFailureAt: new Date().toISOString(),
      failureCode: "backup_fehlgeschlagen",
      failureSummary: toSafeBackupFailureSummary(error),
      location
    });
    throw error;
  }
}

export async function flushDatabaseSnapshot(sqlite: Database.Database) {
  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
    snapshotTimer = undefined;
  }

  await persistDatabaseSnapshot(sqlite);
}

export function scheduleDatabaseSnapshot(sqlite: Database.Database) {
  if (!isS3SnapshotOperational(sqlite)) {
    return;
  }

  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
  }

  snapshotTimer = setTimeout(() => {
    snapshotTimer = undefined;
    persistDatabaseSnapshot(sqlite).catch((error) => {
      console.error("[Hermes] Failed to persist SQLite snapshot to S3", error);
    });
  }, 1_000);
}
