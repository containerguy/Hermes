import { createHmac } from "node:crypto";

export const DEVICE_KEY_BYTES = 16;
export const DEVICE_KEY_BASE64URL_MIN_LENGTH = 22;

function deviceKeySecret() {
  return process.env.HERMES_DEVICE_KEY_SECRET ?? "hermes-dev-device-key-secret";
}

export function hashDeviceKey(rawKey: string): string {
  return createHmac("sha256", deviceKeySecret()).update(rawKey).digest("hex");
}

export type NormalizedDeviceSignals = {
  platform: "ios" | "android" | "windows" | "macos" | "linux" | "other";
  browser: "chrome" | "firefox" | "safari" | "edge" | "other";
  deviceClass: "mobile" | "desktop";
  pwa: boolean;
};

export function normalizeDeviceSignals(input: {
  userAgent: string | undefined;
  pwa?: boolean | undefined;
}): NormalizedDeviceSignals {
  const ua = (input.userAgent ?? "").toLowerCase();

  const platform: NormalizedDeviceSignals["platform"] =
    ua.includes("iphone") || ua.includes("ipad")
      ? "ios"
      : ua.includes("android")
        ? "android"
        : ua.includes("windows")
          ? "windows"
          : ua.includes("mac os x") || ua.includes("macintosh")
            ? "macos"
            : ua.includes("linux")
              ? "linux"
              : "other";

  const browser: NormalizedDeviceSignals["browser"] = ua.includes("edg/")
    ? "edge"
    : ua.includes("chrome/")
      ? "chrome"
      : ua.includes("firefox/")
        ? "firefox"
        : ua.includes("safari/") && !ua.includes("chrome/")
          ? "safari"
          : "other";

  const deviceClass: NormalizedDeviceSignals["deviceClass"] =
    ua.includes("mobile") || ua.includes("iphone") || ua.includes("android")
      ? "mobile"
      : "desktop";

  return { platform, browser, deviceClass, pwa: input.pwa === true };
}

export function deviceSignalsFingerprint(signals: NormalizedDeviceSignals): string {
  return `${signals.platform}|${signals.browser}|${signals.deviceClass}|${signals.pwa ? "pwa" : "web"}`;
}
