import React, { createContext, useContext, useMemo } from "react";
import type { AppLocale } from "../../shared/locale";
import type { ProjectTemplateId } from "../../shared/project-template";
import { MESSAGES, type MessageKey } from "./catalog/index";
import { getTemplateMessageOverride } from "./template-overlays";

export type TFunction = (key: MessageKey, vars?: Record<string, string | number>) => string;

type I18nValue = {
  locale: AppLocale;
  t: TFunction;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  projectTemplate = "lan_party",
  children
}: {
  locale: AppLocale;
  projectTemplate?: ProjectTemplateId;
  children: React.ReactNode;
}) {
  const value = useMemo(() => {
    const table = MESSAGES[locale];
    const overlay = getTemplateMessageOverride(locale, projectTemplate);
    const t: TFunction = (key, vars) => {
      let s = overlay[key] ?? table[key];
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.replaceAll(`{${k}}`, String(v));
        }
      }
      return s;
    };
    return { locale, t };
  }, [locale, projectTemplate]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
