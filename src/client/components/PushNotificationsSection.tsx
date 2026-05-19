import React from "react";
import { useI18n } from "../i18n/I18nContext";
import { getSecureContextInfo, isLikelyIosSafari, isPwaDisplayMode } from "../lib/runtime-context";
import { getPushSupport } from "../lib/push-support";

type BeforeInstallPromptChrome = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

interface PushNotificationsSectionProps {
  deferredInstall: BeforeInstallPromptChrome | null;
  busy: boolean;
  onRunInstallPrompt: () => void;
  onEnable: () => void;
  onDisable: () => void;
}

export function PushNotificationsSection({
  deferredInstall,
  busy,
  onRunInstallPrompt,
  onEnable,
  onDisable
}: PushNotificationsSectionProps) {
  const { t, locale } = useI18n();
  const pushSupport = getPushSupport();
  const secureInfo = getSecureContextInfo(window, locale);

  return (
    <>
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
              <p className="muted install-hint-card__body">
                {t("loginProfile.installDeferredBody")}
              </p>
              <button
                type="button"
                className="secondary install-app-button"
                onClick={onRunInstallPrompt}
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
              {secureInfo.isSecureContext
                ? t("loginProfile.secure.ok")
                : t("loginProfile.secure.missing")}
            </dd>
          </div>
          <div>
            <dt>{t("loginProfile.dt.browserApis")}</dt>
            <dd>{pushSupport.hasApis ? "ok" : t("loginProfile.push.missingApis")}</dd>
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
        <button type="button" onClick={onEnable} disabled={busy}>
          {t("loginProfile.notifyOn")}
        </button>
        <button type="button" className="secondary" onClick={onDisable} disabled={busy}>
          {t("loginProfile.notifyOff")}
        </button>
      </div>
    </>
  );
}
