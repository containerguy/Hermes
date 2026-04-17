import { z } from "zod";

const deviceNameSchema = z.string().trim().min(1).max(120);

export function validateDeviceName(name: string) {
  const parsed = deviceNameSchema.safeParse(name);
  if (!parsed.success) {
    return { ok: false as const, error: "ungueltiger_geraetename" as const };
  }
  return { ok: true as const, name: parsed.data };
}

function deriveBrowserLabel(ua: string) {
  if (ua.includes("edg/")) return "Edge";
  if (ua.includes("opr/") || ua.includes("opera")) return "Opera";
  if (ua.includes("chrome/") || ua.includes("crios/")) return "Chrome";
  if (ua.includes("firefox/") || ua.includes("fxios/")) return "Firefox";
  if (ua.includes("safari/") && !ua.includes("chrome/") && !ua.includes("crios/")) {
    return "Safari";
  }
  if (ua.includes("samsungbrowser/")) return "Samsung Internet";
  return null;
}

function joinDeviceParts(parts: Array<string | null>) {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

function deriveDeviceName(userAgent: string | undefined) {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "Unbekanntes Geraet";

  if (ua.includes("iphone")) return joinDeviceParts(["iPhone", deriveBrowserLabel(ua)]);
  if (ua.includes("ipad")) return joinDeviceParts(["iPad", deriveBrowserLabel(ua)]);
  if (ua.includes("android")) {
    const androidClass = ua.includes("mobile") ? "Android-Smartphone" : "Android-Tablet";
    return joinDeviceParts([androidClass, deriveBrowserLabel(ua)]);
  }
  if (ua.includes("windows")) return joinDeviceParts(["Windows-Desktop", deriveBrowserLabel(ua)]);
  if (ua.includes("macintosh") || ua.includes("mac os x")) {
    return joinDeviceParts(["Mac", deriveBrowserLabel(ua)]);
  }
  if (ua.includes("linux")) return joinDeviceParts(["Linux-PC", deriveBrowserLabel(ua)]);
  if (ua.includes("mobile")) return joinDeviceParts(["Smartphone", deriveBrowserLabel(ua)]);
  return joinDeviceParts(["PC", deriveBrowserLabel(ua)]);
}

export function resolveDeviceName(
  submittedName: string | undefined,
  userAgent: string | undefined
) {
  const submitted = submittedName?.trim() ?? "";
  if (submitted) {
    const validated = validateDeviceName(submitted);
    if (validated.ok) {
      return validated.name;
    }
  }
  return deriveDeviceName(userAgent);
}

