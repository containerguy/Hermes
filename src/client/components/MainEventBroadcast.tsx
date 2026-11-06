import React, { FormEvent, useEffect, useState } from "react";
import { requestJson } from "../api/request";
import { getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/catalog";
import type { MainEvent } from "../types/core";

const AUDIENCES = ["joined", "interested", "waitlisted", "declined", "no_response"] as const;
type Audience = (typeof AUDIENCES)[number];

type Broadcast = {
  id: string;
  subject: string;
  body: string;
  audience: Audience[];
  recipientCount: number;
  authorUsername: string | null;
  createdAt: string;
  delivered: boolean;
  channels: Record<string, { sent: number; failed: number }>;
  skipped: number;
};

/** WhatsApp-Teilen: öffnet WhatsApp mit vorbereitetem Text, der Organisator wählt die Gruppe. */
export function whatsappShareUrl(text: string) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function eventLink() {
  return `${window.location.origin}/#main-events`;
}

export function eventShareText(mainEvent: MainEvent, dateText: string | null) {
  return [mainEvent.name, dateText, mainEvent.description, eventLink()].filter(Boolean).join("\n");
}

/** Rundnachricht an Teilnehmer eines Events (Mail, Push und Modulkanäle je nach Wahl der Person). */
export function MainEventBroadcast({ mainEvent }: { mainEvent: MainEvent }) {
  const { t, locale } = useI18n();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Set<Audience>>(new Set(["joined", "interested", "waitlisted"]));
  const [history, setHistory] = useState<Broadcast[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadHistory() {
    try {
      const result = await requestJson<{ broadcasts: Broadcast[] }>(`/api/main-events/${mainEvent.id}/broadcasts`);
      setHistory(result?.broadcasts ?? []);
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  useEffect(() => {
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainEvent.id]);

  function toggleAudience(entry: Audience) {
    const next = new Set(audience);
    if (next.has(entry)) {
      next.delete(entry);
    } else {
      next.add(entry);
    }
    setAudience(next);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await requestJson<{ broadcast: Broadcast }>(`/api/main-events/${mainEvent.id}/broadcasts`, {
        method: "POST",
        body: JSON.stringify({ subject, body, audience: Array.from(audience) })
      });
      setMessage(t("broadcast.sent", { n: result?.broadcast.recipientCount ?? 0 }));
      setSubject("");
      setBody("");
      await loadHistory();
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  const shareText = [`${mainEvent.name}: ${subject}`.trim(), body, eventLink()].filter(Boolean).join("\n\n");

  return (
    <div className="main-event-broadcast">
      <h3>{t("broadcast.toggle")}</h3>
      <form className="event-form" onSubmit={send} aria-label={t("broadcast.toggle")}>
        <label>
          {t("broadcast.subject")}
          <input value={subject} onChange={(entry) => setSubject(entry.target.value)} maxLength={150} required />
        </label>
        <label>
          {t("broadcast.body")}
          <textarea value={body} onChange={(entry) => setBody(entry.target.value)} maxLength={5000} rows={6} required />
        </label>
        <fieldset>
          <legend>{t("broadcast.audience")}</legend>
          {AUDIENCES.map((entry) => (
            <label key={entry} className="checkbox-row">
              <input type="checkbox" checked={audience.has(entry)} onChange={() => toggleAudience(entry)} />
              {t(`broadcast.audience.${entry}` as MessageKey)}
            </label>
          ))}
        </fieldset>
        <p className="muted">{t("broadcast.hint")}</p>
        <div className="action-row">
          <button type="submit" disabled={busy || audience.size === 0 || !subject.trim() || !body.trim()}>
            {t("broadcast.send")}
          </button>
          <a
            className="button-link secondary"
            href={whatsappShareUrl(shareText)}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!subject.trim() && !body.trim()}
          >
            {t("broadcast.whatsapp")}
          </a>
        </div>
        {message ? <p className="success">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </form>
      {history && history.length > 0 ? (
        <div className="main-event-broadcast-history">
          <p className="muted">{t("broadcast.history")}</p>
          <ul>
            {history.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.subject}</strong>
                <span className="muted">
                  {" · "}
                  {new Date(entry.createdAt).toLocaleString(locale === "en" ? "en-US" : "de-DE")}
                  {" · "}
                  {t("broadcast.recipients", { n: entry.recipientCount })}
                  {entry.delivered
                    ? Object.entries(entry.channels).map(
                        ([channel, counts]) =>
                          ` · ${channel}: ${counts.sent}${counts.failed ? ` (${t("broadcast.failed", { n: counts.failed })})` : ""}`
                      )
                    : ` · ${t("broadcast.sending")}`}
                  {entry.skipped ? ` · ${t("broadcast.skipped", { n: entry.skipped })}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
