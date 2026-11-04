import React, { useEffect, useState } from "react";
import type { MainEvent } from "../types/core";
import { requestJson } from "../api/request";
import { getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import { subscribeEventsChanged } from "../realtime/events-changed-bus";

const DISMISS_KEY = "matchdesk.mainEventPrompt.dismissed";

function readDismissed(): string[] {
  try {
    const raw = window.sessionStorage.getItem(DISMISS_KEY);
    if (!raw) return [];
    // Früher stand hier eine einzelne Event-ID statt einer Liste.
    if (!raw.startsWith("[")) return [raw];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[]) {
  try {
    window.sessionStorage.setItem(DISMISS_KEY, JSON.stringify(ids));
  } catch {
    /* ohne Storage fragt die Karte beim nächsten Laden erneut */
  }
}

function isUndecided(entry: MainEvent) {
  // Interessenten werden beim laufenden Event noch einmal gefragt; Nachrücker warten auf einen Platz.
  return entry.myParticipation === null || entry.myParticipation === "interested";
}

/**
 * Fragt nach Login bzw. beim Öffnen der App, ob man an laufenden Events teilnimmt,
 * solange man sich dazu noch nicht entschieden hat. Laufen mehrere, kommen sie nacheinander.
 * „Später" blendet die Frage zu diesem Event für diese Sitzung aus.
 */
export function MainEventPrompt({ currentUserId }: { currentUserId: string }) {
  const { t, locale } = useI18n();
  const [running, setRunning] = useState<MainEvent[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const result = await requestJson<{ mainEvents: MainEvent[] }>("/api/main-events");
    setRunning(result?.mainEvents?.filter((entry) => entry.status === "running") ?? []);
  }

  useEffect(() => {
    load().catch(() => undefined);
    return subscribeEventsChanged(() => {
      load().catch(() => undefined);
    });
  }, [currentUserId]);

  const pending = running.filter((entry) => isUndecided(entry) && !dismissed.includes(entry.id));
  const mainEvent = pending[0];
  if (!mainEvent) {
    return null;
  }

  async function answer(status: "joined" | "declined") {
    setBusy(true);
    setError("");
    try {
      const result = await requestJson<{ mainEvent: MainEvent }>(`/api/main-events/${mainEvent.id}/participation`, {
        method: "POST",
        body: JSON.stringify({ status })
      });
      setRunning((current) => current.map((entry) => (entry.id === result.mainEvent.id ? result.mainEvent : entry)));
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
            const next = [...dismissed, mainEvent.id];
            writeDismissed(next);
            setDismissed(next);
          }}
        >
          {t("mainEvents.prompt.later")}
        </button>
      </div>
    </section>
  );
}
