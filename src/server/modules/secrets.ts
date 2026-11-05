import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { readEnv } from "../env";

/**
 * Verschlüsselung der Modul-Zugangsdaten in `module_secrets`. Der Schlüssel wird aus
 * MATCHDESK_DEVICE_KEY_SECRET abgeleitet (darf nach dem ersten Start nie mehr geändert werden),
 * damit Tokens nicht im Klartext in Datenbank und Backups stehen.
 */
const VERSION = "v1";
const DEV_FALLBACK = "hermes-dev-device-key-secret";

export function moduleSecretKeyIsDefault() {
  return !readEnv("DEVICE_KEY_SECRET");
}

function key() {
  const secret = readEnv("DEVICE_KEY_SECRET") ?? DEV_FALLBACK;
  return Buffer.from(hkdfSync("sha256", secret, "matchdesk", "module-secrets", 32));
}

function aad(moduleId: string, name: string) {
  return Buffer.from(`${moduleId}:${name}`, "utf8");
}

export function encryptModuleSecret(moduleId: string, name: string, value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(aad(moduleId, name));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

/** `null`, wenn der Wert nicht (mehr) lesbar ist, z. B. nach geändertem Schlüssel. */
export function decryptModuleSecret(moduleId: string, name: string, stored: string): string | null {
  const [version, payload] = stored.split(":", 2);
  if (version !== VERSION || !payload) return null;
  try {
    const raw = Buffer.from(payload, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAAD(aad(moduleId, name));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
