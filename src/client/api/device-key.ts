export const DEVICE_KEY_STORAGE_KEY = "hermes_device_key_v1";
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
    const existing = window.localStorage.getItem(DEVICE_KEY_STORAGE_KEY);
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
  } catch {
    // swallow; nothing to do if storage is inaccessible
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
