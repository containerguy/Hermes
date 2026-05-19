import React from "react";
import { useI18n } from "../i18n/I18nContext";
import { QrCanvas } from "./QrCanvas";

interface DevicePairingSectionProps {
  pairingToken: string | null;
  pairingExpiresAt: string | null;
  redeemStatus: "idle" | "redeeming" | "done" | "error";
  busy: boolean;
  onMint: () => void;
  onClear: () => void;
}

export function DevicePairingSection({
  pairingToken,
  pairingExpiresAt,
  redeemStatus,
  busy,
  onMint,
  onClear
}: DevicePairingSectionProps) {
  const { t, locale } = useI18n();
  const dateLocale = locale === "en" ? "en-US" : "de-DE";

  return (
    <section className="device-panel" aria-label={t("loginProfile.pair.sectionAria")}>
      <div className="section-title-row">
        <div>
          <p className="eyebrow">{t("loginProfile.pairEyebrow")}</p>
          <h2>{t("loginProfile.pair.titleConnect")}</h2>
          <p className="muted">{t("loginProfile.pair.helpConnect")}</p>
        </div>
        {pairingToken ? (
          <button type="button" className="secondary" onClick={onClear} disabled={busy}>
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
                <button type="button" onClick={onMint} disabled={busy}>
                  {t("loginProfile.pairNewCode")}
                </button>
              </div>
            </div>
          );
        })()
      ) : (
        <div className="action-row">
          <button type="button" onClick={onMint} disabled={busy}>
            {t("loginProfile.pairGenerate")}
          </button>
        </div>
      )}
      {redeemStatus === "done" ? <p className="notice">{t("login.msg.pairDone")}</p> : null}
    </section>
  );
}
