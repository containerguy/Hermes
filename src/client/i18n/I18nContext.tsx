import React, { createContext, useContext, useMemo } from "react";
import type { AppLocale } from "../../shared/locale";
import { MESSAGES, type MessageKey } from "./catalog/index";

export type TFunction = (key: MessageKey, vars?: Record<string, string | number>) => string;

type I18nValue = {
  locale: AppLocale;
  t: TFunction;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, children }: { locale: AppLocale; children: React.ReactNode }) {
  const value = useMemo(() => {
    const table = MESSAGES[locale];
    const t: TFunction = (key, vars) => {
      let s = table[key];
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.replaceAll(`{${k}}`, String(v));
        }
      }
      return s;
    };
    return { locale, t };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
