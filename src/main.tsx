import React, { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type User = {
  id: string;
  phoneNumber: string;
  username: string;
  email: string;
  role: "user" | "manager" | "admin";
  notificationsEnabled: boolean;
};

type AppSettings = {
  appName: string;
  defaultNotificationsEnabled: boolean;
  eventAutoArchiveHours: number;
};

type GameEvent = {
  id: string;
  gameTitle: string;
  startMode: "now" | "scheduled";
  startsAt: string;
  minPlayers: number;
  maxPlayers: number;
  serverHost: string | null;
  connectionInfo: string | null;
  status: "open" | "ready" | "running" | "cancelled" | "archived";
  createdByUserId: string;
  createdByUsername: string;
  joinedCount: number;
  myParticipation: "joined" | "declined" | null;
};

type Route = {
  path: string;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
};

const routes: Route[] = [
  {
    path: "#events",
    label: "Events",
    eyebrow: "LAN-Abstimmung",
    title: "Was startet als Naechstes?",
    description:
      "Spielrunden sammeln Zusagen, zeigen sofort die Spielerzahl und halten Startzeit sowie Serverdaten an einem Ort."
  },
  {
    path: "#login",
    label: "Login",
    eyebrow: "Einmalcode",
    title: "Telefonnummer, Username, Mailcode.",
    description:
      "Der Login ist fuer mehrere Geraete vorbereitet, damit Smartphone und PC parallel aktiv bleiben koennen."
  },
  {
    path: "#manager",
    label: "Manager",
    eyebrow: "Eventsteuerung",
    title: "Neue Runden ohne Umwege anlegen.",
    description:
      "Manager koennen Spiel, Startzeit, min/max Spieler und optionale Verbindungsdaten vorbereiten."
  },
  {
    path: "#admin",
    label: "Admin",
    eyebrow: "Betrieb",
    title: "User, Manager und Einstellungen.",
    description:
      "Der Haupt-Admin verwaltet Rollen und persistente Einstellungen fuer Mail, Benachrichtigungen und Betrieb."
  }
];

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    },
    ...options
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "request_failed");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

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
    running: "laeuft bereits",
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

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

function EventBoard({ currentUser }: { currentUser: User | null }) {
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

    setLiveState("connecting");
    const source = new EventSource("/api/realtime/events", { withCredentials: true });
    const poll = window.setInterval(() => {
      loadEvents().catch(() => setLiveState("polling"));
    }, 30_000);

    source.onopen = () => setLiveState("live");
    source.onerror = () => setLiveState("polling");
    source.addEventListener("events_changed", () => {
      loadEvents().catch(() => setLiveState("polling"));
    });

    return () => {
      source.close();
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
      setError(caught instanceof Error ? caught.message : "request_failed");
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
      setError(caught instanceof Error ? caught.message : "request_failed");
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
      setError(caught instanceof Error ? caught.message : "request_failed");
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
      setError(caught instanceof Error ? caught.message : "request_failed");
    }
  }

  function canManage(event: GameEvent) {
    return (
      currentUser?.role === "admin" ||
      currentUser?.role === "manager" ||
      currentUser?.id === event.createdByUserId
    );
  }

  function isJoinDisabled(event: GameEvent) {
    const alreadyJoined = event.myParticipation === "joined";
    const fullForOthers = event.joinedCount >= event.maxPlayers && !alreadyJoined;
    return alreadyJoined || fullForOthers;
  }

  if (!currentUser) {
    return (
      <div className="event-preview" aria-label="Login Hinweis">
        <p className="eyebrow">Login</p>
        <h2>Einloggen und Runden sehen.</h2>
        <p className="muted">Events, Serverdaten und Startzeiten sind nach dem Login verfuegbar.</p>
      </div>
    );
  }

  return (
    <section className="event-board" aria-label="Events">
      <div className="live-row">
        <span className={`live-state live-${liveState}`}>
          {liveState === "live" ? "Live verbunden" : "Polling aktiv"}
        </span>
        <button type="button" className="secondary" onClick={() => loadEvents()}>
          Aktualisieren
        </button>
      </div>
      {canCreate ? (
        <form onSubmit={createEvent} className="event-form">
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
              <p className="muted">
                {[event.serverHost, event.connectionInfo].filter(Boolean).join(" | ")}
              </p>
            ) : null}
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
                <button type="button" className="secondary" onClick={() => changeEventStatus(event.id, "archive")}>
                  Archivieren
                </button>
                <button type="button" className="secondary" onClick={() => changeEventStatus(event.id, "cancel")}>
                  Stornieren
                </button>
              </div>
            ) : null}
          </article>
        ))}
        {events.length === 0 ? (
          <article className="event-card">
            <p className="eyebrow">Events</p>
            <h2>Keine Runden offen.</h2>
            <p className="muted">Sobald ein Manager etwas anlegt, erscheint es hier.</p>
          </article>
        ) : null}
      </div>
    </section>
  );
}

function LoginPanel({
  currentUser,
  onLoggedIn,
  onLoggedOut,
  onUserUpdated
}: {
  currentUser: User | null;
  onLoggedIn: (user: User) => void;
  onLoggedOut: () => void;
  onUserUpdated: (user: User) => void;
}) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [step, setStep] = useState<"request" | "verify">("request");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson("/api/auth/request-code", {
        method: "POST",
        body: JSON.stringify({ phoneNumber, username })
      });
      setStep("verify");
      setMessage("Code wurde per E-Mail versendet.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "request_failed");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await requestJson<{ user: User }>("/api/auth/verify-code", {
        method: "POST",
        body: JSON.stringify({ phoneNumber, username, code, deviceName })
      });
      onLoggedIn(result.user);
      setCode("");
      setMessage("Angemeldet.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "request_failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError("");
    await requestJson<void>("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    onLoggedOut();
    setStep("request");
    setMessage("Abgemeldet.");
    setBusy(false);
  }

  async function enableNotifications() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("push_nicht_unterstuetzt");
      }

      if (!window.isSecureContext) {
        throw new Error("secure_context_erforderlich");
      }

      const { publicKey } = await requestJson<{ publicKey: string }>("/api/push/public-key");
      const registration = await navigator.serviceWorker.register("/sw.js");
      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        throw new Error("permission_abgelehnt");
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      await requestJson("/api/push/subscriptions", {
        method: "POST",
        body: JSON.stringify(subscription.toJSON())
      });
      const result = await requestJson<{ user: User }>("/api/push/preferences", {
        method: "PATCH",
        body: JSON.stringify({ enabled: true })
      });
      onUserUpdated(result.user);
      setMessage("Notifications aktiv.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "request_failed");
    } finally {
      setBusy(false);
    }
  }

  async function disableNotifications() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await requestJson<{ user: User }>("/api/push/preferences", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false })
      });
      onUserUpdated(result.user);
      setMessage("Notifications deaktiviert.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "request_failed");
    } finally {
      setBusy(false);
    }
  }

  if (currentUser) {
    return (
      <section className="login-panel" id="login" aria-label="Aktuelle Anmeldung">
        <p className="eyebrow">Angemeldet</p>
        <h2>{currentUser.username}</h2>
        <dl className="account-list">
          <div>
            <dt>Rolle</dt>
            <dd>{currentUser.role}</dd>
          </div>
          <div>
            <dt>E-Mail</dt>
            <dd>{currentUser.email}</dd>
          </div>
        </dl>
        {message ? <p className="notice">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <div className="action-row">
          <button type="button" onClick={enableNotifications} disabled={busy}>
            Notifications aktivieren
          </button>
          <button type="button" className="secondary" onClick={disableNotifications} disabled={busy}>
            Deaktivieren
          </button>
        </div>
        <button type="button" className="secondary" onClick={logout} disabled={busy}>
          Logout
        </button>
      </section>
    );
  }

  return (
    <section className="login-panel" id="login" aria-label="Login">
      <p className="eyebrow">Login</p>
      <h2>{step === "request" ? "Einmalcode anfordern." : "Code eingeben."}</h2>
      <form onSubmit={step === "request" ? requestCode : verifyCode}>
        <label>
          Telefonnummer
          <input
            autoComplete="tel"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
            required
          />
        </label>
        <label>
          Username
          <input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </label>
        {step === "verify" ? (
          <>
            <label>
              Einmalcode
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </label>
            <label>
              Geraetename
              <input
                placeholder="PC, Smartphone, Laptop"
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
              />
            </label>
          </>
        ) : null}
        {message ? <p className="notice">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <div className="action-row">
          {step === "verify" ? (
            <button type="button" className="secondary" onClick={() => setStep("request")}>
              Zurueck
            </button>
          ) : null}
          <button type="submit" disabled={busy}>
            {step === "request" ? "Code senden" : "Einloggen"}
          </button>
        </div>
      </form>
    </section>
  );
}

function AdminPanel({ currentUser }: { currentUser: User | null }) {
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    appName: "Hermes",
    defaultNotificationsEnabled: true,
    eventAutoArchiveHours: 8
  });
  const [newUser, setNewUser] = useState({
    phoneNumber: "",
    username: "",
    email: "",
    role: "user" as User["role"]
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isAdmin = currentUser?.role === "admin";

  async function loadAdminData() {
    if (!isAdmin) {
      return;
    }

    const [userResult, settingsResult] = await Promise.all([
      requestJson<{ users: User[] }>("/api/admin/users"),
      requestJson<{ settings: AppSettings }>("/api/admin/settings")
    ]);
    setUsers(userResult.users);
    setSettings(settingsResult.settings);
  }

  useEffect(() => {
    loadAdminData().catch(() => undefined);
  }, [isAdmin]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      await requestJson<{ user: User }>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(newUser)
      });
      setNewUser({ phoneNumber: "", username: "", email: "", role: "user" });
      await loadAdminData();
      setMessage("User gespeichert.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "request_failed");
    }
  }

  async function updateRole(userId: string, role: User["role"]) {
    setError("");
    setMessage("");

    try {
      await requestJson<{ user: User }>(`/api/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      });
      await loadAdminData();
      setMessage("Rolle gespeichert.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "request_failed");
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      const result = await requestJson<{ settings: AppSettings }>("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(settings)
      });
      setSettings(result.settings);
      setMessage("Einstellungen gespeichert.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "request_failed");
    }
  }

  if (!isAdmin) {
    return (
      <article id="admin" className="route-card">
        <p className="eyebrow">Admin</p>
        <h2>User, Manager und Einstellungen.</h2>
        <p>Der Adminbereich ist nach Admin-Login verfuegbar.</p>
      </article>
    );
  }

  return (
    <section id="admin" className="admin-panel" aria-label="Adminbereich">
      <p className="eyebrow">Admin</p>
      <h2>User, Manager und Einstellungen.</h2>

      <form onSubmit={createUser} className="admin-form">
        <label>
          Telefonnummer
          <input
            value={newUser.phoneNumber}
            onChange={(event) => setNewUser({ ...newUser, phoneNumber: event.target.value })}
            required
          />
        </label>
        <label>
          Username
          <input
            value={newUser.username}
            onChange={(event) => setNewUser({ ...newUser, username: event.target.value })}
            required
          />
        </label>
        <label>
          E-Mail
          <input
            type="email"
            value={newUser.email}
            onChange={(event) => setNewUser({ ...newUser, email: event.target.value })}
            required
          />
        </label>
        <label>
          Rolle
          <select
            value={newUser.role}
            onChange={(event) =>
              setNewUser({ ...newUser, role: event.target.value as User["role"] })
            }
          >
            <option value="user">User</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit">User anlegen</button>
      </form>

      <div className="admin-list" aria-label="Userliste">
        {users.map((user) => (
          <div className="admin-list-row" key={user.id}>
            <div>
              <strong>{user.username}</strong>
              <span>{user.email}</span>
            </div>
            <select
              value={user.role}
              onChange={(event) => updateRole(user.id, event.target.value as User["role"])}
            >
              <option value="user">User</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        ))}
      </div>

      <form onSubmit={saveSettings} className="admin-form">
        <label>
          App-Name
          <input
            value={settings.appName}
            onChange={(event) => setSettings({ ...settings, appName: event.target.value })}
            required
          />
        </label>
        <label>
          Auto-Archiv nach Stunden
          <input
            type="number"
            min={1}
            max={72}
            value={settings.eventAutoArchiveHours}
            onChange={(event) =>
              setSettings({
                ...settings,
                eventAutoArchiveHours: Number(event.target.value)
              })
            }
            required
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.defaultNotificationsEnabled}
            onChange={(event) =>
              setSettings({
                ...settings,
                defaultNotificationsEnabled: event.target.checked
              })
            }
          />
          Notifications standardmaessig aktiv
        </label>
        {message ? <p className="notice">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <button type="submit">Einstellungen speichern</button>
      </form>
    </section>
  );
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    requestJson<{ user: User }>("/api/auth/me")
      .then((result) => setCurrentUser(result.user))
      .catch(() => setCurrentUser(null));
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar" aria-label="Hauptnavigation">
        <a className="brand" href="#events" aria-label="Hermes Start">
          <span className="brand-mark">H</span>
          <span>Hermes</span>
        </a>
        <nav className="nav-links">
          {routes.map((route) => (
            <a href={route.path} key={route.path}>
              {route.label}
            </a>
          ))}
        </nav>
      </header>

      <section className="workbench" id="events">
        <div className="intro">
          <p className="eyebrow">Hermes</p>
          <h1>Spielrunden fuer die LAN-Party koordinieren.</h1>
          <p>
            Eine schnelle WebApp fuer 25 Personen: abstimmen, Startzeit sehen,
            Serverdaten finden und Benachrichtigungen auf allen angemeldeten
            Geraeten erhalten.
          </p>
        </div>

        <EventBoard currentUser={currentUser} />
      </section>

      <section className="route-grid" aria-label="Vorbereitete Bereiche">
        <LoginPanel
          currentUser={currentUser}
          onLoggedIn={setCurrentUser}
          onLoggedOut={() => setCurrentUser(null)}
          onUserUpdated={setCurrentUser}
        />
        <article id="manager" className="route-card">
          <p className="eyebrow">Eventsteuerung</p>
          <h2>Neue Runden ohne Umwege anlegen.</h2>
          <p>
            Manager koennen Spiel, Startzeit, min/max Spieler und optionale
            Verbindungsdaten vorbereiten.
          </p>
        </article>
        <AdminPanel currentUser={currentUser} />
      </section>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
