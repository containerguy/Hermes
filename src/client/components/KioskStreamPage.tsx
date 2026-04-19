import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { AppSettings, GameEvent } from "../types/core";
import { ApiError, getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import { useBrandIconSrc } from "../lib/BrandingContext";
import type { MessageKey } from "../i18n/catalog/index";

async function fetchKioskEvents(id: string): Promise<GameEvent[]> {
  const response = await fetch(`/api/kiosk/events?${new URLSearchParams({ id })}`, {
    credentials: "omit",
    headers: { Accept: "application/json" }
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string; events?: GameEvent[] };
  if (!response.ok) {
    throw new ApiError({
      code: body.error ?? "request_failed",
      status: response.status,
      body
    });
  }
  return body.events ?? [];
}

function getEventStatusClass(event: GameEvent) {
  if (
    event.status !== "archived" &&
    event.status !== "cancelled" &&
    event.joinedCount >= event.maxPlayers
  ) {
    return "full";
  }
  return event.status;
}

function capacityPercent(event: GameEvent): number {
  if (event.maxPlayers <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((event.joinedCount / event.maxPlayers) * 100));
}

export function KioskStreamPage({
  appSettings,
  streamId
}: {
  appSettings: AppSettings;
  streamId: string | null;
}) {
  const { t, locale } = useI18n();
  const markSrc = useBrandIconSrc();
  const dateTag = locale === "en" ? "en-US" : "de-DE";
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const relFormatter = useMemo(
    () => new Intl.RelativeTimeFormat(locale === "en" ? "en" : "de", { numeric: "auto" }),
    [locale]
  );

  const displayAppName = appSettings.appName.trim() || t("brand.displayName");

  function getEventStatusLabel(event: GameEvent) {
    if (
      event.status !== "archived" &&
      event.status !== "cancelled" &&
      event.joinedCount >= event.maxPlayers
    ) {
      return t("events.status.full");
    }
    const labels: Record<GameEvent["status"], MessageKey> = {
      open: "events.status.open",
      ready: "events.status.ready",
      running: "events.status.running",
      cancelled: "events.status.cancelled",
      archived: "events.status.archived"
    };
    return t(labels[event.status]);
  }

  function formatStartRelative(iso: string): string {
    const start = new Date(iso);
    const now = new Date();
    const diffMs = start.getTime() - now.getTime();
    const diffMin = Math.round(diffMs / 60_000);
    if (Math.abs(diffMin) < 60) {
      return relFormatter.format(diffMin, "minute");
    }
    const diffHours = Math.round(diffMin / 60);
    if (Math.abs(diffHours) < 36) {
      return relFormatter.format(diffHours, "hour");
    }
    const diffDays = Math.round(diffHours / 24);
    return relFormatter.format(diffDays, "day");
  }

  const load = useCallback(async () => {
    if (!streamId) {
      setLoading(false);
      setError("");
      return;
    }
    setError("");
    try {
      const next = await fetchKioskEvents(streamId);
      setEvents(next);
    } catch (caught) {
      setEvents([]);
      setError(getErrorMessage(caught, locale));
    } finally {
      setLoading(false);
    }
  }, [locale, streamId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!streamId) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load, streamId]);

  if (!streamId) {
    return (
      <div className="kiosk-stream-shell">
        <header className="kiosk-stream-header">
          <img src={markSrc} alt="" width={48} height={48} />
          <div>
            <p className="kiosk-stream-eyebrow">{displayAppName}</p>
            <h1>{t("kiosk.pageTitle")}</h1>
          </div>
        </header>
        <p className="kiosk-stream-error" role="alert">
          {t("kiosk.missingId")}
        </p>
      </div>
    );
  }

  return (
    <div className="kiosk-stream-shell">
      <header className="kiosk-stream-header">
        <img src={markSrc} alt="" width={48} height={48} />
        <div>
          <p className="kiosk-stream-eyebrow">{displayAppName}</p>
          <h1>{t("kiosk.pageTitle")}</h1>
        </div>
      </header>

      {loading ? (
        <p className="kiosk-stream-status" role="status">
          {t("kiosk.loading")}
        </p>
      ) : null}

      {error ? (
        <p className="kiosk-stream-error" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && !error && events.length === 0 ? (
        <p className="kiosk-stream-empty">{t("kiosk.empty")}</p>
      ) : null}

      <ul className="kiosk-stream-list" aria-label={t("kiosk.listAria")}>
        {events.map((event) => {
          const pct = capacityPercent(event);
          const startAbsolute = new Date(event.startsAt).toLocaleString(dateTag);
          return (
            <li key={event.id}>
              <article className={`kiosk-event-card event-${getEventStatusClass(event)}`}>
                <div className="kiosk-event-top">
                  <h2 className="kiosk-event-title">{event.gameTitle}</h2>
                  <span className={`status-pill status-${getEventStatusClass(event)}`}>
                    {getEventStatusLabel(event)}
                  </span>
                </div>
                <div className="kiosk-event-meta">
                  <span className="kiosk-event-organizer">
                    {t("events.organizer")} <strong>{event.createdByUsername}</strong>
                  </span>
                  <time className="kiosk-event-time" dateTime={event.startsAt} title={startAbsolute}>
                    {formatStartRelative(event.startsAt)} · {startAbsolute}
                  </time>
                </div>
                <div className="event-capacity-block kiosk-event-capacity">
                  <div
                    className="event-capacity-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={event.maxPlayers}
                    aria-valuenow={event.joinedCount}
                    aria-label={t("events.capacity.aria", {
                      joined: event.joinedCount,
                      max: event.maxPlayers
                    })}
                  >
                    <div className="event-capacity-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="event-capacity-caption">
                    <span className="event-capacity-count">
                      {t("events.capacity.players", { joined: event.joinedCount, max: event.maxPlayers })}
                    </span>
                  </div>
                </div>
                {event.serverHost || event.connectionInfo ? (
                  <div className="event-connection-details kiosk-event-conn">
                    {event.serverHost ? (
                      <div className="event-conn-line">
                        <span className="event-conn-label">{t("events.conn.server")}</span>
                        <span className="event-conn-value">{event.serverHost}</span>
                      </div>
                    ) : null}
                    {event.connectionInfo ? (
                      <div className="event-conn-line">
                        <span className="event-conn-label">{t("events.conn.join")}</span>
                        <span className="event-conn-value">{event.connectionInfo}</span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="muted kiosk-event-missing">{t("events.conn.missing")}</p>
                )}
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
