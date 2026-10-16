import React, { FormEvent, useEffect, useState } from "react";
import type { GameEvent, GameServerBinding, ServerStatus, User } from "../types/core";
import { requestJson } from "../api/request";
import { ApiError, getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import { useBrandIconSrc } from "../lib/BrandingContext";
import { fromDatetimeLocal, toDatetimeLocal } from "../lib/event-format";
import { useCompactTouchShell } from "../lib/useCompactTouchShell";
import { EventCard } from "./EventCard";
import { normalizeGameTitle } from "../../shared/game-title";
import type { ServerAction } from "../gameservers/ServerPanel";
import { publishServerStatus } from "../gameservers/server-status-bus";
import { useServerStatus } from "../gameservers/use-server-status";

export function EventBoard({
  currentUser,
  mode = "events",
  emptyBoardTitle = "",
  emptyBoardBody = "",
  gameCatalog = [],
  ampIntegrationEnabled = false
}: {
  currentUser: User | null;
  mode?: "events" | "manager";
  emptyBoardTitle?: string;
  emptyBoardBody?: string;
  gameCatalog?: string[];
  ampIntegrationEnabled?: boolean;
}) {
  const { t, locale } = useI18n();
  const markSrc = useBrandIconSrc();

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
  // Phase 15: Bindungen Spiel -> AMP-Instanz (fürs Formular) und Live-Status (für die Karten)
  const [bindings, setBindings] = useState<GameServerBinding[]>([]);
  const [linkServer, setLinkServer] = useState(true);
  const [serverBusy, setServerBusy] = useState<Record<string, boolean>>({});
  const { byBinding: serverStatus, refresh: refreshServerStatus } = useServerStatus(
    ampIntegrationEnabled,
    currentUser?.id
  );
  const canManageServers = currentUser?.role === "admin" || currentUser?.role === "manager";

  const canCreate =
    currentUser?.role === "manager" ||
    currentUser?.role === "organizer" ||
    currentUser?.role === "admin";
  const showCreateForm = canCreate && mode === "manager";
  const bindingFormVisible = ampIntegrationEnabled && showCreateForm;

  useEffect(() => {
    if (!bindingFormVisible || !currentUser) {
      setBindings([]);
      return undefined;
    }
    let cancelled = false;
    void requestJson<{ bindings: GameServerBinding[] }>("/api/integrations/amp/bindings")
      .then((result) => {
        if (!cancelled) setBindings(result.bindings);
      })
      .catch(() => {
        if (!cancelled) setBindings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [bindingFormVisible, currentUser?.id]);

  const matchedBinding = bindings.find(
    (binding) => binding.gameTitleNorm === normalizeGameTitle(eventDraft.gameTitle)
  );

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

      source.addEventListener("servers_changed", (message) => {
        try {
          const data = JSON.parse((message as MessageEvent<string>).data) as { servers?: ServerStatus[] };
          if (Array.isArray(data.servers)) {
            publishServerStatus(data.servers);
          }
        } catch {
          /* ungültige Nutzlast ignorieren */
        }
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
          details: eventDraft.details.trim() || undefined,
          serverBindingId: matchedBinding ? (linkServer ? matchedBinding.id : null) : undefined
        })
      });
      setEventDraft({
        ...eventDraft,
        gameTitle: "",
        details: ""
      });
      setLinkServer(true);
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

  async function runServerAction(bindingId: string, action: ServerAction) {
    setServerBusy((prev) => ({ ...prev, [bindingId]: true }));
    setError("");
    try {
      await requestJson<{ ok: boolean }>(
        `/api/integrations/amp/instances/${encodeURIComponent(bindingId)}/${action}`,
        { method: "POST" }
      );
      await refreshServerStatus(true);
      setMessage(t("events.server.msg.done"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setServerBusy((prev) => ({ ...prev, [bindingId]: false }));
    }
  }

  function serverBindingFor(event: GameEvent) {
    if (!ampIntegrationEnabled || !event.serverBindingId) {
      return undefined;
    }
    const bindingId = event.serverBindingId;
    return {
      bindingId,
      status: serverStatus[bindingId] ?? null,
      canManage: canManageServers,
      busy: Boolean(serverBusy[bindingId]),
      onAction: (action: ServerAction) => void runServerAction(bindingId, action)
    };
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
      {ampIntegrationEnabled && matchedBinding ? (
        <div className="event-form-server" role="status">
          <p className="muted">
            {t("events.form.serverHint", {
              title: matchedBinding.displayTitle,
              endpoint: `${matchedBinding.host}:${matchedBinding.port}`
            })}
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={linkServer}
              onChange={(ev) => setLinkServer(ev.target.checked)}
            />
            {t("events.form.linkServer")}
          </label>
        </div>
      ) : null}
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
            {events.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                markSrc={markSrc}
                compact={compactTouchShell}
                expanded={expandedEventId === event.id}
                canManage={canManage(event)}
                canSoftDelete={canSoftDelete(event)}
                joinDisabled={isJoinDisabled(event)}
                editedStartsAt={editedStartsAt[event.id]}
                onToggleExpand={() => {
                  setExpandedEventId(expandedEventId === event.id ? null : event.id);
                  setCreateFlowOpen(false);
                }}
                onEditedStartsAtChange={(value) =>
                  setEditedStartsAt({ ...editedStartsAt, [event.id]: value })
                }
                onJoin={() => setParticipation(event.id, "joined")}
                onDecline={() => setParticipation(event.id, "declined")}
                onUpdateStart={() => updateStart(event.id)}
                onArchive={() => changeEventStatus(event.id, "archive")}
                onCancel={() => changeEventStatus(event.id, "cancel")}
                onSoftDelete={() => softDeleteEvent(event.id)}
                server={serverBindingFor(event)}
              />
            ))}
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
