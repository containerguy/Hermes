import React, { FormEvent } from "react";
import type { AppSettings } from "../types/core";
import { useI18n } from "../i18n/I18nContext";

interface AdminPanelInfosProps {
  settings: AppSettings;
  onSettingsChange: (next: AppSettings) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function AdminPanelInfos({ settings, onSettingsChange, onSubmit }: AdminPanelInfosProps) {
  const { t } = useI18n();

  return (
    <>
      <header className="admin-section-head">
        <p className="eyebrow">{t("main.admin.nav.infos")}</p>
        <h2>{t("admin.infos.title")}</h2>
        <p className="muted">{t("admin.infos.help")}</p>
      </header>
      <form id="admin-infos" onSubmit={onSubmit} className="admin-form">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.infosEnabled}
            onChange={(event) =>
              onSettingsChange({ ...settings, infosEnabled: event.target.checked })
            }
          />
          {t("admin.infos.menuCheck")}
        </label>
        <label>
          {t("admin.infos.markdownLabel")}
          <textarea
            value={settings.infosMarkdown}
            onChange={(event) =>
              onSettingsChange({ ...settings, infosMarkdown: event.target.value })
            }
            rows={18}
            maxLength={100_000}
            spellCheck="true"
            aria-label={t("admin.infos.markdownAria")}
            placeholder={t("admin.infos.markdownPlaceholder")}
          />
        </label>
        <button type="submit">{t("admin.settings.save")}</button>
      </form>
    </>
  );
}
