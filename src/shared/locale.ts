import { z } from "zod";

export type AppLocale = "de" | "en";

export const appLocaleSchema = z.enum(["de", "en"]);

/**
 * Primäre Browsersprache → App-Locale; bei Unklarheit `fallback` (Admin-Default, üblicherweise de).
 */
export function browserLanguageToLocale(language: string | undefined | null, fallback: AppLocale): AppLocale {
  if (!language || typeof language !== "string") {
    return fallback;
  }
  const primary = language.split(",")[0]?.trim().toLowerCase() ?? "";
  if (primary.startsWith("de")) {
    return "de";
  }
  if (primary.startsWith("en")) {
    return "en";
  }
  return fallback;
}
