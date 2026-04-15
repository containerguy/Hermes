import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getDatabasePath } from "../env";

type S3Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
};

let snapshotTimer: NodeJS.Timeout | undefined;

function isS3StorageEnabled() {
  return process.env.HERMES_STORAGE_BACKEND === "s3";
}

function readCredentialFile(filePath: string): Partial<S3Credentials> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`S3 credentials file not found: ${filePath}`);
  }

  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const values: Record<string, string> = {};
  const bareValues: string[] = [];

  for (const line of lines) {
    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      bareValues.push(line);
      continue;
    }

    values[line.slice(0, separatorIndex).trim().toLowerCase()] = line
      .slice(separatorIndex + 1)
      .trim();
  }

  return {
    accessKeyId:
      values.aws_access_key_id ?? values.access_key_id ?? values.access_key ?? bareValues[0],
    secretAccessKey:
      values.aws_secret_access_key ??
      values.secret_access_key ??
      values.secret_key ??
      bareValues[1]
  };
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
    throw new Error("S3 storage is enabled, but S3 credentials are missing.");
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

  const { bucket, key, client } = createS3Client();

  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await result.Body?.transformToByteArray();

    if (!bytes) {
      return;
    }

    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.writeFileSync(databasePath, Buffer.from(bytes));
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

export async function persistDatabaseSnapshot(sqlite: Database.Database, databasePath = getDatabasePath()) {
  if (!isS3StorageEnabled()) {
    return;
  }

  if (!fs.existsSync(databasePath)) {
    return;
  }

  sqlite.pragma("wal_checkpoint(TRUNCATE)");

  const { bucket, key, client } = createS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(databasePath),
      ContentType: "application/vnd.sqlite3"
    })
  );
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
