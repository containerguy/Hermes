import React from "react";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/catalog/index";

/** Hinweis für Gäste auf Seiten, die nur angemeldet Sinn ergeben. */
export function LoginRequired({ eyebrowKey }: { eyebrowKey: MessageKey }) {
  const { t } = useI18n();
  return (
    <section className="access-panel" aria-label={t(eyebrowKey)}>
      <p className="eyebrow">{t(eyebrowKey)}</p>
      <h2>{t("main.guest.title")}</h2>
      <p className="muted">{t("main.guest.body")}</p>
      <a className="text-link" href="#login">
        {t("main.guest.login")}
      </a>
    </section>
  );
}
