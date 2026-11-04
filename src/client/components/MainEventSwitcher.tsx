import React, { useEffect, useState } from "react";
import type { MainEvent, User } from "../types/core";
import { requestJson } from "../api/request";
import { useI18n } from "../i18n/I18nContext";
import { subscribeEventsChanged } from "../realtime/events-changed-bus";

const statusOrder: Record<MainEvent["status"], number> = { running: 0, planned: 1, ended: 2 };

/**
 * Globaler Event-Umschalter im Seitenkopf: das gewählte Event gilt als Vorauswahl und Filter
 * auf allen Seiten und wird am Benutzer gespeichert (gilt auf allen Geräten).
 */
export function MainEventSwitcher({
  currentUser,
  onUserChange
}: {
  currentUser: User;
  onUserChange: (user: User) => void;
}) {
  const { t } = useI18n();
  const [mainEvents, setMainEvents] = useState<MainEvent[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const result = await requestJson<{ mainEvents: MainEvent[] }>("/api/main-events");
    setMainEvents(result?.mainEvents ?? []);
  }

  useEffect(() => {
    const reload = () => {
      load().catch(() => undefined);
    };
    reload();
    // Live-Signale kommen nur, solange die Rundenübersicht offen ist; beim Seitenwechsel neu laden.
    window.addEventListener("hashchange", reload);
    const unsubscribe = subscribeEventsChanged(reload);
    return () => {
      window.removeEventListener("hashchange", reload);
      unsubscribe();
    };
  }, [currentUser.id]);

  const open = mainEvents
    .filter((entry) => entry.status !== "ended")
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
  if (open.length === 0) {
    return null;
  }
  const value = open.some((entry) => entry.id === currentUser.currentMainEventId)
    ? (currentUser.currentMainEventId as string)
    : "";

  async function choose(mainEventId: string) {
    setBusy(true);
    try {
      const result = await requestJson<{ user: User }>("/api/main-events/current", {
        method: "PUT",
        body: JSON.stringify({ mainEventId: mainEventId || null })
      });
      if (result?.user) onUserChange(result.user);
    } catch {
      /* Auswahl bleibt unverändert; beim nächsten Laden stimmt die Anzeige wieder */
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="main-event-switcher">
      <select
        aria-label={t("mainEvents.switcher.label")}
        value={value}
        disabled={busy}
        onChange={(ev) => choose(ev.target.value)}
      >
        <option value="">{t("mainEvents.switcher.all")}</option>
        {open.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.status === "running" ? `● ${entry.name}` : entry.name}
          </option>
        ))}
      </select>
    </label>
  );
}
