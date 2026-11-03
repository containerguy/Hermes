const DEVICE_KEY_STORAGE_KEY = "matchdesk_device_key_v1";
const KNOWN_DEVICE_STORAGE_KEY = "matchdesk_known_device_v1";
/**
 * Schlüssel vor der Umbenennung. Werden beim ersten Lesen übernommen und bleiben bis v1.0
 * liegen, damit ein Rollback auf eine ältere Version das Gerät weiter erkennt.
 */
const LEGACY_DEVICE_KEY_STORAGE_KEY = "hermes_device_key_v1";
const LEGACY_KNOWN_DEVICE_STORAGE_KEY = "hermes_known_device_v1";

/** Liest den neuen Schlüssel, sonst den alten und kopiert ihn auf den neuen. Kann werfen. */
function readMigrated(key: string, legacyKey: string): string | null {
  const current = window.localStorage.getItem(key);
  if (current !== null) {
    return current;
  }
  const legacy = window.localStorage.getItem(legacyKey);
  if (legacy !== null) {
    try {
      window.localStorage.setItem(key, legacy);
    } catch {
      // Quota/blocked: alter Wert wird weiter direkt gelesen.
    }
  }
  return legacy;
}
const DEVICE_KEY_BYTES = 16;
const DEVICE_KEY_PATTERN = /^[A-Za-z0-9_-]{22,44}$/;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function generateDeviceKey(): string {
  const bytes = new Uint8Array(DEVICE_KEY_BYTES);
  window.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function getOrCreateDeviceKey(): string {
  try {
    const existing = readMigrated(DEVICE_KEY_STORAGE_KEY, LEGACY_DEVICE_KEY_STORAGE_KEY);
    if (existing && DEVICE_KEY_PATTERN.test(existing)) {
      return existing;
    }
  } catch {
    return generateDeviceKey();
  }

  const fresh = generateDeviceKey();
  try {
    window.localStorage.setItem(DEVICE_KEY_STORAGE_KEY, fresh);
  } catch {
    // localStorage may be blocked (private mode); fall through to the per-load ephemeral key.
  }
  return fresh;
}

export function forgetDeviceKey(): void {
  try {
    window.localStorage.removeItem(DEVICE_KEY_STORAGE_KEY);
    window.localStorage.removeItem(KNOWN_DEVICE_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_DEVICE_KEY_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_KNOWN_DEVICE_STORAGE_KEY);
  } catch {
    // swallow; nothing to do if storage is inaccessible
  }
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

/**
 * Remembers (display only) under which name the server knows this browser for a user,
 * so the login form can skip the device-name field. The server stays the source of truth.
 * The email is stored too, because the login form accepts username or email.
 */
export function rememberKnownDevice(username: string, deviceName: string, email?: string | null): void {
  const user = normalizeUsername(username);
  const name = deviceName.trim();
  if (!user || !name) {
    return;
  }
  const mail = email ? normalizeUsername(email) : "";
  try {
    window.localStorage.setItem(
      KNOWN_DEVICE_STORAGE_KEY,
      JSON.stringify(mail ? { username: user, email: mail, name } : { username: user, name })
    );
  } catch {
    // storage blocked: the login form simply shows the optional name field
  }
}

/** Accepts the login identifier as typed: username or email, case-insensitive. */
export function getKnownDeviceName(identifier: string): string | null {
  const key = normalizeUsername(identifier);
  if (!key) {
    return null;
  }
  try {
    const raw = readMigrated(KNOWN_DEVICE_STORAGE_KEY, LEGACY_KNOWN_DEVICE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { username?: unknown; email?: unknown; name?: unknown };
    const matches = parsed.username === key || (typeof parsed.email === "string" && parsed.email === key);
    if (matches && typeof parsed.name === "string" && parsed.name.trim()) {
      return parsed.name;
    }
  } catch {
    // ignore unreadable or malformed storage
  }
  return null;
}

export function isIos(): boolean {
  try {
    const nav = window.navigator;
    const ua = nav.userAgent.toLowerCase();
    // iPadOS reports itself as Macintosh; touch support tells it apart from a Mac.
    return /iphone|ipad|ipod/.test(ua) || (ua.includes("macintosh") && nav.maxTouchPoints > 1);
  } catch {
    return false;
  }
}

export function isPwa(): boolean {
  try {
    const standaloneMatch =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(display-mode: standalone)").matches === true
        : false;
    if (standaloneMatch) {
      return true;
    }
    const iosStandalone = (window.navigator as unknown as { standalone?: boolean })
      .standalone;
    return iosStandalone === true;
  } catch {
    return false;
  }
}

export function getDeviceContext(): { deviceKey: string; pwa: boolean } {
  return { deviceKey: getOrCreateDeviceKey(), pwa: isPwa() };
}
