import React, { useEffect, useState } from "react";
import { requestJson } from "../api/request";
import { getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";

type ChannelChoice = {
  id: string;
  label: { de: string; en: string };
  moduleId: string | null;
  enabled: boolean;
  available: boolean;
  unavailableHint: { de: string; en: string } | null;
};

type ChannelsResponse = { channels: ChannelChoice[]; unsubscribed: boolean };

/** Profil: über welche Kanäle man Event-Infos (Rundnachrichten, Erinnerungen) bekommt. */
export function EventInfoChannels() {
  const { t, locale } = useI18n();
  const [state, setState] = useState<ChannelsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [calendarPath, setCalendarPath] = useState<string | null>(null);

  async function loadCalendar(renew = false) {
    try {
      const result = renew
        ? await requestJson<{ path: string }>("/api/notifications/calendar-feed/renew", { method: "POST" })
        : await requestJson<{ path: string }>("/api/notifications/calendar-feed");
      if (typeof result?.path === "string") {
        setCalendarPath(result.path);
      }
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  useEffect(() => {
    requestJson<ChannelsResponse>("/api/notifications/channels")
      .then((result) => setState(Array.isArray(result?.channels) ? result : null))
      .catch((caught) => setError(getErrorMessage(caught, locale)));
  }, []);

  async function toggle(channel: ChannelChoice) {
    setBusy(true);
    try {
      const result = await requestJson<ChannelsResponse>(`/api/notifications/channels/${channel.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !channel.enabled })
      });
      if (Array.isArray(result?.channels)) {
        setState(result);
      }
      setError("");
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="device-panel event-info-channels" aria-label={t("notifications.channels.title")}>
      <div className="section-title-row">
        <div>
          <p className="eyebrow">{t("notifications.channels.eyebrow")}</p>
          <h2>{t("notifications.channels.title")}</h2>
        </div>
      </div>
      <p className="muted">{t("notifications.channels.intro")}</p>
      {state?.unsubscribed ? <p className="runtime-callout runtime-callout--warn">{t("notifications.channels.unsubscribed")}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {state ? (
        <div className="event-info-channel-list">
          {state.channels.map((channel) => (
            <label key={channel.id} className="checkbox-row">
              <input
                type="checkbox"
                checked={channel.enabled && !state.unsubscribed}
                disabled={busy}
                onChange={() => void toggle(state.unsubscribed ? { ...channel, enabled: false } : channel)}
              />
              {channel.label[locale] ?? channel.label.de}
              {!channel.available ? (
                <span className="muted">
                  {" "}
                  ({channel.unavailableHint?.[locale] ?? t("notifications.channels.unavailable")})
                </span>
              ) : null}
            </label>
          ))}
        </div>
      ) : null}
      <div className="event-info-calendar">
        <p className="eyebrow">{t("notifications.calendar.title")}</p>
        <p className="muted">{t("notifications.calendar.intro")}</p>
        {calendarPath ? (
          <>
            <input
              readOnly
              value={`${window.location.origin}${calendarPath}`}
              aria-label={t("notifications.calendar.title")}
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className="action-row">
              <a className="button-link secondary" href={`webcal://${window.location.host}${calendarPath}`}>
                {t("notifications.calendar.subscribe")}
              </a>
              <button type="button" className="secondary" disabled={busy} onClick={() => void loadCalendar(true)}>
                {t("notifications.calendar.renew")}
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="secondary" onClick={() => void loadCalendar()}>
            {t("notifications.calendar.show")}
          </button>
        )}
      </div>
    </section>
  );
}
