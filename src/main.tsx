import React, { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import type {
  AppSettings,
  AuditLogEntry,
  GameEvent,
  InviteCode,
  RateLimitAllowlistEntry,
  RateLimitEntry,
  RestoreDiagnostics,
  RestoreRecovery,
  StorageInfo,
  User,
  UserSession
} from "./client/types/core";
import { requestJson } from "./client/api/request";
import { clearCsrfToken, primeCsrfToken } from "./client/api/csrf";
import { ApiError, errorMessages, getErrorMessage } from "./client/errors/errors";
import { EventBoard } from "./client/components/EventBoard";
import { ManagerPage } from "./client/components/ManagerPage";

type Route = {
  id: PageId;
  path: string;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
};

type PageId = "events" | "login" | "manager" | "admin";

const routes: Route[] = [
  {
    id: "events",
    path: "#events",
    label: "Events",
    eyebrow: "LAN-Abstimmung",
    title: "Was startet als Nächstes?",
    description:
      "Spielrunden sammeln Zusagen, zeigen sofort die Spielerzahl und halten Startzeit sowie Serverdaten an einem Ort."
  },
  {
    id: "login",
    path: "#login",
    label: "Login",
    eyebrow: "Einmalcode",
    title: "Username und Mailcode.",
    description:
      "Der Login ist für mehrere Geräte vorbereitet, damit Smartphone und PC parallel aktiv bleiben können."
  },
  {
    id: "manager",
    path: "#manager",
    label: "Manager",
    eyebrow: "Eventsteuerung",
    title: "Neue Runden ohne Umwege anlegen.",
    description:
      "Manager können Spiel, Startzeit, min/max Spieler und optionale Verbindungsdaten vorbereiten."
  },
  {
    id: "admin",
    path: "#admin",
    label: "Admin",
    eyebrow: "Betrieb",
    title: "User, Manager und Einstellungen.",
    description:
      "Der Haupt-Admin verwaltet Rollen und persistente Einstellungen für Mail, Benachrichtigungen und Betrieb."
  }
];

const defaultSettings: AppSettings = {
  appName: "Hermes",
  defaultNotificationsEnabled: true,
  eventAutoArchiveHours: 8,
  publicRegistrationEnabled: false,
  themePrimaryColor: "#0f766e",
  themeLoginColor: "#be123c",
  themeManagerColor: "#b7791f",
  themeAdminColor: "#2563eb",
  themeSurfaceColor: "#f6f8f4"
};

function applyTheme(settings: AppSettings) {
  const root = document.documentElement;
  root.style.setProperty("--teal", settings.themePrimaryColor);
  root.style.setProperty("--rose", settings.themeLoginColor);
  root.style.setProperty("--amber", settings.themeManagerColor);
  root.style.setProperty("--blue", settings.themeAdminColor);
  root.style.setProperty("--surface", settings.themeSurfaceColor);
}

function getPageFromHash(): PageId {
  const route = routes.find((item) => item.path === window.location.hash);
  return route?.id ?? "events";
}

function toDatetimeLocal(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDatetimeLocal(value: string) {
  return new Date(value).toISOString();
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

function getPushSupport() {
  const isSecure = window.isSecureContext;
  const hasServiceWorker = "serviceWorker" in navigator;
  const hasPushManager = "PushManager" in window;
  const hasNotification = "Notification" in window;
  const permission = hasNotification ? Notification.permission : "unsupported";
  const hasApis = hasServiceWorker && hasPushManager && hasNotification;
  return {
    isSecure,
    hasServiceWorker,
    hasPushManager,
    hasNotification,
    permission,
    hasApis,
    canAttemptSubscribe: isSecure && hasApis
  };
}

function LoginPanel({
  currentUser,
  settings,
  onLoggedIn,
  onLoggedOut,
  onUserUpdated
}: {
  currentUser: User | null;
  settings: AppSettings;
  onLoggedIn: (user: User) => void;
  onLoggedOut: () => void;
  onUserUpdated: (user: User) => void;
}) {
  const [username, setUsername] = useState("");
  const [registration, setRegistration] = useState({ inviteCode: "", username: "", email: "" });
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [step, setStep] = useState<"request" | "verify">("request");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [sessionNames, setSessionNames] = useState<Record<string, string>>({});
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [emailVerifyCode, setEmailVerifyCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadSessions() {
    if (!currentUser) {
      setSessions([]);
      return;
    }

    const result = await requestJson<{ sessions: UserSession[] }>("/api/auth/sessions");
    setSessions(result.sessions);
    setSessionNames(
      Object.fromEntries(
        result.sessions.map((session) => [session.id, session.deviceName || "Unbenanntes Gerät"])
      )
    );
  }

  useEffect(() => {
    loadSessions().catch(() => undefined);
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser) {
      setDisplayNameDraft("");
      setEmailDraft("");
      setEmailVerifyCode("");
      return;
    }

    setDisplayNameDraft(currentUser.displayName || currentUser.username);
    setEmailDraft(currentUser.email);
  }, [currentUser?.id, currentUser?.displayName, currentUser?.email, currentUser?.username]);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson("/api/auth/request-code", {
        method: "POST",
        body: JSON.stringify({ username })
      });
      setStep("verify");
      setMessage("Code wurde per E-Mail versendet.");
    } catch (caught) {
      setError(getErrorMessage(caught));
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
        body: JSON.stringify({ username, code, deviceName })
      });
      onLoggedIn(result.user);
      primeCsrfToken();
      setCode("");
      setMessage("Angemeldet.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function registerUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson<{ user: User; codeSent: boolean }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(registration)
      });
      setUsername(registration.username);
      setMode("login");
      setStep("verify");
      setMessage("Registrierung gespeichert. Code wurde per E-Mail versendet.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError("");
    await requestJson<void>("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    clearCsrfToken();
    onLoggedOut();
    setStep("request");
    setMessage("Abgemeldet.");
    setBusy(false);
  }

  async function revokeSession(sessionId: string) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await requestJson<{ revokedCurrent: boolean }>(`/api/auth/sessions/${sessionId}`, {
        method: "DELETE"
      });

      if (result.revokedCurrent) {
        clearCsrfToken();
        onLoggedOut();
        setMessage("Dieses Gerät wurde abgemeldet.");
        return;
      }

      await loadSessions();
      setMessage("Gerät abgemeldet.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await requestJson<{ user: User }>("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({ displayName: displayNameDraft })
      });
      onUserUpdated(result.user);
      setMessage("Profil gespeichert.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function requestEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson<{ ok: true }>("/api/auth/email-change", {
        method: "POST",
        body: JSON.stringify({ newEmail: emailDraft })
      });
      setMessage("Bestätigungscode wurde an die neue E-Mail-Adresse versendet.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson<{ user: User }>("/api/auth/email-change/verify", {
        method: "POST",
        body: JSON.stringify({ code: emailVerifyCode })
      });
      clearCsrfToken();
      onLoggedOut();
      setStep("request");
      setEmailVerifyCode("");
      setMessage("E-Mail bestätigt. Bitte erneut einloggen.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function renameSession(sessionId: string) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson<{ session?: UserSession }>(`/api/auth/sessions/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ deviceName: sessionNames[sessionId] ?? "" })
      });
      await loadSessions();
      setMessage("Gerätename gespeichert.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function enableNotifications() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const support = getPushSupport();
      if (!support.isSecure) {
        throw new Error("secure_context_erforderlich");
      }

      if (!support.hasApis) {
        throw new Error("push_nicht_unterstuetzt");
      }

      if (support.permission === "denied") {
        throw new Error("permission_abgelehnt");
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
      setError(getErrorMessage(caught));
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
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (currentUser) {
    const pushSupport = getPushSupport();
    return (
      <section className="login-panel" id="login" aria-label="Aktuelle Anmeldung">
        <p className="eyebrow">Profil</p>
        <h2>{currentUser.displayName || currentUser.username}</h2>
        <dl className="account-list">
          <div>
            <dt>Login</dt>
            <dd>{currentUser.username}</dd>
          </div>
          <div>
            <dt>Rolle</dt>
            <dd>{currentUser.role}</dd>
          </div>
          <div>
            <dt>E-Mail</dt>
            <dd>{currentUser.email}</dd>
          </div>
        </dl>

        <section className="device-panel" aria-label="Profilverwaltung">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Profil</p>
              <h2>Profil und E-Mail.</h2>
            </div>
          </div>

          <form onSubmit={updateProfile} className="admin-form">
            <label>
              Anzeigename (frei wählbar)
              <input
                value={displayNameDraft}
                onChange={(event) => setDisplayNameDraft(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={busy}>
              Anzeigename speichern
            </button>
          </form>

          <form onSubmit={requestEmailChange} className="admin-form">
            <label>
              Neue E-Mail-Adresse
              <input
                type="email"
                value={emailDraft}
                onChange={(event) => setEmailDraft(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={busy}>
              Bestätigungscode senden
            </button>
          </form>

          <form onSubmit={verifyEmailChange} className="admin-form">
            <label>
              Bestätigungscode
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                value={emailVerifyCode}
                onChange={(event) => setEmailVerifyCode(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={busy}>
              E-Mail bestätigen
            </button>
          </form>
        </section>

        {message ? <p className="notice">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <section className="device-panel" aria-label="Notifications Hinweise">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Notifications</p>
              <h2>Voraussetzungen.</h2>
            </div>
          </div>
          <p className="muted">
            Push braucht <strong>HTTPS</strong> (oder <strong>localhost</strong>), Browser-Unterstützung und eine
            aktivierte OS-Permission. Auf Smartphones funktioniert es oft am zuverlässigsten, wenn Hermes als{" "}
            <strong>PWA installiert</strong> ist.
          </p>
          <dl className="account-list">
            <div>
              <dt>Secure Context</dt>
              <dd>{pushSupport.isSecure ? "ok" : "HTTPS/localhost erforderlich"}</dd>
            </div>
            <div>
              <dt>Browser APIs</dt>
              <dd>{pushSupport.hasApis ? "ok" : "Push/Notification/ServiceWorker fehlt"}</dd>
            </div>
            <div>
              <dt>Permission</dt>
              <dd>
                {pushSupport.permission === "unsupported"
                  ? "nicht verfügbar"
                  : pushSupport.permission === "default"
                    ? "noch nicht gefragt"
                    : pushSupport.permission}
              </dd>
            </div>
          </dl>
        </section>
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
        <section className="device-panel" aria-label="Angemeldete Geräte">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Geräte</p>
              <h2>Angemeldete Geräte.</h2>
            </div>
            <button type="button" className="secondary" onClick={() => loadSessions()} disabled={busy}>
              Aktualisieren
            </button>
          </div>
          <div className="device-list">
            {sessions.map((session) => (
              <article className="device-row" key={session.id}>
                <div>
                  <strong>{session.current ? "Aktuelles Gerät" : "Gerät"}</strong>
                  <label>
                    Name
                    <input
                      value={sessionNames[session.id] ?? session.deviceName ?? ""}
                      onChange={(event) =>
                        setSessionNames({ ...sessionNames, [session.id]: event.target.value })
                      }
                      disabled={busy}
                      required
                    />
                  </label>
                  <span>{session.userAgent || "Kein User-Agent gespeichert"}</span>
                  <time dateTime={session.lastSeenAt}>
                    Zuletzt aktiv: {new Date(session.lastSeenAt).toLocaleString("de-DE")}
                  </time>
                </div>
                <div className="device-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => renameSession(session.id)}
                    disabled={busy}
                  >
                    Name speichern
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => revokeSession(session.id)}
                    disabled={busy}
                  >
                    Abmelden
                  </button>
                </div>
              </article>
            ))}
            {sessions.length === 0 ? (
              <article className="device-row">
                <strong>Keine Geräte geladen.</strong>
                <span>Aktualisieren lädt deine aktiven Sessions.</span>
              </article>
            ) : null}
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="login-panel" id="login" aria-label="Login">
      <p className="eyebrow">{mode === "register" ? "Registrierung" : "Login"}</p>
      <h2>
        {mode === "register"
          ? "Mit Invite-Code registrieren."
          : step === "request"
            ? "Einmalcode anfordern."
            : "Code eingeben."}
      </h2>
      {mode === "register" ? (
        <form onSubmit={registerUser}>
          <label>
            Invite-Code
            <input
              value={registration.inviteCode}
              onChange={(event) =>
                setRegistration({ ...registration, inviteCode: event.target.value })
              }
              required
            />
          </label>
          <label>
            Username
            <input
              autoComplete="username"
              value={registration.username}
              onChange={(event) => setRegistration({ ...registration, username: event.target.value })}
              required
            />
          </label>
          <label>
            E-Mail
            <input
              type="email"
              value={registration.email}
              onChange={(event) => setRegistration({ ...registration, email: event.target.value })}
              required
            />
          </label>
          {message ? <p className="notice">{message}</p> : null}
          {error ? <p className="error">{error}</p> : null}
          <div className="action-row">
            <button type="button" className="secondary" onClick={() => setMode("login")}>
              Zum Login
            </button>
            <button type="submit" disabled={busy}>
              Registrieren
            </button>
          </div>
        </form>
      ) : (
      <form onSubmit={step === "request" ? requestCode : verifyCode}>
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
              Gerätename
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
              Zurück
            </button>
          ) : null}
          <button type="submit" disabled={busy}>
            {step === "request" ? "Code senden" : "Einloggen"}
          </button>
        </div>
        {settings.publicRegistrationEnabled ? (
          <button type="button" className="secondary" onClick={() => setMode("register")}>
            Mit Invite-Code registrieren
          </button>
        ) : null}
      </form>
      )}
    </section>
  );
}

function AdminPanel({
  currentUser,
  onSettingsChanged
}: {
  currentUser: User | null;
  onSettingsChanged: (settings: AppSettings) => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [rateLimits, setRateLimits] = useState<RateLimitEntry[]>([]);
  const [rateLimitAllowlist, setRateLimitAllowlist] = useState<RateLimitAllowlistEntry[]>([]);
  const [allowlistDraft, setAllowlistDraft] = useState({ ipOrCidr: "", note: "" });
  const [inviteDrafts, setInviteDrafts] = useState<
    Record<string, { label: string; maxUses: string; expiresAt: string }>
  >({});
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [restoreDiagnostics, setRestoreDiagnostics] = useState<RestoreDiagnostics | null>(null);
  const [restoreRecovery, setRestoreRecovery] = useState<RestoreRecovery | null>(null);
  const [newUser, setNewUser] = useState({
    username: "",
    email: "",
    role: "user" as User["role"]
  });
  const [newInvite, setNewInvite] = useState({
    label: "",
    maxUses: "",
    expiresAt: ""
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [opsBusy, setOpsBusy] = useState(false);
  const [rateLimitBusy, setRateLimitBusy] = useState(false);

  const isAdmin = currentUser?.role === "admin";

  async function loadAdminData() {
    if (!isAdmin) {
      return;
    }

    const [
      userResult,
      settingsResult,
      auditResult,
      inviteResult,
      rateLimitResult,
      allowlistResult
    ] = await Promise.all([
      requestJson<{ users: User[] }>("/api/admin/users"),
      requestJson<{ settings: AppSettings; storage?: StorageInfo }>("/api/admin/settings"),
      requestJson<{ auditLogs: AuditLogEntry[] }>("/api/admin/audit-log?limit=80"),
      requestJson<{ inviteCodes: InviteCode[] }>("/api/admin/invite-codes"),
      requestJson<{ rateLimits: RateLimitEntry[] }>("/api/admin/rate-limits"),
      requestJson<{ allowlist: RateLimitAllowlistEntry[] }>("/api/admin/rate-limits/allowlist")
    ]);
    setUsers(userResult.users);
    setSettings(settingsResult.settings);
    setStorage(settingsResult.storage ?? null);
    setAuditLogs(auditResult.auditLogs);
    setInviteCodes(inviteResult.inviteCodes);
    setRateLimits(rateLimitResult.rateLimits);
    setRateLimitAllowlist(allowlistResult.allowlist);
    setInviteDrafts(
      Object.fromEntries(
        inviteResult.inviteCodes.map((invite) => [
          invite.id,
          {
            label: invite.label,
            maxUses: invite.maxUses === null ? "" : String(invite.maxUses),
            expiresAt: invite.expiresAt ? toDatetimeLocal(invite.expiresAt) : ""
          }
        ])
      )
    );
  }

  useEffect(() => {
    loadAdminData().catch(() => undefined);
  }, [isAdmin]);

  function getActiveRateLimitEntries() {
    const now = Date.now();
    return rateLimits
      .filter((entry) => entry.blockedUntil && new Date(entry.blockedUntil).getTime() > now)
      .sort((a, b) => new Date(b.blockedUntil ?? 0).getTime() - new Date(a.blockedUntil ?? 0).getTime());
  }

  async function clearRateLimitEntry(entry: RateLimitEntry) {
    const confirmed = window.confirm("Rate-Limit wirklich löschen? (Block wird sofort aufgehoben)");
    if (!confirmed) {
      return;
    }

    setRateLimitBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson<{ ok: true }>(`/api/admin/rate-limits/${entry.id}`, { method: "DELETE" });
      await loadAdminData();
      setMessage("Rate-Limit gelöscht.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setRateLimitBusy(false);
    }
  }

  async function addAllowlistEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRateLimitBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson<{ ok: true; id: string }>("/api/admin/rate-limits/allowlist", {
        method: "POST",
        body: JSON.stringify({
          ipOrCidr: allowlistDraft.ipOrCidr,
          note: allowlistDraft.note
        })
      });
      setAllowlistDraft({ ipOrCidr: "", note: "" });
      await loadAdminData();
      setMessage("Allowlist-Eintrag gespeichert.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setRateLimitBusy(false);
    }
  }

  async function deleteAllowlistEntry(entry: RateLimitAllowlistEntry) {
    const confirmed = window.confirm("Allowlist-Eintrag wirklich löschen?");
    if (!confirmed) {
      return;
    }

    setRateLimitBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson<{ ok: true }>(`/api/admin/rate-limits/allowlist/${entry.id}`, {
        method: "DELETE"
      });
      await loadAdminData();
      setMessage("Allowlist-Eintrag gelöscht.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setRateLimitBusy(false);
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      await requestJson<{ user: User }>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(newUser)
      });
      setNewUser({ username: "", email: "", role: "user" });
      await loadAdminData();
      setMessage("User gespeichert.");
    } catch (caught) {
      setError(getErrorMessage(caught));
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
      setError(getErrorMessage(caught));
    }
  }

  async function deleteUser(user: User) {
    const confirmed = window.confirm(`User ${user.username} wirklich löschen?`);

    if (!confirmed) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await requestJson<void>(`/api/admin/users/${user.id}`, { method: "DELETE" });
      await loadAdminData();
      setMessage("User gelöscht.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function createInviteCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      const payload: { label: string; maxUses?: number | null; expiresAt?: string | null } = {
        label: newInvite.label
      };

      if (newInvite.maxUses !== "") {
        payload.maxUses = Number(newInvite.maxUses);
      }

      if (newInvite.expiresAt !== "") {
        payload.expiresAt = fromDatetimeLocal(newInvite.expiresAt);
      }

      await requestJson<{ inviteCode: InviteCode }>("/api/admin/invite-codes", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setNewInvite({ label: "", maxUses: "", expiresAt: "" });
      await loadAdminData();
      setMessage("Invite-Code erstellt.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function deactivateInviteCode(invite: InviteCode) {
    const confirmed = window.confirm(`Invite ${invite.label} wirklich deaktivieren?`);

    if (!confirmed) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await requestJson<{ inviteCode: InviteCode }>(`/api/admin/invite-codes/${invite.id}/deactivate`, {
        method: "POST"
      });
      await loadAdminData();
      setMessage("Invite-Code deaktiviert.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function reactivateInviteCode(invite: InviteCode) {
    const confirmed = window.confirm(`Invite ${invite.label} wirklich reaktivieren?`);

    if (!confirmed) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await requestJson<{ inviteCode: InviteCode }>(`/api/admin/invite-codes/${invite.id}/reactivate`, {
        method: "POST"
      });
      await loadAdminData();
      setMessage("Invite-Code reaktiviert.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function updateInviteCode(invite: InviteCode) {
    setError("");
    setMessage("");

    const draft = inviteDrafts[invite.id];
    if (!draft) {
      return;
    }

    try {
      const payload: { label?: string; maxUses?: number | null; expiresAt?: string | null } = {
        label: draft.label.trim()
      };

      if (draft.maxUses.trim() === "") {
        payload.maxUses = null;
      } else {
        payload.maxUses = Number(draft.maxUses);
      }

      payload.expiresAt = draft.expiresAt.trim() ? fromDatetimeLocal(draft.expiresAt) : null;

      await requestJson<{ inviteCode: InviteCode }>(`/api/admin/invite-codes/${invite.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      await loadAdminData();
      setMessage("Invite gespeichert.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function deleteUnusedInviteCode(invite: InviteCode) {
    const confirmed = window.confirm(`Invite ${invite.label} wirklich löschen? (Nur möglich ohne Nutzungen)`);

    if (!confirmed) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await requestJson<void>(`/api/admin/invite-codes/${invite.id}`, { method: "DELETE" });
      await loadAdminData();
      setMessage("Invite gelöscht.");
    } catch (caught) {
      setError(getErrorMessage(caught));
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
      onSettingsChanged(result.settings);
      setMessage("Einstellungen gespeichert.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function runBackup() {
    setOpsBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson<{ ok: boolean }>("/api/admin/backup", { method: "POST" });
      await loadAdminData();
      setMessage("Backup wurde nach S3 geschrieben.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setOpsBusy(false);
    }
  }

  async function runRestore() {
    const confirmed = window.confirm(
      "Restore wirklich starten? Hermes validiert zuerst den Snapshot und erstellt vor dem Restore ein Recovery-Backup."
    );

    if (!confirmed) {
      return;
    }

    setOpsBusy(true);
    setError("");
    setMessage("");
    setRestoreDiagnostics(null);
    setRestoreRecovery(null);

    try {
      const result = await requestJson<{
        ok: boolean;
        recovery?: RestoreRecovery | null;
      }>("/api/admin/restore", { method: "POST" });
      await loadAdminData();
      const recovery = result.recovery ?? null;
      setRestoreRecovery(recovery);
      setMessage(
        recovery
          ? `Restore abgeschlossen. Recovery: ${recovery.id} (${recovery.key}). Bitte prüfe User, Events und deine aktuelle Session.`
          : "Restore abgeschlossen. Bitte prüfe User, Events und deine aktuelle Session."
      );
    } catch (caught) {
      setError(getErrorMessage(caught));
      if (caught instanceof ApiError) {
        const body = caught.body as { diagnostics?: RestoreDiagnostics; recovery?: RestoreRecovery | null } | null | undefined;
        const diagnostics = body?.diagnostics ?? null;
        setRestoreDiagnostics(diagnostics);
        setRestoreRecovery(body?.recovery ?? diagnostics?.recovery ?? null);
      }
    } finally {
      setOpsBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <article id="admin" className="access-panel admin-access">
        <img src="/icon.svg" alt="" />
        <p className="eyebrow">Admin</p>
        <h2>User, Manager und Einstellungen.</h2>
        <p>Der Adminbereich ist nach Admin-Login verfügbar.</p>
        <a className="text-link" href="#login">
          Admin-Login öffnen
        </a>
      </article>
    );
  }

  const activeRateLimits = getActiveRateLimitEntries();

  return (
    <section id="admin" className="admin-panel" aria-label="Adminbereich">
      <p className="eyebrow">Admin</p>
      <h2>User, Manager und Einstellungen.</h2>

      <form onSubmit={createUser} className="admin-form">
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
            <button
              type="button"
              className="secondary danger"
              onClick={() => deleteUser(user)}
              disabled={user.id === currentUser?.id}
            >
              Löschen
            </button>
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
          Notifications standardmäßig aktiv
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.publicRegistrationEnabled}
            onChange={(event) =>
              setSettings({
                ...settings,
                publicRegistrationEnabled: event.target.checked
              })
            }
          />
          Öffentliche Registrierung per Invite-Code erlauben
        </label>
        <div className="color-grid" aria-label="Designfarben">
          <label>
            Primärfarbe
            <input
              type="color"
              value={settings.themePrimaryColor}
              onChange={(event) =>
                setSettings({ ...settings, themePrimaryColor: event.target.value })
              }
            />
          </label>
          <label>
            Loginfarbe
            <input
              type="color"
              value={settings.themeLoginColor}
              onChange={(event) => setSettings({ ...settings, themeLoginColor: event.target.value })}
            />
          </label>
          <label>
            Managerfarbe
            <input
              type="color"
              value={settings.themeManagerColor}
              onChange={(event) =>
                setSettings({ ...settings, themeManagerColor: event.target.value })
              }
            />
          </label>
          <label>
            Adminfarbe
            <input
              type="color"
              value={settings.themeAdminColor}
              onChange={(event) => setSettings({ ...settings, themeAdminColor: event.target.value })}
            />
          </label>
          <label>
            Hintergrund
            <input
              type="color"
              value={settings.themeSurfaceColor}
              onChange={(event) =>
                setSettings({ ...settings, themeSurfaceColor: event.target.value })
              }
            />
          </label>
        </div>
        {message ? <p className="notice">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <button type="submit">Einstellungen speichern</button>
      </form>

      <section className="admin-ops" aria-label="Backup und Restore">
        <p className="eyebrow">Storage</p>
        <h2>Backup und Restore.</h2>
        <p className="muted">
          Backup schreibt den aktuellen SQLite-Snapshot nach S3. Restore ersetzt die aktiven Daten
          durch den Snapshot aus S3.
        </p>
        {storage?.backend === "disabled" ? (
          <p className="muted">S3 Snapshot Storage ist deaktiviert (HERMES_STORAGE_BACKEND ≠ s3).</p>
        ) : (
          <div className="device-list" aria-label="Backup Status">
            <article className="device-row">
              <div>
                <strong>Backup Status</strong>
                <span>
                  Letzter Erfolg:{" "}
                  {storage?.backupStatus?.lastSuccessAt
                    ? new Date(storage.backupStatus.lastSuccessAt).toLocaleString("de-DE")
                    : "—"}
                </span>
                <span>
                  Letzter Fehler:{" "}
                  {storage?.backupStatus?.lastFailureAt
                    ? new Date(storage.backupStatus.lastFailureAt).toLocaleString("de-DE")
                    : "—"}
                </span>
                <span>
                  Fehlercode: {storage?.backupStatus?.failureCode ? storage.backupStatus.failureCode : "—"}
                </span>
                <span>
                  Hinweis: {storage?.backupStatus?.failureSummary ? storage.backupStatus.failureSummary : "—"}
                </span>
                <span>
                  Ziel:{" "}
                  {storage?.location
                    ? `s3://${storage.location.bucket}/${storage.location.key} (${storage.location.region})`
                    : "—"}
                </span>
                <span>Endpoint: {storage?.location?.endpoint ?? "—"}</span>
              </div>
            </article>
          </div>
        )}
        <div className="action-row">
          <button type="button" onClick={runBackup} disabled={opsBusy}>
            Backup starten
          </button>
          <button type="button" className="secondary" onClick={runRestore} disabled={opsBusy}>
            Restore starten
          </button>
        </div>
        {restoreRecovery ? (
          <p className="muted">
            Recovery: <strong>{restoreRecovery.id}</strong> · <code>{restoreRecovery.key}</code>
          </p>
        ) : null}
        {restoreDiagnostics ? (
          <div className="device-list" aria-label="Restore Diagnostik">
            <article className="device-row">
              <div>
                <strong>Restore Diagnostik</strong>
                <span>Typ: {restoreDiagnostics.kind}</span>
                <span>Hinweis: {restoreDiagnostics.summary}</span>
                {restoreDiagnostics.migrations ? (
                  <span>
                    Migrationen: live {restoreDiagnostics.migrations.liveLatest ?? "—"} · snapshot{" "}
                    {restoreDiagnostics.migrations.snapshotLatest ?? "—"}
                  </span>
                ) : null}
                {restoreDiagnostics.missingTables?.length ? (
                  <span>Fehlende Tabellen: {restoreDiagnostics.missingTables.slice(0, 10).join(", ")}</span>
                ) : null}
                {restoreDiagnostics.columnMismatches?.length ? (
                  <span>
                    Spalten:{" "}
                    {restoreDiagnostics.columnMismatches
                      .slice(0, 5)
                      .map((m) => `${m.table} (missing: ${m.missingInSnapshot.slice(0, 6).join(", ")})`)
                      .join(" · ")}
                  </span>
                ) : null}
                {restoreDiagnostics.foreignKeyFailures?.length ? (
                  <span>
                    FK Fehler:{" "}
                    {restoreDiagnostics.foreignKeyFailures
                      .slice(0, 5)
                      .map((fk) => `${fk.table}#${fk.rowid} -> ${fk.parent}`)
                      .join(" · ")}
                  </span>
                ) : null}
                {restoreDiagnostics.snapshot ? (
                  <span>
                    Snapshot: s3://{restoreDiagnostics.snapshot.bucket}/{restoreDiagnostics.snapshot.key}
                  </span>
                ) : null}
              </div>
            </article>
          </div>
        ) : null}
      </section>

      <section className="rate-limit-panel" aria-label="Rate-Limit Betrieb">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Rate-Limits</p>
            <h2>Sperren prüfen und aufheben.</h2>
          </div>
          <button type="button" className="secondary" onClick={() => loadAdminData()} disabled={rateLimitBusy}>
            Aktualisieren
          </button>
        </div>
        <p className="muted">
          Wenn sich jemand im LAN versehentlich aussperrt, kannst du aktive IP/Username-Sperren hier
          sehen, löschen und lokale IPs/PREFIXe in eine Allowlist aufnehmen.
        </p>

        <div className="device-list" aria-label="Aktive Rate-Limit Sperren">
          {activeRateLimits.map((entry) => (
            <article className="device-row" key={entry.id}>
              <div>
                <strong>{entry.scope}</strong>
                <span>Key: {entry.key.slice(0, 10)}…</span>
                <span>Versuche: {entry.attemptCount}</span>
                <time dateTime={entry.blockedUntil ?? undefined}>
                  Gesperrt bis:{" "}
                  {entry.blockedUntil ? new Date(entry.blockedUntil).toLocaleString("de-DE") : "—"}
                </time>
              </div>
              <div className="device-actions">
                <button type="button" className="secondary danger" onClick={() => clearRateLimitEntry(entry)} disabled={rateLimitBusy}>
                  Sperre löschen
                </button>
              </div>
            </article>
          ))}
          {activeRateLimits.length === 0 ? (
            <article className="device-row">
              <strong>Keine aktiven Sperren.</strong>
              <span>Wenn Rate-Limits aktiv sind, erscheinen sie hier.</span>
            </article>
          ) : null}
        </div>

        <form onSubmit={addAllowlistEntry} className="admin-form inline-form" aria-label="Allowlist Eintrag hinzufügen">
          <label>
            IP oder CIDR (z.B. 192.168.0.42 oder 192.168.0.0/24)
            <input
              value={allowlistDraft.ipOrCidr}
              onChange={(event) => setAllowlistDraft({ ...allowlistDraft, ipOrCidr: event.target.value })}
              required
            />
          </label>
          <label>
            Label (z.B. "Router", "Gaming-PC", "Admin-Laptop")
            <input
              value={allowlistDraft.note}
              onChange={(event) => setAllowlistDraft({ ...allowlistDraft, note: event.target.value })}
              required
            />
          </label>
          <button type="submit" disabled={rateLimitBusy}>
            Allowlist speichern
          </button>
        </form>

        <div className="device-list" aria-label="Rate-Limit Allowlist">
          {rateLimitAllowlist.map((entry) => (
            <article className="device-row" key={entry.id}>
              <div>
                <strong>{entry.ipOrCidr}</strong>
                <span>{entry.note ?? "Ohne Label"}</span>
                <time dateTime={entry.updatedAt}>
                  Aktualisiert: {new Date(entry.updatedAt).toLocaleString("de-DE")}
                </time>
              </div>
              <div className="device-actions">
                <button type="button" className="secondary danger" onClick={() => deleteAllowlistEntry(entry)} disabled={rateLimitBusy}>
                  Entfernen
                </button>
              </div>
            </article>
          ))}
          {rateLimitAllowlist.length === 0 ? (
            <article className="device-row">
              <strong>Noch keine Allowlist-Einträge.</strong>
              <span>Für stabile LAN-Setups können lokale IPs hier ausgenommen werden.</span>
            </article>
          ) : null}
        </div>
      </section>

      <section className="invite-panel" aria-label="Invite-Codes">
        <p className="eyebrow">Invites</p>
        <h2>LAN-Party Invite-Codes.</h2>
        <p className="muted">
          Wenn Felder leer bleiben, nutzt Hermes standardmäßig <strong>300</strong> Nutzungen und{" "}
          <strong>30 Tage</strong> Laufzeit.
        </p>
        <form onSubmit={createInviteCode} className="admin-form inline-form">
          <label>
            Name
            <input
              value={newInvite.label}
              onChange={(event) => setNewInvite({ ...newInvite, label: event.target.value })}
              placeholder="LAN Party April"
              required
            />
          </label>
          <label>
            Max. Nutzungen
            <input
              type="number"
              min={1}
              max={500}
              value={newInvite.maxUses}
              onChange={(event) =>
                setNewInvite({ ...newInvite, maxUses: event.target.value })
              }
              placeholder="300"
            />
          </label>
          <label>
            Gültig bis
            <input
              type="datetime-local"
              value={newInvite.expiresAt}
              onChange={(event) => setNewInvite({ ...newInvite, expiresAt: event.target.value })}
              placeholder="30 Tage"
            />
          </label>
          <button type="submit">Invite erstellen</button>
        </form>
        <div className="invite-list">
          {inviteCodes.map((invite) => (
            <article className="invite-row" key={invite.id}>
              <div>
                <strong>{invite.label}</strong>
                <code>{invite.code}</code>
                <span>
                  {invite.usedCount} / {invite.maxUses ?? "∞"} genutzt
                  {invite.expiresAt
                    ? ` · gültig bis ${new Date(invite.expiresAt).toLocaleString("de-DE")}`
                    : ""}
                  {invite.revokedAt ? " · deaktiviert" : ""}
                </span>
                <div className="form-grid">
                  <label>
                    Label
                    <input
                      value={inviteDrafts[invite.id]?.label ?? invite.label}
                      onChange={(event) =>
                        setInviteDrafts({
                          ...inviteDrafts,
                          [invite.id]: {
                            label: event.target.value,
                            maxUses:
                              inviteDrafts[invite.id]?.maxUses ??
                              (invite.maxUses === null ? "" : String(invite.maxUses)),
                            expiresAt:
                              inviteDrafts[invite.id]?.expiresAt ??
                              (invite.expiresAt ? toDatetimeLocal(invite.expiresAt) : "")
                          }
                        })
                      }
                    />
                  </label>
                  <label>
                    Max. Nutzungen (leer = ∞)
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={inviteDrafts[invite.id]?.maxUses ?? (invite.maxUses === null ? "" : String(invite.maxUses))}
                      onChange={(event) =>
                        setInviteDrafts({
                          ...inviteDrafts,
                          [invite.id]: {
                            label: inviteDrafts[invite.id]?.label ?? invite.label,
                            maxUses: event.target.value,
                            expiresAt:
                              inviteDrafts[invite.id]?.expiresAt ??
                              (invite.expiresAt ? toDatetimeLocal(invite.expiresAt) : "")
                          }
                        })
                      }
                    />
                  </label>
                  <label>
                    Gültig bis (leer = nie)
                    <input
                      type="datetime-local"
                      value={inviteDrafts[invite.id]?.expiresAt ?? (invite.expiresAt ? toDatetimeLocal(invite.expiresAt) : "")}
                      onChange={(event) =>
                        setInviteDrafts({
                          ...inviteDrafts,
                          [invite.id]: {
                            label: inviteDrafts[invite.id]?.label ?? invite.label,
                            maxUses:
                              inviteDrafts[invite.id]?.maxUses ??
                              (invite.maxUses === null ? "" : String(invite.maxUses)),
                            expiresAt: event.target.value
                          }
                        })
                      }
                    />
                  </label>
                </div>
              </div>
              <div className="device-actions">
                <button type="button" className="secondary" onClick={() => updateInviteCode(invite)}>
                  Speichern
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => deactivateInviteCode(invite)}
                  disabled={Boolean(invite.revokedAt)}
                >
                  Deaktivieren
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => reactivateInviteCode(invite)}
                  disabled={!invite.revokedAt}
                >
                  Reaktivieren
                </button>
                <button type="button" className="secondary danger" onClick={() => deleteUnusedInviteCode(invite)}>
                  Löschen
                </button>
              </div>
            </article>
          ))}
          {inviteCodes.length === 0 ? (
            <article className="invite-row">
              <strong>Noch keine Invite-Codes.</strong>
              <span>Neue Registrierungen brauchen einen aktiven Code.</span>
            </article>
          ) : null}
        </div>
      </section>

      <section className="audit-panel" aria-label="Audit-Log">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Audit</p>
            <h2>Letzte Aktionen.</h2>
          </div>
          <button type="button" className="secondary" onClick={() => loadAdminData()}>
            Aktualisieren
          </button>
        </div>
        <div className="audit-list">
          {auditLogs.map((entry) => (
            <article className="audit-row" key={entry.id}>
              <time dateTime={entry.createdAt}>
                {new Date(entry.createdAt).toLocaleString("de-DE")}
              </time>
              <strong>{entry.summary}</strong>
              <span>
                {[entry.action, entry.actorUsername ?? "System"].filter(Boolean).join(" | ")}
              </span>
            </article>
          ))}
          {auditLogs.length === 0 ? (
            <article className="audit-row">
              <strong>Noch keine Audit-Einträge.</strong>
              <span>Neue Aktionen erscheinen hier nach dem Speichern.</span>
            </article>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function PageHeader({ route, currentUser }: { route: Route; currentUser: User | null }) {
  return (
    <section className={`page-hero hero-${route.id}`} aria-labelledby={`${route.id}-title`}>
      <div className="hero-copy">
        <p className="eyebrow">{route.eyebrow}</p>
        <h1 id={`${route.id}-title`}>{route.title}</h1>
        <p>{route.description}</p>
      </div>
      <aside className="hero-status" aria-label="Status">
        <img src="/icon.svg" alt="" />
        <div>
          <span>Session</span>
          <strong>{currentUser ? currentUser.username : "Gast"}</strong>
        </div>
        <div>
          <span>Rolle</span>
          <strong>{currentUser?.role ?? "Login offen"}</strong>
        </div>
      </aside>
    </section>
  );
}

function LoginPage({
  currentUser,
  settings,
  onLoggedIn,
  onLoggedOut,
  onUserUpdated
}: {
  currentUser: User | null;
  settings: AppSettings;
  onLoggedIn: (user: User) => void;
  onLoggedOut: () => void;
  onUserUpdated: (user: User) => void;
}) {
  return (
    <section className="auth-layout" aria-label="Login Arbeitsbereich">
      <LoginPanel
        currentUser={currentUser}
        settings={settings}
        onLoggedIn={onLoggedIn}
        onLoggedOut={onLoggedOut}
        onUserUpdated={onUserUpdated}
      />
      <aside className="auth-visual" aria-label="Login Hinweise">
        <img src="/icon.svg" alt="" />
        <p className="eyebrow">Mailcode</p>
        <h2>Ein Login, mehrere Geräte.</h2>
        <p>
          Username eingeben, Code aus der E-Mail nutzen und Smartphone sowie PC parallel
          angemeldet lassen.
        </p>
        <dl className="signal-list">
          <div>
            <dt>Default</dt>
            <dd>Push aktiv</dd>
          </div>
          <div>
            <dt>Code</dt>
            <dd>6 Stellen</dd>
          </div>
        </dl>
      </aside>
    </section>
  );
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activePage, setActivePage] = useState<PageId>(() => getPageFromHash());
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultSettings);

  useEffect(() => {
    requestJson<{ user: User }>("/api/auth/me")
      .then((result) => {
        setCurrentUser(result.user);
        primeCsrfToken();
      })
      .catch(() => {
        clearCsrfToken();
        setCurrentUser(null);
      });
  }, []);

  useEffect(() => {
    requestJson<{ settings: AppSettings }>("/api/settings")
      .then((result) => {
        setAppSettings(result.settings);
        applyTheme(result.settings);
      })
      .catch(() => applyTheme(defaultSettings));
  }, []);

  useEffect(() => {
    function syncHash() {
      setActivePage(getPageFromHash());
    }

    window.addEventListener("hashchange", syncHash);
    syncHash();
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const activeRoute = routes.find((route) => route.id === activePage) ?? routes[0];
  const displayRoute =
    activePage === "login" && currentUser
      ? {
          ...activeRoute,
          label: "Profil",
          eyebrow: "Profil",
          title: "Profil und Geräte.",
          description:
            "Verwalte deine Anmeldung, Notifications und alle Geräte, die mit deinem Account aktiv sind."
        }
      : activeRoute;

  function renderActivePage() {
    if (activePage === "login") {
      return (
        <LoginPage
          currentUser={currentUser}
          settings={appSettings}
          onLoggedIn={setCurrentUser}
          onLoggedOut={() => setCurrentUser(null)}
          onUserUpdated={setCurrentUser}
        />
      );
    }

    if (activePage === "manager") {
      return <ManagerPage currentUser={currentUser} />;
    }

    if (activePage === "admin") {
      return (
        <section className="admin-stage" aria-label="Admin Arbeitsbereich">
          <AdminPanel
            currentUser={currentUser}
            onSettingsChanged={(settings) => {
              setAppSettings(settings);
              applyTheme(settings);
            }}
          />
        </section>
      );
    }

    return <EventBoard currentUser={currentUser} mode="events" />;
  }

  return (
    <main className={`app-shell page-${activePage}`}>
      <header className="topbar" aria-label="Hauptnavigation">
        <a className="brand" href="#events" aria-label="Hermes Start">
          <img className="brand-mark" src="/icon.svg" alt="" />
          <span>{appSettings.appName}</span>
        </a>
        <nav className="nav-links">
          {routes.map((route) => (
            <a
              href={route.path}
              key={route.path}
              className={activePage === route.id ? "active" : undefined}
              aria-current={activePage === route.id ? "page" : undefined}
            >
              {route.id === "login" && currentUser ? "Profil" : route.label}
            </a>
          ))}
        </nav>
      </header>
      <div className="page-shell">
        <PageHeader route={displayRoute} currentUser={currentUser} />
        {renderActivePage()}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
