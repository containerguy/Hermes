import React from "react";
import type { UserSession } from "../types/core";
import { useI18n } from "../i18n/I18nContext";

interface SessionsSectionProps {
  sessions: UserSession[];
  sessionNames: Record<string, string>;
  busy: boolean;
  onSessionNamesChange: (next: Record<string, string>) => void;
  onRefresh: () => void;
  onRename: (sessionId: string) => void;
  onRevoke: (sessionId: string) => void;
  onForgetDevice: () => void;
}

export function SessionsSection({
  sessions,
  sessionNames,
  busy,
  onSessionNamesChange,
  onRefresh,
  onRename,
  onRevoke,
  onForgetDevice
}: SessionsSectionProps) {
  const { t, locale } = useI18n();
  const dateLocale = locale === "en" ? "en-US" : "de-DE";

  return (
    <section className="device-panel" aria-label={t("loginProfile.devicesEyebrow")}>
      <div className="section-title-row">
        <div>
          <p className="eyebrow">{t("loginProfile.devicesEyebrow")}</p>
          <h2>{t("loginProfile.devicesTitle")}</h2>
          <p className="muted">{t("loginProfile.devicesHelp")}</p>
        </div>
        <button type="button" className="secondary" onClick={onRefresh} disabled={busy}>
          {t("loginProfile.devicesRefresh")}
        </button>
      </div>
      <div className="device-list">
        {sessions.map((session) => (
          <article className="device-row" key={session.id}>
            <div>
              <strong>
                {session.current
                  ? t("loginProfile.device.current")
                  : t("loginProfile.device.generic")}
              </strong>
              <label>
                {t("loginProfile.device.nameField")}
                <input
                  value={sessionNames[session.id] ?? session.deviceName ?? ""}
                  onChange={(event) =>
                    onSessionNamesChange({ ...sessionNames, [session.id]: event.target.value })
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
                onClick={() => onRename(session.id)}
                disabled={busy}
              >
                {t("loginProfile.device.saveName")}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => onRevoke(session.id)}
                disabled={busy}
              >
                {t("loginProfile.device.signOut")}
              </button>
              {session.current ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={onForgetDevice}
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
  );
}
