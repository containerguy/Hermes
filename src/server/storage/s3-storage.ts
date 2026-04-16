import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

function isS3StorageEnabled() {
  return process.env.HERMES_STORAGE_BACKEND === "s3";
}

export function getStorageBackend(): StorageBackend {
  return isS3StorageEnabled() ? "s3" : "disabled";
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

export function getS3LocationDetails(): S3LocationDetails | null {
  if (!isS3StorageEnabled()) {
    return null;
  }
  return readS3LocationConfig();
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

export async function restoreDatabaseFromStorageIfNeeded(databasePath = getDatabasePath()) {
  if (!isS3StorageEnabled()) {
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
  if (!isS3StorageEnabled()) {
    throw new Error("S3 storage is not enabled.");
  }

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-restore-"));
  const tempPath = path.join(tempDirectory, "snapshot.sqlite");

  try {
    const { bucket, key } = await downloadSnapshotToFile(tempPath);
    const attachedName = "restore_snapshot";
    sqlite.prepare(`ATTACH DATABASE ? AS ${quoteIdentifier(attachedName)}`).run(tempPath);

    try {
      sqlite.pragma("foreign_keys = OFF");
      sqlite.transaction(() => {
        for (const table of restorableTables) {
          const quotedTable = quoteIdentifier(table);
          const sourceTable = `${quoteIdentifier(attachedName)}.${quotedTable}`;
          const exists = sqlite
            .prepare(
              `SELECT name FROM ${quoteIdentifier(attachedName)}.sqlite_master WHERE type = 'table' AND name = ?`
            )
            .get(table);

          if (!exists) {
            continue;
          }

          sqlite.exec(`DELETE FROM ${quotedTable};`);
          sqlite.exec(`INSERT INTO ${quotedTable} SELECT * FROM ${sourceTable};`);
        }
      })();
      sqlite.pragma("foreign_keys = ON");
      sqlite.exec("PRAGMA foreign_key_check;");
      console.log(`[Hermes] Restored live SQLite data from s3://${bucket}/${key}`);
    } finally {
      sqlite.prepare(`DETACH DATABASE ${quoteIdentifier(attachedName)}`).run();
      sqlite.pragma("foreign_keys = ON");
    }
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

export async function persistDatabaseSnapshot(sqlite: Database.Database, databasePath = getDatabasePath()) {
  if (!isS3StorageEnabled()) {
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
  if (!isS3StorageEnabled()) {
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
