import React, { FormEvent, Fragment, useEffect, useState } from "react";
import type { GameEvent, User } from "../types/core";
import { requestJson } from "../api/request";
import { ApiError, getErrorMessage } from "../errors/errors";

function toDatetimeLocal(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDatetimeLocal(value: string) {
  return new Date(value).toISOString();
}

function getEventStatusLabel(event: GameEvent) {
  if (
    event.status !== "archived" &&
    event.status !== "cancelled" &&
    event.joinedCount >= event.maxPlayers
  ) {
    return "voll";
  }

  const labels: Record<GameEvent["status"], string> = {
    open: "offen",
    ready: "startbereit",
    running: "läuft bereits",
    cancelled: "storniert",
    archived: "archiviert"
  };

  return labels[event.status];
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

const startRelativeFormatter = new Intl.RelativeTimeFormat("de", { numeric: "auto" });

function formatStartRelative(iso: string): string {
  const startMs = new Date(iso).getTime();
  const diffSec = Math.round((startMs - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) {
    return startRelativeFormatter.format(diffSec, "second");
  }
  if (abs < 3600) {
    return startRelativeFormatter.format(Math.round(diffSec / 60), "minute");
  }
  if (abs < 172_800) {
    return startRelativeFormatter.format(Math.round(diffSec / 3600), "hour");
  }
  return startRelativeFormatter.format(Math.round(diffSec / 86_400), "day");
}

function capacityPercent(event: GameEvent): number {
  if (event.maxPlayers <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((event.joinedCount / event.maxPlayers) * 100));
}

function minPlayersGapHint(event: GameEvent): string | null {
  if (event.status === "archived" || event.status === "cancelled") {
    return null;
  }
  const gap = event.minPlayers - event.joinedCount;
  if (gap <= 0) {
    return "Mindestspielerzahl erreicht";
  }
  if (gap === 1) {
    return "Noch 1 Spieler bis zur Mindestzahl";
  }
  return `Noch ${gap} Spieler bis zur Mindestzahl`;
}

function myParticipationLabel(status: GameEvent["myParticipation"]): string | null {
  if (status === "joined") {
    return "Du bist dabei";
  }
  if (status === "declined") {
    return "Du hast abgesagt";
  }
  return null;
}

const defaultEmptyBoardTitle = "Noch keine Runden im Board.";
const defaultEmptyBoardBody =
  "Sobald ein Manager eine Runde vorbereitet, tauchen Spiel, Startfenster und Join-Hinweise hier auf.";

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
  const resolvedEmptyTitle = emptyBoardTitle.trim() || defaultEmptyBoardTitle;
  const resolvedEmptyBody = emptyBoardBody.trim() || defaultEmptyBoardBody;
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [eventDraft, setEventDraft] = useState({
    gameTitle: "",
    startMode: "scheduled" as "now" | "scheduled",
    startsAt: toDatetimeLocal(new Date(Date.now() + 30 * 60 * 1000).toISOString()),
    minPlayers: 2,
    maxPlayers: 8,
    serverHost: "",
    connectionInfo: ""
  });
  const [gameTitleMode, setGameTitleMode] = useState<"catalog" | "custom">(() =>
    gameCatalog.length > 0 ? "catalog" : "custom"
  );
  const [editedStartsAt, setEditedStartsAt] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [liveState, setLiveState] = useState<"offline" | "connecting" | "live" | "polling">(
    "offline"
  );
  const compactTouchShell = useCompactTouchShell();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [createFlowOpen, setCreateFlowOpen] = useState(false);

  const canCreate = currentUser?.role === "manager" || currentUser?.role === "admin";
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

  useEffect(() => {
    if (gameCatalog.length === 0) {
      setGameTitleMode("custom");
    }
  }, [gameCatalog.length]);

  const resolvedCatalog = Array.from(
    new Set(gameCatalog.map((title) => title.trim()).filter(Boolean))
  );
  const gameTitleFromCatalog = resolvedCatalog.length > 0 ? gameTitleMode === "catalog" : false;

  useEffect(() => {
    if (!compactTouchShell) {
      setSelectedEventId(null);
      setCreateFlowOpen(false);
    }
  }, [compactTouchShell]);

  useEffect(() => {
    if (selectedEventId && !events.some((entry) => entry.id === selectedEventId)) {
      setSelectedEventId(null);
    }
  }, [events, selectedEventId]);

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
          serverHost: eventDraft.serverHost || undefined,
          connectionInfo: eventDraft.connectionInfo || undefined
        })
      });
      setEventDraft({
        ...eventDraft,
        gameTitle: "",
        serverHost: "",
        connectionInfo: ""
      });
      await loadEvents();
      setMessage("Event gespeichert.");
      setCreateFlowOpen(false);
    } catch (caught) {
      setError(getErrorMessage(caught));
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
      setMessage("Startzeit gespeichert.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function changeEventStatus(eventId: string, action: "archive" | "cancel") {
    setError("");
    setMessage("");

    const confirmed = window.confirm(
      action === "archive" ? "Event wirklich archivieren?" : "Event wirklich stornieren?"
    );

    if (!confirmed) {
      return;
    }

    try {
      await requestJson<{ event: GameEvent }>(`/api/events/${eventId}/${action}`, {
        method: "POST"
      });
      await loadEvents();
      setMessage(action === "archive" ? "Event archiviert." : "Event storniert.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function softDeleteEvent(eventId: string) {
    setError("");
    setMessage("");

    const event = events.find((candidate) => candidate.id === eventId);
    const confirmed = window.confirm(
      `Event wirklich löschen?${event ? ` (${event.gameTitle})` : ""} (nur Admins, nur archiviert/storniert)`
    );
    if (!confirmed) {
      return;
    }

    try {
      await requestJson<void>(`/api/admin/events/${eventId}`, { method: "DELETE" });
      await loadEvents();
      setMessage("Event gelöscht.");
    } catch (caught) {
      setError(getErrorMessage(caught));
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
      setMessage(status === "joined" ? "Teilnahme gespeichert." : "Absage gespeichert.");
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
          parts.push(`Event ist voll: Du wärst Spieler ${playerNumber} von ${maxPlayers}.`);
        } else {
          parts.push("Event ist voll.");
        }
        parts.push("Vielleicht ist es Zeit für eine neue Runde.");

        await loadEvents().catch(() => undefined);
        setError(parts.join(" "));
        return;
      }

      setError(getErrorMessage(caught));
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
      setGameTitleMode("custom");
      return;
    }
    setGameTitleMode("catalog");
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
      <div className="access-panel" aria-label="Login Hinweis">
        <img src="/icon.svg" alt="" />
        <p className="eyebrow">Login</p>
        <h2>Einloggen und aktuelle Runden prüfen.</h2>
        <p className="muted">
          Nach dem Login siehst du sofort, welche Runde startet, wer schon dabei ist und welche
          Server- oder Join-Hinweise hinterlegt wurden.
        </p>
        <a className="text-link" href="#login">
          Zum Login
        </a>
      </div>
    );
  }

  const liveStateLabel =
    liveState === "live"
      ? "Live verbunden"
      : liveState === "connecting"
        ? "Verbinde…"
        : liveState === "polling"
          ? "Polling aktiv"
          : "Offline";

  function renderFullEventCard(event: GameEvent) {
    const selfStatus = myParticipationLabel(event.myParticipation);
    const gapHint = minPlayersGapHint(event);
    const startAbsolute = new Date(event.startsAt).toLocaleString("de-DE");
    const pct = capacityPercent(event);
    return (
      <article className={`event-card event-${getEventStatusClass(event)}`}>
        <div className="event-header">
          <div>
            <p className="eyebrow">{event.startMode === "now" ? "Sofort" : "Geplant"}</p>
            <h2>{event.gameTitle}</h2>
          </div>
          <span className={`status-pill status-${getEventStatusClass(event)}`}>
            {getEventStatusLabel(event)}
          </span>
        </div>
        {selfStatus && event.myParticipation ? (
          <p className={`event-self-status event-self-${event.myParticipation}`} role="status">
            {selfStatus}
          </p>
        ) : null}
        <div className="event-meta-row">
          <span className="event-organizer">
            Runde von <strong>{event.createdByUsername}</strong>
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
            aria-label={`Belegung: ${event.joinedCount} von ${event.maxPlayers} Plätzen`}
          >
            <div className="event-capacity-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="event-capacity-caption">
            <span className="event-capacity-count">
              {event.joinedCount} / {event.maxPlayers} Spieler
            </span>
            {gapHint ? <span className="event-capacity-hint">{gapHint}</span> : null}
          </div>
        </div>
        <dl className="event-stats event-stats--pair">
          <div>
            <dt>Minimum</dt>
            <dd>{event.minPlayers}</dd>
          </div>
          <div>
            <dt>Start (lokal)</dt>
            <dd>
              <time dateTime={event.startsAt}>{startAbsolute}</time>
            </dd>
          </div>
        </dl>
        {event.serverHost || event.connectionInfo ? (
          <div className="event-connection-details">
            {event.serverHost ? (
              <div className="event-conn-line">
                <span className="event-conn-label">Server</span>
                <span className="event-conn-value">{event.serverHost}</span>
              </div>
            ) : null}
            {event.connectionInfo ? (
              <div className="event-conn-line">
                <span className="event-conn-label">Join / Hinweis</span>
                <span className="event-conn-value">{event.connectionInfo}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="muted event-join-hint">
            Server- und Join-Hinweise fehlen noch. Frag kurz im LAN nach, bevor ihr startet.
          </p>
        )}
        {event.status !== "archived" && event.status !== "cancelled" ? (
          <div className="action-row">
            <button
              type="button"
              className={`participation-btn${event.myParticipation === "joined" ? " participation-btn--joined" : ""}`}
              onClick={() => setParticipation(event.id, "joined")}
              disabled={isJoinDisabled(event)}
            >
              Dabei
            </button>
            <button
              type="button"
              className={`participation-btn${event.myParticipation === "declined" ? " participation-btn--declined" : ""}`}
              onClick={() => setParticipation(event.id, "declined")}
              disabled={event.myParticipation === "declined"}
            >
              Nicht dabei
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
              Start speichern
            </button>
            <button type="button" className="secondary" onClick={() => changeEventStatus(event.id, "archive")}>
              Archivieren
            </button>
            <button type="button" className="secondary" onClick={() => changeEventStatus(event.id, "cancel")}>
              Stornieren
            </button>
          </div>
        ) : null}
        {canSoftDelete(event) ? (
          <div className="action-row">
            <button type="button" className="secondary danger" onClick={() => softDeleteEvent(event.id)}>
              Löschen
            </button>
          </div>
        ) : null}
      </article>
    );
  }

  const newEventForm = (
    <form onSubmit={createEvent} className="event-form" aria-label="Neues Event anlegen">
      <div className="form-title">
        <p className="eyebrow">Neue Runde</p>
        <h2>Spielrunde vorbereiten.</h2>
        <p className="muted">
          Lege Spiel, Startfenster und optionale Join-Hinweise einmal sauber an, damit alle im Board
          dieselben Informationen sehen.
        </p>
      </div>
      <div className="game-title-field">
        <label>
          Spiel
          {resolvedCatalog.length > 0 ? (
            <div className="game-title-mode-toggle">
              <button
                type="button"
                className={`secondary${gameTitleFromCatalog ? " mode-active" : ""}`}
                onClick={() => switchGameTitleMode("catalog")}
              >
                Aus Liste
              </button>
              <button
                type="button"
                className={`secondary${!gameTitleFromCatalog ? " mode-active" : ""}`}
                onClick={() => switchGameTitleMode("custom")}
              >
                Eigener Titel
              </button>
            </div>
          ) : null}
          {gameTitleFromCatalog ? (
            <select
              value={eventDraft.gameTitle}
              onChange={(ev) => setEventDraft({ ...eventDraft, gameTitle: ev.target.value })}
              required
              aria-label="Spiel aus Katalog wählen"
            >
              <option value="">Spiel wählen…</option>
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
              aria-label="Spieltitel"
            />
          )}
        </label>
      </div>
      <div className="form-grid">
        <label>
          Start
          <select
            value={eventDraft.startMode}
            onChange={(ev) =>
              setEventDraft({
                ...eventDraft,
                startMode: ev.target.value as "now" | "scheduled"
              })
            }
          >
            <option value="scheduled">Geplant</option>
            <option value="now">Sofort</option>
          </select>
        </label>
        <label>
          Startzeit
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
          Min
          <input
            type="number"
            min={1}
            value={eventDraft.minPlayers}
            onChange={(ev) => setEventDraft({ ...eventDraft, minPlayers: Number(ev.target.value) })}
            required
          />
        </label>
        <label>
          Max
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
        Server
        <input
          value={eventDraft.serverHost}
          onChange={(ev) => setEventDraft({ ...eventDraft, serverHost: ev.target.value })}
        />
      </label>
      <label>
        Verbindung
        <input
          value={eventDraft.connectionInfo}
          onChange={(ev) => setEventDraft({ ...eventDraft, connectionInfo: ev.target.value })}
        />
      </label>
      <button type="submit">Event anlegen</button>
    </form>
  );

  const boardToolbar = (
    <div className="board-toolbar">
      <div>
        <span className={`live-state live-${liveState}`}>{liveStateLabel}</span>
        <span className="toolbar-hint">
          {events.length === 1 ? "1 Runde im Board" : `${events.length} Runden im Board`}
        </span>
      </div>
      <button type="button" className="secondary" onClick={() => loadEvents()}>
        Aktualisieren
      </button>
    </div>
  );

  if (compactTouchShell) {
    const selectedEvent = selectedEventId ? events.find((entry) => entry.id === selectedEventId) : undefined;
    return (
      <section
        className={`event-board ${mode === "manager" ? "manager-board" : "events-board"} event-board--compact`}
        aria-label="Events"
      >
        {boardToolbar}
        {mode === "manager" && !canCreate ? (
          <div className="access-panel compact" aria-label="Manager Hinweis">
            <p className="eyebrow">Manager</p>
            <h2>Keine Managerrechte.</h2>
            <p className="muted">
              Neue Runden können nur Manager und Admins anlegen. Als Spieler kannst du hier weiter
              bestehende Runden verfolgen.
            </p>
          </div>
        ) : null}
        {message ? <p className="notice">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {showCreateForm && !createFlowOpen ? (
          <div className="event-compact-primary-action">
            <button
              type="button"
              onClick={() => {
                setCreateFlowOpen(true);
                setSelectedEventId(null);
              }}
            >
              Neues Event
            </button>
          </div>
        ) : null}
        {showCreateForm && createFlowOpen ? (
          <div className="event-overlay-panel" role="region" aria-label="Neues Event anlegen">
            <div className="event-overlay-toolbar">
              <button type="button" className="secondary" onClick={() => setCreateFlowOpen(false)}>
                Zurück zur Übersicht
              </button>
            </div>
            {newEventForm}
          </div>
        ) : null}
        {!createFlowOpen ? (
          <>
            <div className="event-list event-list--compact">
              {events.map((event) => {
                const pct = capacityPercent(event);
                return (
                  <button
                    key={event.id}
                    type="button"
                    className={`event-compact-tile event-tile-${getEventStatusClass(event)}`}
                    onClick={() => {
                      setSelectedEventId(event.id);
                      setCreateFlowOpen(false);
                    }}
                    aria-label={`${event.gameTitle}, ${getEventStatusLabel(event)}`}
                  >
                    <img src="/icon.svg" alt="" className="event-compact-icon" width={36} height={36} />
                    <div className="event-compact-tile-body">
                      <span className="event-compact-title">{event.gameTitle}</span>
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
                  </button>
                );
              })}
              {events.length === 0 ? (
                <div className="event-compact-empty event-card">
                  <p className="eyebrow">Events</p>
                  <h2>{resolvedEmptyTitle}</h2>
                  <p className="muted">{resolvedEmptyBody}</p>
                </div>
              ) : null}
            </div>
            {selectedEvent ? (
              <div
                className="event-overlay-panel event-overlay-panel--detail"
                role="dialog"
                aria-modal="true"
                aria-label={selectedEvent.gameTitle}
              >
                <div className="event-overlay-toolbar">
                  <button type="button" className="secondary" onClick={() => setSelectedEventId(null)}>
                    Zurück zur Übersicht
                  </button>
                </div>
                {renderFullEventCard(selectedEvent)}
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    );
  }

  return (
    <section
      className={`event-board ${mode === "manager" ? "manager-board" : "events-board"}`}
      aria-label="Events"
    >
      {boardToolbar}
      {mode === "manager" && !canCreate ? (
        <div className="access-panel compact" aria-label="Manager Hinweis">
          <p className="eyebrow">Manager</p>
          <h2>Keine Managerrechte.</h2>
          <p className="muted">
            Neue Runden können nur Manager und Admins anlegen. Als Spieler kannst du hier weiter
            bestehende Runden verfolgen.
          </p>
        </div>
      ) : null}

      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="event-list">
        {events.map((event) => (
          <Fragment key={event.id}>{renderFullEventCard(event)}</Fragment>
        ))}
        {events.length === 0 ? (
          <article className="event-card">
            <p className="eyebrow">Events</p>
            <h2>{resolvedEmptyTitle}</h2>
            <p className="muted">{resolvedEmptyBody}</p>
          </article>
        ) : null}
      </div>

      {showCreateForm ? newEventForm : null}
    </section>
  );
}
