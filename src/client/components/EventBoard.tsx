import React, { FormEvent, useEffect, useMemo, useState } from "react";
import type { GameEvent, User } from "../types/core";
import { requestJson } from "../api/request";
import { ApiError, getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import { useBrandIconSrc } from "../lib/BrandingContext";
import type { MessageKey } from "../i18n/catalog/index";

function toDatetimeLocal(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDatetimeLocal(value: string) {
  return new Date(value).toISOString();
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

function isSameLocalCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function capacityPercent(event: GameEvent): number {
  if (event.maxPlayers <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((event.joinedCount / event.maxPlayers) * 100));
}

/** Kompakte Kachel-Ansicht für schmale Viewports und installierte PWA (display-mode: standalone). */
function useCompactTouchShell() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    try {
      const mq = window.matchMedia("(max-width: 768px), (display-mode: standalone)");
      const apply = () => setCompact(mq.matches);
      apply();
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    } catch {
      setCompact(false);
    }
    return undefined;
  }, []);
  return compact;
}

export function EventBoard({
  currentUser,
  mode = "events",
  emptyBoardTitle = "",
  emptyBoardBody = "",
  gameCatalog = []
}: {
  currentUser: User | null;
  mode?: "events" | "manager";
  emptyBoardTitle?: string;
  emptyBoardBody?: string;
  gameCatalog?: string[];
}) {
  const { t, locale } = useI18n();
  const markSrc = useBrandIconSrc();
  const dateTag = locale === "en" ? "en-US" : "de-DE";
  const relFormatter = useMemo(
    () => new Intl.RelativeTimeFormat(locale === "en" ? "en" : "de", { numeric: "auto" }),
    [locale]
  );

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

  function formatStartForCompactOverview(iso: string): string {
    const start = new Date(iso);
    const now = new Date();
    const timeOnly = new Intl.DateTimeFormat(dateTag, { hour: "2-digit", minute: "2-digit" });
    if (isSameLocalCalendarDay(start, now)) {
      return timeOnly.format(start);
    }
    return new Intl.DateTimeFormat(dateTag, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(start);
  }

  function formatStartRelative(iso: string): string {
    const startMs = new Date(iso).getTime();
    const diffSec = Math.round((startMs - Date.now()) / 1000);
    const abs = Math.abs(diffSec);
    if (abs < 60) {
      return relFormatter.format(diffSec, "second");
    }
    if (abs < 3600) {
      return relFormatter.format(Math.round(diffSec / 60), "minute");
    }
    if (abs < 172_800) {
      return relFormatter.format(Math.round(diffSec / 3600), "hour");
    }
    return relFormatter.format(Math.round(diffSec / 86_400), "day");
  }

  function minPlayersGapHint(event: GameEvent): string | null {
    if (event.status === "archived" || event.status === "cancelled") {
      return null;
    }
    const gap = event.minPlayers - event.joinedCount;
    if (gap <= 0) {
      return t("events.minMet");
    }
    if (gap === 1) {
      return t("events.minOne");
    }
    return t("events.minN", { n: gap });
  }

  function myParticipationLabel(status: GameEvent["myParticipation"]): string | null {
    if (status === "joined") {
      return t("events.part.joined");
    }
    if (status === "declined") {
      return t("events.part.declined");
    }
    return null;
  }

  const resolvedEmptyTitle = emptyBoardTitle.trim() || t("events.empty.defaultTitle");
  const resolvedEmptyBody = emptyBoardBody.trim() || t("events.empty.defaultBody");
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [eventDraft, setEventDraft] = useState({
    gameTitle: "",
    startMode: "scheduled" as "now" | "scheduled",
    startsAt: toDatetimeLocal(new Date(Date.now() + 30 * 60 * 1000).toISOString()),
    minPlayers: 2,
    maxPlayers: 8,
    details: ""
  });
  /** null = noch keine Wahl: mit Katalog standardmäßig „Aus Liste“, sonst Freitext */
  const [gameTitleSource, setGameTitleSource] = useState<"catalog" | "custom" | null>(null);
  const [editedStartsAt, setEditedStartsAt] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [liveState, setLiveState] = useState<"offline" | "connecting" | "live" | "polling">(
    "offline"
  );
  const compactTouchShell = useCompactTouchShell();
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [createFlowOpen, setCreateFlowOpen] = useState(false);

  const canCreate =
    currentUser?.role === "manager" ||
    currentUser?.role === "organizer" ||
    currentUser?.role === "admin";
  const showCreateForm = canCreate && mode === "manager";

  async function loadEvents() {
    if (!currentUser) {
      setEvents([]);
      return;
    }

    const result = await requestJson<{ events: GameEvent[] }>("/api/events");
    setEvents(result.events);
    setEditedStartsAt(
      Object.fromEntries(result.events.map((event) => [event.id, toDatetimeLocal(event.startsAt)]))
    );
  }

  useEffect(() => {
    loadEvents().catch(() => undefined);
  }, [currentUser?.id]);

  const resolvedCatalog = Array.from(
    new Set(gameCatalog.map((title) => title.trim()).filter(Boolean))
  );
  const catalogAvailable = resolvedCatalog.length > 0;
  const gameTitleMode: "catalog" | "custom" = catalogAvailable
    ? gameTitleSource ?? "catalog"
    : "custom";
  const gameTitleFromCatalog = gameTitleMode === "catalog";

  useEffect(() => {
    if (!catalogAvailable) {
      setGameTitleSource(null);
    }
  }, [catalogAvailable]);

  useEffect(() => {
    if (!compactTouchShell) {
      setCreateFlowOpen(false);
    }
  }, [compactTouchShell]);

  useEffect(() => {
    if (expandedEventId && !events.some((entry) => entry.id === expandedEventId)) {
      setExpandedEventId(null);
    }
  }, [events, expandedEventId]);

  useEffect(() => {
    if (!currentUser) {
      setLiveState("offline");
      return undefined;
    }

    let closed = false;
    let retryMs = 1_000;
    let reconnectTimer: number | null = null;
    let source: EventSource | null = null;

    function scheduleReconnect() {
      if (closed || reconnectTimer !== null) {
        return;
      }

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        retryMs = Math.min(retryMs * 2, 15_000);
        connect();
      }, retryMs);
    }

    function connect() {
      if (closed) {
        return;
      }

      setLiveState("connecting");
      source?.close();
      source = new EventSource("/api/realtime/events", { withCredentials: true });

      source.onopen = () => {
        retryMs = 1_000;
        setLiveState("live");
      };

      source.onerror = () => {
        setLiveState("polling");
        source?.close();
        scheduleReconnect();
      };

      source.addEventListener("heartbeat", () => {
        setLiveState("live");
      });

      source.addEventListener("events_changed", () => {
        loadEvents().catch(() => setLiveState("polling"));
      });
    }

    const poll = window.setInterval(() => {
      loadEvents().catch(() => setLiveState("polling"));
    }, 30_000);
    connect();

    return () => {
      closed = true;
      source?.close();
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      window.clearInterval(poll);
    };
  }, [currentUser?.id]);

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      await requestJson<{ event: GameEvent }>("/api/events", {
        method: "POST",
        body: JSON.stringify({
          ...eventDraft,
          startsAt:
            eventDraft.startMode === "scheduled"
              ? fromDatetimeLocal(eventDraft.startsAt)
              : undefined,
          details: eventDraft.details.trim() || undefined
        })
      });
      setEventDraft({
        ...eventDraft,
        gameTitle: "",
        details: ""
      });
      await loadEvents();
      setMessage(t("events.msg.saved"));
      setCreateFlowOpen(false);
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  async function updateStart(eventId: string) {
    setError("");
    setMessage("");

    try {
      await requestJson<{ event: GameEvent }>(`/api/events/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify({
          startMode: "scheduled",
          startsAt: fromDatetimeLocal(editedStartsAt[eventId])
        })
      });
      await loadEvents();
      setMessage(t("events.msg.startSaved"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  async function changeEventStatus(eventId: string, action: "archive" | "cancel") {
    setError("");
    setMessage("");

    const confirmed = window.confirm(
      action === "archive" ? t("events.confirm.archive") : t("events.confirm.cancel")
    );

    if (!confirmed) {
      return;
    }

    try {
      await requestJson<{ event: GameEvent }>(`/api/events/${eventId}/${action}`, {
        method: "POST"
      });
      await loadEvents();
      setMessage(action === "archive" ? t("events.msg.archived") : t("events.msg.cancelled"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  async function softDeleteEvent(eventId: string) {
    setError("");
    setMessage("");

    const event = events.find((candidate) => candidate.id === eventId);
    const confirmed = window.confirm(
      t("events.confirm.delete", { titleSuffix: event ? ` (${event.gameTitle})` : "" })
    );
    if (!confirmed) {
      return;
    }

    try {
      await requestJson<void>(`/api/admin/events/${eventId}`, { method: "DELETE" });
      await loadEvents();
      setMessage(t("events.msg.deleted"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  async function setParticipation(eventId: string, status: "joined" | "declined") {
    setError("");
    setMessage("");

    try {
      await requestJson<{ event: GameEvent }>(`/api/events/${eventId}/participation`, {
        method: "POST",
        body: JSON.stringify({ status })
      });
      await loadEvents();
      setMessage(status === "joined" ? t("events.msg.joined") : t("events.msg.declined"));
    } catch (caught) {
      if (caught instanceof ApiError && caught.message === "event_voll") {
        const body = caught.body as { event?: Partial<GameEvent> } | null | undefined;
        const serverEvent = body?.event;
        const fallbackEvent = events.find((event) => event.id === eventId);
        const joinedCount = Number(serverEvent?.joinedCount ?? fallbackEvent?.joinedCount);
        const maxPlayers = Number(serverEvent?.maxPlayers ?? fallbackEvent?.maxPlayers);
        const playerNumber = Number.isFinite(joinedCount) ? joinedCount + 1 : NaN;

        const parts = [];
        if (Number.isFinite(playerNumber) && Number.isFinite(maxPlayers) && maxPlayers > 0) {
          parts.push(t("events.full.detail", { n: playerNumber, m: maxPlayers }));
        } else {
          parts.push(t("events.full.simple"));
        }
        parts.push(t("events.full.hint"));

        await loadEvents().catch(() => undefined);
        setError(parts.join(" "));
        return;
      }

      setError(getErrorMessage(caught, locale));
    }
  }

  function canManage(event: GameEvent) {
    return (
      currentUser?.role === "admin" ||
      currentUser?.role === "manager" ||
      currentUser?.id === event.createdByUserId
    );
  }

  function canSoftDelete(event: GameEvent) {
    return (
      currentUser?.role === "admin" &&
      (event.status === "archived" || event.status === "cancelled")
    );
  }

  function switchGameTitleMode(next: "catalog" | "custom") {
    if (next === "custom") {
      setGameTitleSource("custom");
      return;
    }
    setGameTitleSource("catalog");
    if (!resolvedCatalog.includes(eventDraft.gameTitle)) {
      setEventDraft((draft) => ({ ...draft, gameTitle: "" }));
    }
  }

  function isJoinDisabled(event: GameEvent) {
    const alreadyJoined = event.myParticipation === "joined";
    const fullForOthers = event.joinedCount >= event.maxPlayers && !alreadyJoined;
    return alreadyJoined || fullForOthers;
  }

  if (!currentUser) {
    return (
      <div className="access-panel" aria-label={t("events.guest.aria")}>
        <img src={markSrc} alt="" />
        <p className="eyebrow">{t("events.guest.eyebrow")}</p>
        <h2>{t("events.guest.title")}</h2>
        <p className="muted">{t("events.guest.body")}</p>
        <a className="text-link" href="#login">
          {t("events.guest.login")}
        </a>
      </div>
    );
  }

  const liveStateLabel =
    liveState === "live"
      ? t("events.live.live")
      : liveState === "connecting"
        ? t("events.live.connecting")
        : liveState === "polling"
          ? t("events.live.polling")
          : t("events.live.offline");

  function renderEventExpandedContent(event: GameEvent) {
    const selfStatus = myParticipationLabel(event.myParticipation);
    const gapHint = minPlayersGapHint(event);
    const startAbsolute = new Date(event.startsAt).toLocaleString(dateTag);
    const pct = capacityPercent(event);
    return (
      <>
        {selfStatus && event.myParticipation ? (
          <p className={`event-self-status event-self-${event.myParticipation}`} role="status">
            {selfStatus}
          </p>
        ) : null}
        <div className="event-meta-row">
          <span className="event-organizer">
            {t("events.organizer")} <strong>{event.createdByUsername}</strong>
          </span>
          <time className="event-relative-start" dateTime={event.startsAt} title={startAbsolute}>
            {formatStartRelative(event.startsAt)}
          </time>
        </div>
        <div className="event-capacity-block">
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
            {gapHint ? <span className="event-capacity-hint">{gapHint}</span> : null}
          </div>
        </div>
        <dl className="event-stats event-stats--pair">
          <div>
            <dt>{t("events.meta.min")}</dt>
            <dd>{event.minPlayers}</dd>
          </div>
          <div>
            <dt>{t("events.meta.startLocal")}</dt>
            <dd>
              <time dateTime={event.startsAt}>{startAbsolute}</time>
            </dd>
          </div>
        </dl>
        {event.details?.trim() ? (
          <div className="event-connection-details">
            <div className="event-conn-line">
              <span className="event-conn-label">{t("events.conn.details")}</span>
              <span className="event-conn-value">{event.details}</span>
            </div>
          </div>
        ) : (
          <p className="muted event-join-hint">{t("events.conn.missing")}</p>
        )}
        {event.status !== "archived" && event.status !== "cancelled" ? (
          <div className="action-row">
            <button
              type="button"
              className={`participation-btn${event.myParticipation === "joined" ? " participation-btn--joined" : ""}`}
              onClick={() => setParticipation(event.id, "joined")}
              disabled={isJoinDisabled(event)}
            >
              {t("events.action.join")}
            </button>
            <button
              type="button"
              className={`participation-btn${event.myParticipation === "declined" ? " participation-btn--declined" : ""}`}
              onClick={() => setParticipation(event.id, "declined")}
              disabled={event.myParticipation === "declined"}
            >
              {t("events.action.decline")}
            </button>
          </div>
        ) : null}
        {canManage(event) && event.status !== "archived" && event.status !== "cancelled" ? (
          <div className="manage-row">
            <input
              type="datetime-local"
              value={editedStartsAt[event.id] ?? toDatetimeLocal(event.startsAt)}
              onChange={(change) =>
                setEditedStartsAt({
                  ...editedStartsAt,
                  [event.id]: change.target.value
                })
              }
            />
            <button type="button" className="secondary" onClick={() => updateStart(event.id)}>
              {t("events.action.saveStart")}
            </button>
            <button type="button" className="secondary" onClick={() => changeEventStatus(event.id, "archive")}>
              {t("events.action.archive")}
            </button>
            <button type="button" className="secondary" onClick={() => changeEventStatus(event.id, "cancel")}>
              {t("events.action.cancel")}
            </button>
          </div>
        ) : null}
        {canSoftDelete(event) ? (
          <div className="action-row">
            <button type="button" className="secondary danger" onClick={() => softDeleteEvent(event.id)}>
              {t("events.action.delete")}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  function renderEventExpandableRow(event: GameEvent) {
    const pct = capacityPercent(event);
    const expanded = expandedEventId === event.id;
    const panelId = `event-expand-${event.id}`;
    const compactStartLabel = formatStartForCompactOverview(event.startsAt);
    const which = expanded ? t("events.tile.collapse") : t("events.tile.expand");
    const tileAriaLabel = compactTouchShell
      ? t("events.tile.aria", {
          title: event.gameTitle,
          start: compactStartLabel,
          status: getEventStatusLabel(event),
          which
        })
      : t("events.tile.ariaNoStart", {
          title: event.gameTitle,
          status: getEventStatusLabel(event),
          which
        });
    return (
      <div className="event-expandable" key={event.id}>
        <button
          type="button"
          className={`event-compact-tile event-tile-${getEventStatusClass(event)}`}
          aria-expanded={expanded}
          aria-controls={panelId}
          id={`event-tile-${event.id}`}
          onClick={() => {
            setExpandedEventId(expanded ? null : event.id);
            setCreateFlowOpen(false);
          }}
          aria-label={tileAriaLabel}
        >
          <img src={markSrc} alt="" className="event-compact-icon" width={36} height={36} />
          <div className="event-compact-tile-body">
            <span className="event-compact-title">{event.gameTitle}</span>
            {compactTouchShell ? (
              <time className="event-compact-start" dateTime={event.startsAt}>
                {compactStartLabel}
              </time>
            ) : null}
            <div className="event-compact-track" aria-hidden="true">
              <div className="event-compact-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="event-compact-meta">
              <span className="event-compact-count">
                {event.joinedCount}/{event.maxPlayers}
              </span>
              <span className={`status-pill status-${getEventStatusClass(event)}`}>
                {getEventStatusLabel(event)}
              </span>
            </div>
          </div>
          <span className="event-compact-chevron" aria-hidden="true">
            {expanded ? "\u25BC" : "\u25B6"}
          </span>
        </button>
        {expanded ? (
          <div
            className="event-expanded-panel"
            id={panelId}
            role="region"
            aria-labelledby={`event-tile-${event.id}`}
            aria-label={t("events.panel.details", { title: event.gameTitle })}
          >
            <article className={`event-card event-${getEventStatusClass(event)} event-card--expanded-follow`}>
              <div className="event-header event-header--expanded-follow">
                <div>
                  <p className="eyebrow">
                    {event.startMode === "now" ? t("events.mode.now") : t("events.mode.scheduled")}
                  </p>
                  <h2>{event.gameTitle}</h2>
                </div>
                <span className={`status-pill status-${getEventStatusClass(event)}`}>
                  {getEventStatusLabel(event)}
                </span>
              </div>
              {renderEventExpandedContent(event)}
            </article>
          </div>
        ) : null}
      </div>
    );
  }

  const newEventForm = (
    <form onSubmit={createEvent} className="event-form" aria-label={t("events.form.aria")}>
      <div className="form-title">
        <p className="eyebrow">{t("events.form.eyebrow")}</p>
        <h2>{t("events.form.title")}</h2>
        <p className="muted">{t("events.form.intro")}</p>
      </div>
      <div className="game-title-field">
        <label>
          {t("events.form.game")}
          {catalogAvailable ? (
            <div
              className="game-title-mode-toggle"
              role="group"
              aria-label={t("events.form.catalogToggle")}
            >
              <button
                type="button"
                className={`secondary${gameTitleFromCatalog ? " mode-active" : ""}`}
                aria-pressed={gameTitleFromCatalog}
                onClick={() => switchGameTitleMode("catalog")}
              >
                {t("events.form.fromList")}
              </button>
              <button
                type="button"
                className={`secondary${!gameTitleFromCatalog ? " mode-active" : ""}`}
                aria-pressed={!gameTitleFromCatalog}
                onClick={() => switchGameTitleMode("custom")}
              >
                {t("events.form.customTitle")}
              </button>
            </div>
          ) : null}
          {gameTitleFromCatalog ? (
            <select
              value={eventDraft.gameTitle}
              onChange={(ev) => setEventDraft({ ...eventDraft, gameTitle: ev.target.value })}
              required
              aria-label={t("events.form.catalogToggle")}
            >
              <option value="">{t("events.form.pickGame")}</option>
              {resolvedCatalog.map((title) => (
                <option key={title} value={title}>
                  {title}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={eventDraft.gameTitle}
              onChange={(ev) => setEventDraft({ ...eventDraft, gameTitle: ev.target.value })}
              required
              aria-label={t("events.form.gameTitleAria")}
            />
          )}
        </label>
      </div>
      <div className="form-grid">
        <label>
          {t("events.form.start")}
          <select
            value={eventDraft.startMode}
            onChange={(ev) =>
              setEventDraft({
                ...eventDraft,
                startMode: ev.target.value as "now" | "scheduled"
              })
            }
          >
            <option value="scheduled">{t("events.mode.scheduled")}</option>
            <option value="now">{t("events.mode.now")}</option>
          </select>
        </label>
        <label>
          {t("events.form.startTime")}
          <input
            type="datetime-local"
            disabled={eventDraft.startMode === "now"}
            value={eventDraft.startsAt}
            onChange={(ev) => setEventDraft({ ...eventDraft, startsAt: ev.target.value })}
          />
        </label>
      </div>
      <div className="form-grid">
        <label>
          {t("events.form.min")}
          <input
            type="number"
            min={1}
            value={eventDraft.minPlayers}
            onChange={(ev) => setEventDraft({ ...eventDraft, minPlayers: Number(ev.target.value) })}
            required
          />
        </label>
        <label>
          {t("events.form.max")}
          <input
            type="number"
            min={1}
            value={eventDraft.maxPlayers}
            onChange={(ev) => setEventDraft({ ...eventDraft, maxPlayers: Number(ev.target.value) })}
            required
          />
        </label>
      </div>
      <label>
        {t("events.form.details")}
        <textarea
          rows={3}
          value={eventDraft.details}
          onChange={(ev) => setEventDraft({ ...eventDraft, details: ev.target.value })}
        />
      </label>
      <button type="submit">{t("events.form.submit")}</button>
    </form>
  );

  const boardToolbar = (
    <div className="board-toolbar">
      <div>
        <span className={`live-state live-${liveState}`}>{liveStateLabel}</span>
        <span className="toolbar-hint">
          {events.length === 1
            ? t("events.count.one")
            : t("events.count.many", { n: events.length })}
        </span>
      </div>
      <button type="button" className="secondary" onClick={() => loadEvents()}>
        {t("events.refresh")}
      </button>
    </div>
  );

  const managerCreateOverlay = showCreateForm && compactTouchShell && createFlowOpen;
  const boardClassName = `event-board ${mode === "manager" ? "manager-board" : "events-board"} event-board--expandable${compactTouchShell ? " event-board--compact" : ""}`;

  return (
    <section className={boardClassName} aria-label={t("events.board.aria")}>
      {boardToolbar}
      {mode === "manager" && !canCreate ? (
        <div className="access-panel compact" aria-label={t("events.manager.denied.title")}>
          <p className="eyebrow">{t("events.manager.denied.eyebrow")}</p>
          <h2>{t("events.manager.denied.title")}</h2>
          <p className="muted">{t("events.manager.denied.body")}</p>
        </div>
      ) : null}
      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {showCreateForm && compactTouchShell && !createFlowOpen ? (
        <div className="event-compact-primary-action">
          <button
            type="button"
            onClick={() => {
              setCreateFlowOpen(true);
              setExpandedEventId(null);
            }}
          >
            {t("events.newCompact")}
          </button>
        </div>
      ) : null}
      {showCreateForm && compactTouchShell && createFlowOpen ? (
        <div className="event-overlay-panel" role="region" aria-label={t("events.overlay.aria")}>
          <div className="event-overlay-toolbar">
            <button type="button" className="secondary" onClick={() => setCreateFlowOpen(false)}>
              {t("events.overlay.back")}
            </button>
          </div>
          {newEventForm}
        </div>
      ) : null}
      {!managerCreateOverlay ? (
        <>
          <div
            className={`event-list event-list--expandable${compactTouchShell ? " event-list--compact" : ""}`}
          >
            {events.map((event) => renderEventExpandableRow(event))}
            {events.length === 0 ? (
              compactTouchShell ? (
                <div className="event-compact-empty event-card">
                  <p className="eyebrow">{t("events.empty.eyebrow")}</p>
                  <h2>{resolvedEmptyTitle}</h2>
                  <p className="muted">{resolvedEmptyBody}</p>
                </div>
              ) : (
                <article className="event-card">
                  <p className="eyebrow">{t("events.empty.eyebrow")}</p>
                  <h2>{resolvedEmptyTitle}</h2>
                  <p className="muted">{resolvedEmptyBody}</p>
                </article>
              )
            ) : null}
          </div>
          {showCreateForm && !compactTouchShell ? newEventForm : null}
        </>
      ) : null}
    </section>
  );
}
