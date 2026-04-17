import React, { FormEvent, useEffect, useState } from "react";
import type { AppSettings, User, UserSession } from "../types/core";
import { requestJson } from "../api/request";
import { clearCsrfToken, primeCsrfToken } from "../api/csrf";
import { forgetDeviceKey, getDeviceContext } from "../api/device-key";
import { getErrorMessage } from "../errors/errors";
import {
  getSecureContextInfo,
  isLikelyIosSafari,
  isPwaDisplayMode
} from "../lib/runtime-context";
import { QrCanvas } from "./QrCanvas";

type BeforeInstallPromptChrome = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

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

export function LoginPanel({
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
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [redeemStatus, setRedeemStatus] = useState<
    "idle" | "redeeming" | "done" | "error"
  >("idle");
  const [deferredInstall, setDeferredInstall] = useState<BeforeInstallPromptChrome | null>(null);

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

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredInstall(event as BeforeInstallPromptChrome);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  async function runInstallPrompt() {
    if (!deferredInstall) {
      return;
    }
    try {
      await deferredInstall.prompt();
      await deferredInstall.userChoice;
    } catch {
      /* Abbruch oder nicht unterstützt */
    } finally {
      setDeferredInstall(null);
    }
  }

  useEffect(() => {
    const hash = window.location.hash || "";
    const queryStart = hash.indexOf("?");
    if (queryStart < 0) {
      return;
    }
    const params = new URLSearchParams(hash.slice(queryStart + 1));
    const pair = params.get("pair");
    if (!pair) {
      return;
    }

    setRedeemStatus("redeeming");
    const deviceContext = getDeviceContext();

    requestJson<{ user: User }>("/api/auth/pair-redeem", {
      method: "POST",
      body: JSON.stringify({
        token: pair,
        deviceKey: deviceContext.deviceKey,
        pwa: deviceContext.pwa
      })
    })
      .then((result) => {
        onLoggedIn(result.user);
        primeCsrfToken();
        setRedeemStatus("done");
        setMessage("Gerät erfolgreich verbunden.");
      })
      .catch((caught) => {
        setRedeemStatus("error");
        setError(getErrorMessage(caught));
      })
      .finally(() => {
        params.delete("pair");
        const baseHash = hash.slice(0, queryStart);
        const remaining = params.toString();
        const nextHash = remaining
          ? `${baseHash}?${remaining}`
          : baseHash || "#login";
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}${nextHash}`
        );
      });
  }, []);

  async function mintPairingToken() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await requestJson<{ token: string; expiresAt: string }>(
        "/api/auth/pair-token",
        { method: "POST" }
      );
      setPairingToken(result.token);
      setPairingExpiresAt(result.expiresAt);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function clearPairingToken() {
    setPairingToken(null);
    setPairingExpiresAt(null);
  }

  async function forgetDevice() {
    if (!currentUser) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const currentSession = sessions.find((session) => session.current);
      if (currentSession) {
        await requestJson<{ revokedCurrent: boolean }>(
          `/api/auth/sessions/${currentSession.id}`,
          { method: "DELETE" }
        );
      }
      forgetDeviceKey();
      clearCsrfToken();
      onLoggedOut();
      setStep("request");
      setMessage("Dieses Gerät wurde vergessen.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

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
      const deviceContext = getDeviceContext();
      const result = await requestJson<{ user: User }>("/api/auth/verify-code", {
        method: "POST",
        body: JSON.stringify({
          username,
          code,
          deviceName,
          deviceKey: deviceContext.deviceKey,
          pwa: deviceContext.pwa
        })
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
    const secureInfo = getSecureContextInfo();
    return (
      <section className="login-panel" id="login" aria-label="Aktuelle Anmeldung">
        <header className="login-panel-intro">
          <p className="eyebrow">Einstellungen</p>
          <h2>Profil und Benachrichtigungen</h2>
          <p className="muted">
            Zuerst bearbeitbare Daten und Push — danach Geräteliste und Pairing. Login, Rolle und
            E-Mail findest du unten in der Konto-Übersicht.
          </p>
        </header>

        <section className="device-panel" aria-label="Profil bearbeiten">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Profil</p>
              <h3>Profil und E-Mail aktuell halten.</h3>
              <p className="muted">
                Passe Anzeigename und Mailadresse hier an, damit Einmalcodes und Teilnehmerlisten
                auf allen Geräten konsistent bleiben.
              </p>
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
              <h2>Push vor dem Match testen.</h2>
            </div>
          </div>
          <div
            className={`runtime-callout runtime-callout--${secureInfo.isSecureContext ? "ok" : "warn"}`}
            role="status"
          >
            <p className="runtime-callout__title">{secureInfo.headline}</p>
            <p className="muted runtime-callout__body">{secureInfo.body}</p>
          </div>
          <div className="install-hint-card" aria-label="Installation als App">
            <p className="install-hint-card__eyebrow">Installation</p>
            <p className="install-hint-card__title">Hermes wie eine App nutzen</p>
            {isPwaDisplayMode() ? (
              <p className="muted install-hint-card__body">
                Diese Ansicht läuft als installierte Web-App. Push und Schnellzugriff sind meist
                komfortabler als im normalen Browser-Tab.
              </p>
            ) : deferredInstall ? (
              <>
                <p className="muted install-hint-card__body">
                  Dein Browser erlaubt eine Installation — empfohlen für stabilere Benachrichtigungen
                  und schnellen Zugriff vom Startbildschirm.
                </p>
                <button
                  type="button"
                  className="secondary install-app-button"
                  onClick={() => void runInstallPrompt()}
                  disabled={busy}
                >
                  App installieren
                </button>
              </>
            ) : isLikelyIosSafari() ? (
              <ol className="install-steps">
                <li>
                  Safari: <strong>Teilen</strong> (Quadrat mit Pfeil) öffnen.
                </li>
                <li>
                  <strong>Zum Home-Bildschirm</strong> wählen — Hermes startet dann wie eine App.
                </li>
              </ol>
            ) : (
              <ol className="install-steps">
                               <li>
                  Chrome / Edge: <strong>Drei-Punkte-Menü</strong> oder Install-Symbol in der
                  Adresszeile.
                </li>
                <li>
                  <strong>App installieren</strong> wählen. Fehlt der Eintrag, unterstützt der Browser
                  die Installation nicht oder Hermes ist bereits installiert.
                </li>
              </ol>
            )}
          </div>
          <p className="muted">
            Hermes sendet <strong>Standard-Browser-Benachrichtigungen</strong>. Klingeltöne und
            garantiertes Audio kann Hermes nicht erzwingen.
          </p>
          <p className="muted">
            Wenn einer der Checks unten fehlt, bleiben Einladungen und Statuswechsel in Hermes
            sichtbar, aber dieses Gerät bekommt keine Push-Hinweise.
          </p>
          <dl className="account-list">
            <div>
              <dt>Sicherer Kontext</dt>
              <dd>{secureInfo.isSecureContext ? "erfüllt" : "nicht erfüllt"}</dd>
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
        <section className="device-panel" aria-label="Angemeldete Geräte">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Geräte</p>
              <h2>Angemeldete Geräte im Blick behalten.</h2>
              <p className="muted">
                Benenne Sessions sinnvoll um, entferne alte Geräte und prüfe bei Bedarf, wo dein
                Konto zuletzt aktiv war.
              </p>
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
                  {session.current ? (
                    <button
                      type="button"
                      className="secondary"
                      onClick={forgetDevice}
                      disabled={busy}
                    >
                      Dieses Gerät vergessen
                    </button>
                  ) : null}
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
        <section className="device-panel" aria-label="Gerät hinzufügen">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Pairing</p>
              <h2>Weiteres Gerät verbinden.</h2>
              <p className="muted">
                Erzeuge einen kurzlebigen Pairing-Link, um Hermes auf Smartphone, Tablet oder
                Zweit-PC ohne erneutes Tippen des Einmalcodes zu öffnen.
              </p>
            </div>
            {pairingToken ? (
              <button
                type="button"
                className="secondary"
                onClick={clearPairingToken}
                disabled={busy}
              >
                Schließen
              </button>
            ) : null}
          </div>
          {pairingToken ? (
            (() => {
              const pairUrl = `${window.location.origin}${window.location.pathname}#login?pair=${pairingToken}`;
              return (
                <div className="pair-token-panel">
                  <QrCanvas
                    payload={pairUrl}
                    pixelSize={256}
                    label="Pairing QR-Code"
                  />
                  <a
                    href={pairUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pair-link"
                  >
                    {pairUrl}
                  </a>
                  {pairingExpiresAt ? (
                    <time dateTime={pairingExpiresAt} className="pair-expires">
                      Gültig bis {new Date(pairingExpiresAt).toLocaleString("de-DE")}
                    </time>
                  ) : null}
                  <div className="action-row">
                    <button
                      type="button"
                      onClick={mintPairingToken}
                      disabled={busy}
                    >
                      Neuen Code erzeugen
                    </button>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="action-row">
              <button type="button" onClick={mintPairingToken} disabled={busy}>
                Pairing-Code erzeugen
              </button>
            </div>
          )}
          {redeemStatus === "done" ? (
            <p className="notice">Gerät erfolgreich verbunden.</p>
          ) : null}
        </section>
        <section className="device-panel account-summary-panel" aria-label="Konto-Übersicht">
          <p className="eyebrow">Konto</p>
          <h3>Angemeldet als {currentUser.displayName || currentUser.username}</h3>
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
        </section>
        <button type="button" className="secondary" onClick={logout} disabled={busy}>
          Logout
        </button>
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
      <p className="muted">
        {mode === "register"
          ? "Lege dein Konto mit Invite-Code, Username und E-Mail an. Danach bekommst du direkt einen Einmalcode für den ersten Login."
          : step === "request"
            ? "Gib deinen Username ein. Hermes schickt den Einmalcode an die hinterlegte E-Mail-Adresse."
            : "Trage den Code aus der Mail ein und gib diesem Gerät optional einen Namen für die Geräteübersicht."}
      </p>
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
              onChange={(event) =>
                setRegistration({ ...registration, username: event.target.value })
              }
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

