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

/** Neues Präfix der Umgebungsvariablen (Umbenennung Hermes → Matchdesk). */
export const ENV_PREFIX = "MATCHDESK_";
/** Altes Präfix; wird bis v1.0 weiter gelesen. */
export const LEGACY_ENV_PREFIX = "HERMES_";

/**
 * Liest eine Einstellung aus der Umgebung: zuerst `MATCHDESK_<name>`, sonst `HERMES_<name>`.
 * `name` ohne Präfix, z. B. `readEnv("DB_PATH")`. Wird bei jedem Aufruf neu gelesen,
 * damit Tests die Umgebung zur Laufzeit ändern können.
 */
export function readEnv(name: string): string | undefined {
  const current = process.env[`${ENV_PREFIX}${name}`];
  if (current !== undefined) {
    return current;
  }
  return process.env[`${LEGACY_ENV_PREFIX}${name}`];
}

/**
 * Beschreibt, welche alten `HERMES_*`-Variablen noch gesetzt sind und wo sich
 * `MATCHDESK_*` und `HERMES_*` widersprechen. Gibt nur Namen zurück, nie Werte.
 */
export function describeLegacyEnv(env: NodeJS.ProcessEnv = process.env) {
  const legacyOnly: string[] = [];
  const conflicting: string[] = [];
  for (const key of Object.keys(env).sort()) {
    if (!key.startsWith(LEGACY_ENV_PREFIX)) {
      continue;
    }
    const name = key.slice(LEGACY_ENV_PREFIX.length);
    const current = env[`${ENV_PREFIX}${name}`];
    if (current === undefined) {
      legacyOnly.push(name);
    } else if (current !== env[key]) {
      conflicting.push(name);
    }
  }
  return { legacyOnly, conflicting };
}

/** Einmal beim Start: Hinweis auf veraltete Variablen im Log. */
export function warnAboutLegacyEnv(log: (message: string) => void = console.warn) {
  const { legacyOnly, conflicting } = describeLegacyEnv();
  if (legacyOnly.length > 0) {
    log(
      `[Matchdesk] Veraltete Umgebungsvariablen: ${legacyOnly.map((name) => LEGACY_ENV_PREFIX + name).join(", ")}. ` +
        `Sie funktionieren bis v1.0 weiter; bitte auf ${ENV_PREFIX}* umstellen (gleicher Wert).`
    );
  }
  if (conflicting.length > 0) {
    log(
      `[Matchdesk] ${ENV_PREFIX}* und ${LEGACY_ENV_PREFIX}* sind unterschiedlich gesetzt für: ${conflicting.join(", ")}. ` +
        `Es gilt ${ENV_PREFIX}*; die ${LEGACY_ENV_PREFIX}*-Werte werden ignoriert.`
    );
  }
}

const DATABASE_FILE = "matchdesk.sqlite";
const LEGACY_DATABASE_FILE = "hermes.sqlite";
let warnedLegacyDatabase = false;

/**
 * Pfad der SQLite-Datenbank. Standard ist `data/matchdesk.sqlite`. Zeigt der Pfad auf
 * eine noch nicht vorhandene `matchdesk.sqlite`, liegt daneben aber eine `hermes.sqlite`,
 * wird die alte Datei weiter benutzt (kein automatisches Umbenennen wegen WAL-Dateien).
 */
export function getDatabasePath() {
  const configured = readEnv("DB_PATH") ?? path.join(process.cwd(), "data", DATABASE_FILE);
  if (path.basename(configured) !== DATABASE_FILE || fs.existsSync(configured)) {
    return configured;
  }
  const legacy = path.join(path.dirname(configured), LEGACY_DATABASE_FILE);
  if (!fs.existsSync(legacy)) {
    return configured;
  }
  if (!warnedLegacyDatabase) {
    warnedLegacyDatabase = true;
    console.info(`[Matchdesk] ${configured} fehlt, benutze die bestehende Datenbank ${legacy}.`);
  }
  return legacy;
}

/** Pflichtwert aus der Umgebung, `name` ohne Präfix (siehe {@link readEnv}). */
export function readRequiredEnv(name: string) {
  const value = readEnv(name)?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${ENV_PREFIX}${name} (oder ${LEGACY_ENV_PREFIX}${name})`);
  }

  return value;
}

/**
 * Zugangsdaten für das AMP-Dienstkonto (Phase 15). Bewusst nur aus der Umgebung,
 * damit sie nie in app_settings, Settings-Exporten oder S3-Snapshots landen.
 */
export function getAmpCredentials() {
  const username = readEnv("AMP_USERNAME")?.trim();
  const password = readEnv("AMP_PASSWORD");
  if (!username || !password) {
    return null;
  }
  const rememberTokenFile = readEnv("AMP_REMEMBER_TOKEN_FILE")?.trim() || undefined;
  return { username, password, rememberTokenFile };
}

let warnedMissingCa = false;

/** PEM der CA für den AMP-Controller; leer = System-Trust-Store (nie skipVerify). */
export function getAmpCaFile() {
  const file = readEnv("AMP_CA_FILE")?.trim();
  if (!file) {
    return undefined;
  }
  if (!fs.existsSync(file) && !warnedMissingCa) {
    warnedMissingCa = true;
    console.warn(`[Hermes] HERMES_AMP_CA_FILE zeigt auf eine fehlende Datei: ${file}`);
  }
  return file;
}
