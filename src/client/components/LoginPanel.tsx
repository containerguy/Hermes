import React, { FormEvent, useEffect, useState } from "react";
import type { AppSettings, User, UserSession } from "../types/core";
import { requestJson } from "../api/request";
import { clearCsrfToken, primeCsrfToken } from "../api/csrf";
import { forgetDeviceKey, getDeviceContext } from "../api/device-key";
import { getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/catalog/index";
import {
  getSecureContextInfo,
  isLikelyIosSafari,
  isPwaDisplayMode
} from "../lib/runtime-context";
import { browserLanguageToLocale } from "../../shared/locale";
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
  const { t, locale } = useI18n();
  const [username, setUsername] = useState("");
  const [registration, setRegistration] = useState({ inviteCode: "", username: "", email: "" });
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [step, setStep] = useState<"request" | "verify">("request");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [sessionNames, setSessionNames] = useState<Record<string, string>>({});
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [localeDraft, setLocaleDraft] = useState<"" | "de" | "en">("");
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
        result.sessions.map((session) => [session.id, session.deviceName || t("loginProfile.unnamedDevice")])
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
      setLocaleDraft("");
      return;
    }

    setDisplayNameDraft(currentUser.displayName || currentUser.username);
    setEmailDraft(currentUser.email);
    setLocaleDraft(currentUser.locale === "de" || currentUser.locale === "en" ? currentUser.locale : "");
  }, [currentUser?.id, currentUser?.displayName, currentUser?.email, currentUser?.username, currentUser?.locale]);

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
        setMessage(t("login.msg.pairDone"));
      })
      .catch((caught) => {
        setRedeemStatus("error");
        setError(getErrorMessage(caught, locale));
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
      setError(getErrorMessage(caught, locale));
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
      setMessage(t("login.msg.deviceForgotten"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
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
      setMessage(t("login.msg.loginCodeSent"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
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
      setMessage(t("login.msg.loggedIn"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
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
        body: JSON.stringify({
          ...registration,
          locale: browserLanguageToLocale(navigator.language, settings.defaultLocale)
        })
      });
      setUsername(registration.username);
      setMode("login");
      setStep("verify");
      setMessage(t("login.msg.registered"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
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
    setMessage(t("login.msg.loggedOut"));
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
        setMessage(t("login.msg.deviceRevokedSelf"));
        return;
      }

      await loadSessions();
      setMessage(t("login.msg.deviceRevoked"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
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
        body: JSON.stringify({
          displayName: displayNameDraft,
          locale: localeDraft === "" ? null : localeDraft
        })
      });
      onUserUpdated(result.user);
      setMessage(t("login.msg.profileSaved"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
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
      setMessage(t("login.msg.emailCodeSent"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
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
      setMessage(t("login.msg.emailConfirmedRelogin"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
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
      setMessage(t("login.msg.deviceNameSaved"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
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
      setMessage(t("login.msg.notificationsActive"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
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
      setMessage(t("login.msg.notificationsOff"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  if (currentUser) {
    const pushSupport = getPushSupport();
    const secureInfo = getSecureContextInfo(window, locale);
    const dateLocale = locale === "en" ? "en-US" : "de-DE";
    return (
      <section className="login-panel" id="login" aria-label={t("loginProfile.sectionAria")}>
        <header className="login-panel-intro">
          <p className="eyebrow">{t("loginProfile.introEyebrow")}</p>
          <h2>{t("loginProfile.introTitle")}</h2>
          <p className="muted">{t("loginProfile.introBody")}</p>
        </header>

        <section className="device-panel" aria-label={t("loginProfile.profileSectionAria")}>
          <div className="section-title-row">
            <div>
              <p className="eyebrow">{t("loginProfile.profileEyebrow")}</p>
              <h3>{t("loginProfile.profileTitle")}</h3>
              <p className="muted">{t("loginProfile.profileHelp")}</p>
            </div>
          </div>

          <form onSubmit={updateProfile} className="admin-form">
            <label>
              {t("loginProfile.displayName")}
              <input
                value={displayNameDraft}
                onChange={(event) => setDisplayNameDraft(event.target.value)}
                required
              />
            </label>
            <label>
              {t("loginProfile.localeLabel")}
              <select
                value={localeDraft}
                onChange={(event) => setLocaleDraft(event.target.value as "" | "de" | "en")}
              >
                <option value="">{t("loginProfile.localeAuto")}</option>
                <option value="de">{t("loginProfile.locale.de")}</option>
                <option value="en">{t("loginProfile.locale.en")}</option>
              </select>
            </label>
            <p className="muted">{t("loginProfile.localeHelp")}</p>
            <button type="submit" disabled={busy}>
              {t("loginProfile.saveProfile")}
            </button>
          </form>

          <form onSubmit={requestEmailChange} className="admin-form">
            <label>
              {t("loginProfile.newEmail")}
              <input
                type="email"
                value={emailDraft}
                onChange={(event) => setEmailDraft(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={busy}>
              {t("loginProfile.sendEmailCode")}
            </button>
          </form>

          <form onSubmit={verifyEmailChange} className="admin-form">
            <label>
              {t("loginProfile.emailCode")}
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
              {t("loginProfile.confirmEmail")}
            </button>
          </form>
        </section>

        {message ? <p className="notice">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <section className="device-panel" aria-label={t("loginProfile.notificationsEyebrow")}>
          <div className="section-title-row">
            <div>
              <p className="eyebrow">{t("loginProfile.notificationsEyebrow")}</p>
              <h2>{t("loginProfile.notificationsTitle")}</h2>
            </div>
          </div>
          <div
            className={`runtime-callout runtime-callout--${secureInfo.isSecureContext ? "ok" : "warn"}`}
            role="status"
          >
            <p className="runtime-callout__title">{secureInfo.headline}</p>
            <p className="muted runtime-callout__body">{secureInfo.body}</p>
          </div>
          <div className="install-hint-card" aria-label={t("loginProfile.installEyebrow")}>
            <p className="install-hint-card__eyebrow">{t("loginProfile.installEyebrow")}</p>
            <p className="install-hint-card__title">{t("loginProfile.installTitle")}</p>
            {isPwaDisplayMode() ? (
              <p className="muted install-hint-card__body">{t("loginProfile.installPwaBody")}</p>
            ) : deferredInstall ? (
              <>
                <p className="muted install-hint-card__body">{t("loginProfile.installDeferredBody")}</p>
                <button
                  type="button"
                  className="secondary install-app-button"
                  onClick={() => void runInstallPrompt()}
                  disabled={busy}
                >
                  {t("loginProfile.installButton")}
                </button>
              </>
            ) : isLikelyIosSafari() ? (
              <ol className="install-steps">
                <li>{t("loginProfile.iosStep1")}</li>
                <li>{t("loginProfile.iosStep2")}</li>
              </ol>
            ) : (
              <ol className="install-steps">
                <li>{t("loginProfile.chromeStep1")}</li>
                <li>{t("loginProfile.chromeStep2")}</li>
              </ol>
            )}
          </div>
          <p className="muted">{t("loginProfile.pushExplain1")}</p>
          <p className="muted">{t("loginProfile.pushExplain2")}</p>
          <dl className="account-list">
            <div>
              <dt>{t("loginProfile.dt.secureContext")}</dt>
              <dd>
                {secureInfo.isSecureContext ? t("loginProfile.secure.ok") : t("loginProfile.secure.missing")}
              </dd>
            </div>
            <div>
              <dt>{t("loginProfile.dt.browserApis")}</dt>
              <dd>
                {pushSupport.hasApis ? "ok" : t("loginProfile.push.missingApis")}
              </dd>
            </div>
            <div>
              <dt>{t("loginProfile.dt.permission")}</dt>
              <dd>
                {pushSupport.permission === "unsupported"
                  ? t("loginProfile.perm.unavailable")
                  : pushSupport.permission === "default"
                    ? t("loginProfile.perm.default")
                    : pushSupport.permission}
              </dd>
            </div>
          </dl>
        </section>
        <div className="action-row">
          <button type="button" onClick={enableNotifications} disabled={busy}>
            {t("loginProfile.notifyOn")}
          </button>
          <button type="button" className="secondary" onClick={disableNotifications} disabled={busy}>
            {t("loginProfile.notifyOff")}
          </button>
        </div>
        <section className="device-panel" aria-label={t("loginProfile.devicesEyebrow")}>
          <div className="section-title-row">
            <div>
              <p className="eyebrow">{t("loginProfile.devicesEyebrow")}</p>
              <h2>{t("loginProfile.devicesTitle")}</h2>
              <p className="muted">{t("loginProfile.devicesHelp")}</p>
            </div>
            <button type="button" className="secondary" onClick={() => loadSessions()} disabled={busy}>
              {t("loginProfile.devicesRefresh")}
            </button>
          </div>
          <div className="device-list">
            {sessions.map((session) => (
              <article className="device-row" key={session.id}>
                <div>
                  <strong>
                    {session.current ? t("loginProfile.device.current") : t("loginProfile.device.generic")}
                  </strong>
                  <label>
                    {t("loginProfile.device.nameField")}
                    <input
                      value={sessionNames[session.id] ?? session.deviceName ?? ""}
                      onChange={(event) =>
                        setSessionNames({ ...sessionNames, [session.id]: event.target.value })
                      }
                      disabled={busy}
                      required
                    />
                  </label>
                  <span>{session.userAgent || t("loginProfile.device.noUa")}</span>
                  <time dateTime={session.lastSeenAt}>
                    {t("loginProfile.device.lastActive")}{" "}
                    {new Date(session.lastSeenAt).toLocaleString(dateLocale)}
                  </time>
                </div>
                <div className="device-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => renameSession(session.id)}
                    disabled={busy}
                  >
                    {t("loginProfile.device.saveName")}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => revokeSession(session.id)}
                    disabled={busy}
                  >
                    {t("loginProfile.device.signOut")}
                  </button>
                  {session.current ? (
                    <button
                      type="button"
                      className="secondary"
                      onClick={forgetDevice}
                      disabled={busy}
                    >
                      {t("loginProfile.device.forget")}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
            {sessions.length === 0 ? (
              <article className="device-row">
                <strong>{t("loginProfile.devicesEmptyTitle")}</strong>
                <span>{t("loginProfile.devicesEmptyHint")}</span>
              </article>
            ) : null}
          </div>
        </section>
        <section className="device-panel" aria-label={t("loginProfile.pair.sectionAria")}>
          <div className="section-title-row">
            <div>
              <p className="eyebrow">{t("loginProfile.pairEyebrow")}</p>
              <h2>{t("loginProfile.pair.titleConnect")}</h2>
              <p className="muted">{t("loginProfile.pair.helpConnect")}</p>
            </div>
            {pairingToken ? (
              <button
                type="button"
                className="secondary"
                onClick={clearPairingToken}
                disabled={busy}
              >
                {t("loginProfile.pair.close")}
              </button>
            ) : null}
          </div>
          {pairingToken ? (
            (() => {
              const pairUrl = `${window.location.origin}${window.location.pathname}#login?pair=${pairingToken}`;
              return (
                <div className="pair-token-panel">
                  <QrCanvas payload={pairUrl} pixelSize={256} label={t("loginProfile.pair.qrLabel")} />
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
                      {t("loginProfile.pair.validUntil")}{" "}
                      {new Date(pairingExpiresAt).toLocaleString(dateLocale)}
                    </time>
                  ) : null}
                  <div className="action-row">
                    <button type="button" onClick={mintPairingToken} disabled={busy}>
                      {t("loginProfile.pairNewCode")}
                    </button>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="action-row">
              <button type="button" onClick={mintPairingToken} disabled={busy}>
                {t("loginProfile.pairGenerate")}
              </button>
            </div>
          )}
          {redeemStatus === "done" ? <p className="notice">{t("login.msg.pairDone")}</p> : null}
        </section>
        <section className="device-panel account-summary-panel" aria-label={t("loginProfile.accountEyebrow")}>
          <p className="eyebrow">{t("loginProfile.accountEyebrow")}</p>
          <h3>
            {t("loginProfile.accountTitle", {
              name: currentUser.displayName || currentUser.username
            })}
          </h3>
          <dl className="account-list">
            <div>
              <dt>{t("loginProfile.account.login")}</dt>
              <dd>{currentUser.username}</dd>
            </div>
            <div>
              <dt>{t("loginProfile.account.role")}</dt>
              <dd>{t(`admin.role.${currentUser.role}` as MessageKey)}</dd>
            </div>
            <div>
              <dt>{t("loginProfile.account.email")}</dt>
              <dd>{currentUser.email}</dd>
            </div>
          </dl>
        </section>
        <button type="button" className="secondary" onClick={logout} disabled={busy}>
          {t("loginProfile.logout")}
        </button>
      </section>
    );
  }

  return (
    <section className="login-panel" id="login" aria-label={t("main.nav.login")}>
      <p className="eyebrow">{mode === "register" ? t("login.mode.register") : t("login.mode.login")}</p>
      <h2>
        {mode === "register"
          ? t("login.title.register")
          : step === "request"
            ? t("login.title.request")
            : t("login.title.verify")}
      </h2>
      <p className="muted">
        {mode === "register"
          ? t("login.help.register")
          : step === "request"
            ? t("login.help.request")
            : t("login.help.verify")}
      </p>
      {mode === "register" ? (
        <form onSubmit={registerUser}>
          <label>
            {t("login.field.invite")}
            <input
              value={registration.inviteCode}
              onChange={(event) =>
                setRegistration({ ...registration, inviteCode: event.target.value })
              }
              required
            />
          </label>
          <label>
            {t("login.field.username")}
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
            {t("login.field.email")}
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
              {t("login.backToLogin")}
            </button>
            <button type="submit" disabled={busy}>
              {t("login.register.submit")}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={step === "request" ? requestCode : verifyCode}>
          <label>
            {t("login.field.username")}
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
                {t("login.field.code")}
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
                {t("login.field.deviceName")}
                <input
                  placeholder={t("login.deviceName.placeholder")}
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
                {t("login.back")}
              </button>
            ) : null}
            <button type="submit" disabled={busy}>
              {step === "request" ? t("login.sendCode") : t("login.signIn")}
            </button>
          </div>
          {settings.publicRegistrationEnabled ? (
            <button type="button" className="secondary" onClick={() => setMode("register")}>
              {t("login.register.cta")}
            </button>
          ) : null}
        </form>
      )}
    </section>
  );
}

