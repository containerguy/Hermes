import React, { useEffect, useState } from "react";
import type { MainEvent } from "../types/core";
import { requestJson } from "../api/request";
import { getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import { subscribeEventsChanged } from "../realtime/events-changed-bus";

const DISMISS_KEY = "hermes.mainEventPrompt.dismissed";

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(mainEventId: string) {
  try {
    window.sessionStorage.setItem(DISMISS_KEY, mainEventId);
  } catch {
    /* ohne Storage fragt die Karte beim nächsten Laden erneut */
  }
}

/**
 * Fragt nach Login bzw. beim Öffnen der App, ob man am laufenden Event teilnimmt,
 * solange man sich dazu noch nicht entschieden hat. „Später" blendet die Frage für diese Sitzung aus.
 */
export function MainEventPrompt({ currentUserId }: { currentUserId: string }) {
  const { t, locale } = useI18n();
  const [running, setRunning] = useState<MainEvent | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => readDismissed());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const result = await requestJson<{ mainEvents: MainEvent[] }>("/api/main-events");
    setRunning(result?.mainEvents?.find((entry) => entry.status === "running") ?? null);
  }

  useEffect(() => {
    load().catch(() => undefined);
    return subscribeEventsChanged(() => {
      load().catch(() => undefined);
    });
  }, [currentUserId]);

  if (!running || running.myParticipation !== null || dismissed === running.id) {
    return null;
  }

  const mainEvent = running;

  async function answer(status: "joined" | "declined") {
    setBusy(true);
    setError("");
    try {
      const result = await requestJson<{ mainEvent: MainEvent }>(`/api/main-events/${mainEvent.id}/participation`, {
        method: "POST",
        body: JSON.stringify({ status })
      });
      setRunning(result.mainEvent);
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="main-event-prompt" role="region" aria-label={t("mainEvents.prompt.aria")}>
      <p className="eyebrow">{t("mainEvents.prompt.eyebrow")}</p>
      <h2>{t("mainEvents.prompt.title", { name: mainEvent.name })}</h2>
      {mainEvent.description ? <p className="muted">{mainEvent.description}</p> : null}
      <p className="muted">{t("mainEvents.prompt.body")}</p>
      {error ? <p className="error">{error}</p> : null}
      <div className="action-row">
        <button type="button" disabled={busy} onClick={() => answer("joined")}>
          {t("mainEvents.participation.join")}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => answer("declined")}>
          {t("mainEvents.participation.decline")}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            writeDismissed(mainEvent.id);
            setDismissed(mainEvent.id);
          }}
        >
          {t("mainEvents.prompt.later")}
        </button>
      </div>
    </section>
  );
}
