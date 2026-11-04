import React, { useEffect, useState } from "react";
import type { MainEvent } from "../types/core";
import { requestJson } from "../api/request";
import { useI18n } from "../i18n/I18nContext";

/** Auswahl, welches Event der Kiosk zeigt (leer = alle laufenden Events gruppiert). */
export function KioskEventSelect({ value, onChange }: { value: string; onChange: (mainEventId: string) => void }) {
  const { t } = useI18n();
  const [mainEvents, setMainEvents] = useState<MainEvent[]>([]);

  useEffect(() => {
    requestJson<{ mainEvents: MainEvent[] }>("/api/main-events")
      .then((result) => setMainEvents((result?.mainEvents ?? []).filter((entry) => entry.status !== "ended")))
      .catch(() => undefined);
  }, []);

  const known = mainEvents.some((entry) => entry.id === value);
  return (
    <label>
      {t("admin.kiosk.event")}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t("admin.kiosk.eventAll")}</option>
        {mainEvents.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
        {value && !known ? <option value={value}>{t("admin.kiosk.eventGone")}</option> : null}
      </select>
    </label>
  );
}
