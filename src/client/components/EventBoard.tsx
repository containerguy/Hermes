import React, { FormEvent, useEffect, useState } from "react";
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

export function EventBoard({
  currentUser,
  mode = "events"
}: {
  currentUser: User | null;
  mode?: "events" | "manager";
}) {
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
  const [editedStartsAt, setEditedStartsAt] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [liveState, setLiveState] = useState<"offline" | "connecting" | "live" | "polling">(
    "offline"
  );

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

  return (
    <section
      className={`event-board ${mode === "manager" ? "manager-board" : "events-board"}`}
      aria-label="Events"
    >
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
      {showCreateForm ? (
        <form onSubmit={createEvent} className="event-form">
          <div className="form-title">
            <p className="eyebrow">Neue Runde</p>
            <h2>Spielrunde vorbereiten.</h2>
            <p className="muted">
              Lege Spiel, Startfenster und optionale Join-Hinweise einmal sauber an, damit alle im
              Board dieselben Informationen sehen.
            </p>
          </div>
          <label>
            Spiel
            <input
              value={eventDraft.gameTitle}
              onChange={(event) =>
                setEventDraft({ ...eventDraft, gameTitle: event.target.value })
              }
              required
            />
          </label>
          <div className="form-grid">
            <label>
              Start
              <select
                value={eventDraft.startMode}
                onChange={(event) =>
                  setEventDraft({
                    ...eventDraft,
                    startMode: event.target.value as "now" | "scheduled"
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
                onChange={(event) =>
                  setEventDraft({ ...eventDraft, startsAt: event.target.value })
                }
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
                onChange={(event) =>
                  setEventDraft({ ...eventDraft, minPlayers: Number(event.target.value) })
                }
                required
              />
            </label>
            <label>
              Max
              <input
                type="number"
                min={1}
                value={eventDraft.maxPlayers}
                onChange={(event) =>
                  setEventDraft({ ...eventDraft, maxPlayers: Number(event.target.value) })
                }
                required
              />
            </label>
          </div>
          <label>
            Server
            <input
              value={eventDraft.serverHost}
              onChange={(event) => setEventDraft({ ...eventDraft, serverHost: event.target.value })}
            />
          </label>
          <label>
            Verbindung
            <input
              value={eventDraft.connectionInfo}
              onChange={(event) =>
                setEventDraft({ ...eventDraft, connectionInfo: event.target.value })
              }
            />
          </label>
          <button type="submit">Event anlegen</button>
        </form>
      ) : null}

      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="event-list">
        {events.map((event) => (
          <article className={`event-card event-${getEventStatusClass(event)}`} key={event.id}>
            <div className="event-header">
              <div>
                <p className="eyebrow">{event.startMode === "now" ? "Sofort" : "Geplant"}</p>
                <h2>{event.gameTitle}</h2>
              </div>
              <span className={`status-pill status-${getEventStatusClass(event)}`}>
                {getEventStatusLabel(event)}
              </span>
            </div>
            <dl className="event-stats">
              <div>
                <dt>Dabei</dt>
                <dd>
                  {event.joinedCount} / {event.maxPlayers}
                </dd>
              </div>
              <div>
                <dt>Minimum</dt>
                <dd>{event.minPlayers}</dd>
              </div>
              <div>
                <dt>Start</dt>
                <dd>{new Date(event.startsAt).toLocaleString("de-DE")}</dd>
              </div>
            </dl>
            {event.serverHost || event.connectionInfo ? (
              <p className="muted event-join-hint">
                {[event.serverHost, event.connectionInfo].filter(Boolean).join(" | ")}
              </p>
            ) : (
              <p className="muted event-join-hint">
                Server- und Join-Hinweise fehlen noch. Frag kurz im LAN nach, bevor ihr startet.
              </p>
            )}
            {event.status !== "archived" && event.status !== "cancelled" ? (
              <div className="action-row">
                <button
                  type="button"
                  onClick={() => setParticipation(event.id, "joined")}
                  disabled={isJoinDisabled(event)}
                >
                  Dabei
                </button>
                <button
                  type="button"
                  className="secondary"
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
                <button
                  type="button"
                  className="secondary"
                  onClick={() => changeEventStatus(event.id, "archive")}
                >
                  Archivieren
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => changeEventStatus(event.id, "cancel")}
                >
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
        ))}
        {events.length === 0 ? (
          <article className="event-card">
            <p className="eyebrow">Events</p>
            <h2>Noch keine Runden im Board.</h2>
            <p className="muted">
              Sobald ein Manager eine Runde vorbereitet, tauchen Spiel, Startfenster und Join-Hinweise hier auf.
            </p>
          </article>
        ) : null}
      </div>
    </section>
  );
}

