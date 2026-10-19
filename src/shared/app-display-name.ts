import type { AppLocale } from "./locale";
import type { ProjectTemplateId } from "./project-template";

/**
 * Eingebaute Anzeigenamen je Projekt-Template und Sprache. Müssen mit `brand.displayName`
 * aus den Client-Katalogen (inkl. Template-Overlays) übereinstimmen – ein Test prüft das.
 */
export const builtinAppDisplayNames: Record<ProjectTemplateId, Record<AppLocale, string>> = {
  lan_party: { de: "Mitspielzentrale", en: "MatchDesk" },
  table_tennis: { de: "Turnierzentrale", en: "Tournament desk" }
};

export const fallbackAppDisplayName = builtinAppDisplayNames.lan_party.de;

/**
 * Ableitung des App-Namens, wie ihn Kopfzeile (Brand-Link) und `document.title` zeigen:
 * eigener Name aus `appName`, sonst der eingebaute Name.
 */
export function pickAppDisplayName(appName: string | null | undefined, builtinName: string): string {
  const custom = typeof appName === "string" ? appName.trim() : "";
  return custom || builtinName;
}

export function builtinAppDisplayName(
  template: ProjectTemplateId | null | undefined,
  locale: AppLocale
): string {
  const byTemplate = builtinAppDisplayNames[template ?? "lan_party"] ?? builtinAppDisplayNames.lan_party;
  return byTemplate[locale] ?? fallbackAppDisplayName;
}

/** Serverseitige Variante: gleiche Logik wie der Client, ohne i18n-Kontext. */
export function resolveAppDisplayName(
  settings: { appName?: string | null; projectTemplate?: ProjectTemplateId | null },
  locale: AppLocale
): string {
  return pickAppDisplayName(settings.appName, builtinAppDisplayName(settings.projectTemplate, locale));
}
