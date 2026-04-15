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
