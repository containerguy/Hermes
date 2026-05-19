import React, { FormEvent } from "react";
import type { AppSettings } from "../types/core";
import { useI18n } from "../i18n/I18nContext";

interface AdminPanelDesignProps {
  settings: AppSettings;
  onSettingsChange: (next: AppSettings) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function AdminPanelDesign({ settings, onSettingsChange, onSubmit }: AdminPanelDesignProps) {
  const { t } = useI18n();

  const colorFields: Array<{ key: keyof AppSettings; label: string }> = [
    { key: "themePrimaryColor", label: t("admin.design.primary") },
    { key: "themeLoginColor", label: t("admin.design.login") },
    { key: "themeManagerColor", label: t("admin.design.manager") },
    { key: "themeAdminColor", label: t("admin.design.admin") },
    { key: "themeSurfaceColor", label: t("admin.design.surface") }
  ];

  return (
    <>
      <header className="admin-section-head">
        <p className="eyebrow">{t("main.admin.nav.design")}</p>
        <h2>{t("admin.design.title")}</h2>
      </header>
      <form id="admin-design" onSubmit={onSubmit} className="admin-form">
        <p className="muted">{t("admin.design.help")}</p>
        <p className="muted">{t("admin.design.help2")}</p>
        <div className="color-grid" aria-label={t("admin.design.colorsAria")}>
          {colorFields.map((field) => (
            <label key={field.key}>
              {field.label}
              <input
                type="color"
                value={settings[field.key] as string}
                onChange={(event) =>
                  onSettingsChange({ ...settings, [field.key]: event.target.value })
                }
              />
            </label>
          ))}
        </div>
        <button type="submit">{t("admin.settings.save")}</button>
      </form>
    </>
  );
}
