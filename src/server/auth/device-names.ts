import { z } from "zod";

const deviceNameSchema = z.string().trim().min(1).max(120);

export function validateDeviceName(name: string) {
  const parsed = deviceNameSchema.safeParse(name);
  if (!parsed.success) {
    return { ok: false as const, error: "ungueltiger_geraetename" as const };
  }
  return { ok: true as const, name: parsed.data };
}

function deriveDeviceName(userAgent: string | undefined) {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "Unbekanntes Geraet";

  if (ua.includes("iphone")) return "iPhone";
  if (ua.includes("ipad")) return "iPad";
  if (ua.includes("android")) {
    if (ua.includes("mobile")) return "Android-Smartphone";
    return "Android-Tablet";
  }
  if (ua.includes("windows")) return "Windows-PC";
  if (ua.includes("macintosh") || ua.includes("mac os x")) return "Mac";
  if (ua.includes("linux")) return "Linux-PC";
  if (ua.includes("mobile")) return "Smartphone";
  return "PC";
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

