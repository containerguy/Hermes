import React, { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { QrCanvas } from "./QrCanvas";

interface DevicePairingSectionProps {
  pairingToken: string | null;
  pairingExpiresAt: string | null;
  redeemStatus: "idle" | "redeeming" | "done" | "error";
  busy: boolean;
  /** iPhone/iPad Safari: the home-screen app has its own storage and needs pairing. */
  showIosHomeScreenHint?: boolean;
  onMint: () => void;
  onClear: () => void;
}

export function DevicePairingSection({
  pairingToken,
  pairingExpiresAt,
  redeemStatus,
  busy,
  showIosHomeScreenHint = false,
  onMint,
  onClear
}: DevicePairingSectionProps) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [pairingToken]);

  async function copyPairLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  const dateLocale = locale === "en" ? "en-US" : "de-DE";

  return (
    <section className="device-panel" aria-label={t("loginProfile.pair.sectionAria")}>
      <div className="section-title-row">
        <div>
          <p className="eyebrow">{t("loginProfile.pairEyebrow")}</p>
          <h2>{t("loginProfile.pair.titleConnect")}</h2>
          <p className="muted">{t("loginProfile.pair.helpConnect")}</p>
          {showIosHomeScreenHint ? (
            <p className="notice">{t("loginProfile.pair.iosHomeScreenHint")}</p>
          ) : null}
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
                <button type="button" className="secondary" onClick={() => void copyPairLink(pairUrl)}>
                  {copied ? t("loginProfile.pair.copied") : t("loginProfile.pair.copy")}
                </button>
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
