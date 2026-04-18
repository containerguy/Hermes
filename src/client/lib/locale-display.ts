import type { AppLocale } from "../../shared/locale";
import { browserLanguageToLocale } from "../../shared/locale";
import type { AppSettings, User } from "../types/core";

export function resolveEffectiveLocale(
  user: User | null,
  settings: AppSettings,
  browserLanguage: string
): AppLocale {
  if (user?.locale === "de" || user?.locale === "en") {
    return user.locale;
  }
  return browserLanguageToLocale(browserLanguage, settings.defaultLocale);
}
