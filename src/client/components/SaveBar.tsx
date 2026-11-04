import React from "react";
import { useI18n } from "../i18n/I18nContext";

/**
 * Speichern-Knopf eines Einstellungsformulars. Bei ungespeicherten Änderungen klebt die Leiste
 * am unteren Rand und sagt das an, damit man nicht ans Ende scrollen muss.
 */
export function SaveBar({ dirty }: { dirty: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`save-bar${dirty ? " save-bar--dirty" : ""}`}>
      {dirty ? (
        <p className="save-bar__hint" role="status">
          {t("admin.settings.unsaved")}
        </p>
      ) : null}
      <button type="submit">{t("admin.settings.save")}</button>
    </div>
  );
}
