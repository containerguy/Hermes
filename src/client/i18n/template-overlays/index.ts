import type { AppLocale } from "../../../shared/locale";
import type { ProjectTemplateId } from "../../../shared/project-template";
import type { MessageKey } from "../catalog";
import { tableTennisDe } from "./table-tennis-de";
import { tableTennisEn } from "./table-tennis-en";

export function getTemplateMessageOverride(
  locale: AppLocale,
  template: ProjectTemplateId
): Partial<Record<MessageKey, string>> {
  if (template === "lan_party") {
    return {};
  }
  return locale === "en" ? tableTennisEn : tableTennisDe;
}
