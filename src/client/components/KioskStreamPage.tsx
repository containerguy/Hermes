import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, GameEvent } from "../types/core";
import { ApiError, getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import { useBrandIconSrc } from "../lib/BrandingContext";
import type { MessageKey } from "../i18n/catalog/index";

const KIOSK_PRIMARY_VIEW_MS = 8000;
const KIOSK_OVERFLOW_VIEW_MS = 5000;

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

function compareStartsAt(a: GameEvent, b: GameEvent): number {
  return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
}

function groupEventsByGameTitle(events: GameEvent[]): Array<{ gameTitle: string; events: GameEvent[] }> {
  const sorted = [...events].sort(compareStartsAt);
  const map = new Map<string, GameEvent[]>();
  for (const event of sorted) {
    const list = map.get(event.gameTitle);
    if (list) {
      list.push(event);
    } else {
      map.set(event.gameTitle, [event]);
    }
  }
  return [...map.entries()]
    .map(([gameTitle, evs]) => ({
      gameTitle,
      events: [...evs].sort(compareStartsAt)
    }))
    .sort((a, b) => compareStartsAt(a.events[0]!, b.events[0]!));
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
  const [overflowPx, setOverflowPx] = useState(0);
  const [scrollPhase, setScrollPhase] = useState<"start" | "overflow">("start");
  const [instantTransform, setInstantTransform] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const boardViewportRef = useRef<HTMLDivElement>(null);
  const boardContentRef = useRef<HTMLDivElement>(null);

  const relFormatter = useMemo(
    () => new Intl.RelativeTimeFormat(locale === "en" ? "en" : "de", { numeric: "auto" }),
    [locale]
  );

  const displayAppName = appSettings.appName.trim() || t("brand.displayName");

  const gameGroups = useMemo(() => groupEventsByGameTitle(events), [events]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const onChange = () => setPrefersReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const measureOverflow = useCallback(() => {
    const viewport = boardViewportRef.current;
    const content = boardContentRef.current;
    if (!viewport || !content) {
      return;
    }
    setOverflowPx(Math.max(0, Math.ceil(content.scrollHeight - viewport.clientHeight)));
  }, []);

  useLayoutEffect(() => {
    if (loading || error || events.length === 0) {
      return;
    }
    measureOverflow();
  }, [error, events.length, gameGroups, loading, measureOverflow]);

  useEffect(() => {
    if (loading || error || events.length === 0) {
      return;
    }
    const viewport = boardViewportRef.current;
    const content = boardContentRef.current;
    if (!viewport || !content) {
      return;
    }
    const ro = new ResizeObserver(() => measureOverflow());
    ro.observe(viewport);
    ro.observe(content);
    return () => ro.disconnect();
  }, [error, events.length, loading, measureOverflow]);

  useEffect(() => {
    if (prefersReducedMotion || loading || error || events.length === 0 || overflowPx <= 1) {
      setScrollPhase("start");
      setInstantTransform(false);
      return;
    }

    let primaryTimer: number | undefined;
    let overflowTimer: number | undefined;
    let cancelled = false;

    const armPrimary = () => {
      primaryTimer = window.setTimeout(() => {
        if (cancelled) {
          return;
        }
        setInstantTransform(false);
        setScrollPhase("overflow");
        overflowTimer = window.setTimeout(() => {
          if (cancelled) {
            return;
          }
          setInstantTransform(true);
          setScrollPhase("start");
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setInstantTransform(false);
              armPrimary();
            });
          });
        }, KIOSK_OVERFLOW_VIEW_MS);
      }, KIOSK_PRIMARY_VIEW_MS);
    };

    setScrollPhase("start");
    armPrimary();

    return () => {
      cancelled = true;
      if (primaryTimer !== undefined) {
        window.clearTimeout(primaryTimer);
      }
      if (overflowTimer !== undefined) {
        window.clearTimeout(overflowTimer);
      }
    };
  }, [error, events.length, loading, overflowPx, prefersReducedMotion]);

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

  function renderEventCard(event: GameEvent) {
    const pct = capacityPercent(event);
    const startAbsolute = new Date(event.startsAt).toLocaleString(dateTag);
    return (
      <article className={`kiosk-event-card event-${getEventStatusClass(event)}`}>
        <div className="kiosk-event-top">
          <time className="kiosk-event-time-heading" dateTime={event.startsAt} title={startAbsolute}>
            {formatStartRelative(event.startsAt)} · {startAbsolute}
          </time>
          <span className={`status-pill status-${getEventStatusClass(event)}`}>
            {getEventStatusLabel(event)}
          </span>
        </div>
        <div className="kiosk-event-meta kiosk-event-meta--single">
          <span className="kiosk-event-organizer">
            {t("events.organizer")} <strong>{event.createdByUsername}</strong>
          </span>
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
        {event.details?.trim() ? (
          <div className="event-connection-details kiosk-event-conn">
            <div className="event-conn-line">
              <span className="event-conn-label">{t("events.conn.details")}</span>
              <span className="event-conn-value">{event.details}</span>
            </div>
          </div>
        ) : (
          <p className="muted kiosk-event-missing">{t("events.conn.missing")}</p>
        )}
      </article>
    );
  }

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

  const showBoard = !loading && !error && events.length > 0;
  const allowManualScroll = prefersReducedMotion && overflowPx > 1;
  const transformActive =
    !prefersReducedMotion && overflowPx > 1 && scrollPhase === "overflow" ? -overflowPx : 0;

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

      {showBoard ? (
        <div
          ref={boardViewportRef}
          className={`kiosk-board-viewport${allowManualScroll ? " kiosk-board-viewport--scroll" : ""}`}
        >
          <div
            ref={boardContentRef}
            className="kiosk-board-content"
            style={{
              transform: allowManualScroll ? undefined : `translateY(${transformActive}px)`,
              transition: allowManualScroll || instantTransform ? "none" : "transform 0.75s ease-in-out"
            }}
          >
            <section className="kiosk-game-board" aria-label={t("kiosk.listAria")}>
              {gameGroups.map((group) => (
                <section key={group.gameTitle} className="kiosk-game-column">
                  <h2 className="kiosk-game-heading">{group.gameTitle}</h2>
                  <ul className="kiosk-game-events">
                    {group.events.map((event) => (
                      <li key={event.id}>{renderEventCard(event)}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
