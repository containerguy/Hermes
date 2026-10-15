import fs from "node:fs";
import path from "node:path";

function loadLocalEnvFile() {
  const envPath = path.join(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadLocalEnvFile();

export function getDatabasePath() {
  return process.env.HERMES_DB_PATH ?? path.join(process.cwd(), "data", "hermes.sqlite");
}

export function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

/**
 * Zugangsdaten für das AMP-Dienstkonto (Phase 15). Bewusst nur aus der Umgebung,
 * damit sie nie in app_settings, Settings-Exporten oder S3-Snapshots landen.
 */
export function getAmpCredentials() {
  const username = process.env.HERMES_AMP_USERNAME?.trim();
  const password = process.env.HERMES_AMP_PASSWORD;
  if (!username || !password) {
    return null;
  }
  const rememberTokenFile = process.env.HERMES_AMP_REMEMBER_TOKEN_FILE?.trim() || undefined;
  return { username, password, rememberTokenFile };
}

let warnedMissingCa = false;

/** PEM der CA für den AMP-Controller; leer = System-Trust-Store (nie skipVerify). */
export function getAmpCaFile() {
  const file = process.env.HERMES_AMP_CA_FILE?.trim();
  if (!file) {
    return undefined;
  }
  if (!fs.existsSync(file) && !warnedMissingCa) {
    warnedMissingCa = true;
    console.warn(`[Hermes] HERMES_AMP_CA_FILE zeigt auf eine fehlende Datei: ${file}`);
  }
  return file;
}
