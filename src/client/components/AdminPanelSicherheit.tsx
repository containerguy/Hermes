import React, { FormEvent } from "react";
import type { RateLimitAllowlistEntry, RateLimitEntry } from "../types/core";
import { useI18n } from "../i18n/I18nContext";

interface AdminPanelSicherheitProps {
  activeRateLimits: RateLimitEntry[];
  rateLimitAllowlist: RateLimitAllowlistEntry[];
  allowlistDraft: { ipOrCidr: string; note: string };
  rateLimitBusy: boolean;
  dateTag: string;
  onAllowlistDraftChange: (draft: { ipOrCidr: string; note: string }) => void;
  onAddAllowlistEntry: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteAllowlistEntry: (entry: RateLimitAllowlistEntry) => void;
  onClearRateLimitEntry: (entry: RateLimitEntry) => void;
  onRefresh: () => void;
}

export function AdminPanelSicherheit({
  activeRateLimits,
  rateLimitAllowlist,
  allowlistDraft,
  rateLimitBusy,
  dateTag,
  onAllowlistDraftChange,
  onAddAllowlistEntry,
  onDeleteAllowlistEntry,
  onClearRateLimitEntry,
  onRefresh
}: AdminPanelSicherheitProps) {
  const { t } = useI18n();

  return (
    <section
      id="admin-sicherheit"
      className="rate-limit-panel"
      aria-label={t("admin.rate.sectionAria")}
    >
      <div className="section-title-row">
        <div>
          <p className="eyebrow">{t("admin.rate.eyebrow")}</p>
          <h2>{t("admin.rate.title")}</h2>
        </div>
        <button type="button" className="secondary" onClick={onRefresh} disabled={rateLimitBusy}>
          {t("loginProfile.devicesRefresh")}
        </button>
      </div>
      <p className="muted">{t("admin.rate.intro")}</p>

      <div className="device-list" aria-label={t("admin.rate.listAria")}>
        {activeRateLimits.map((entry) => (
          <article className="device-row" key={entry.id}>
            <div>
              <strong>{entry.scope}</strong>
              <span>
                {t("admin.rate.key")} {entry.key.slice(0, 10)}…
              </span>
              <span>
                {t("admin.rate.attempts")} {entry.attemptCount}
              </span>
              <time dateTime={entry.blockedUntil ?? undefined}>
                {t("admin.rate.blockedUntil")}{" "}
                {entry.blockedUntil ? new Date(entry.blockedUntil).toLocaleString(dateTag) : "—"}
              </time>
            </div>
            <div className="device-actions">
              <button
                type="button"
                className="secondary danger"
                onClick={() => onClearRateLimitEntry(entry)}
                disabled={rateLimitBusy}
              >
                {t("admin.rate.clearLock")}
              </button>
            </div>
          </article>
        ))}
        {activeRateLimits.length === 0 ? (
          <article className="device-row">
            <strong>{t("admin.rate.noneActive")}</strong>
            <span>{t("admin.rate.noneHint")}</span>
          </article>
        ) : null}
      </div>

      <form
        onSubmit={onAddAllowlistEntry}
        className="admin-form inline-form"
        aria-label={t("admin.rate.allowlistFormAria")}
      >
        <label>
          {t("admin.rate.allowlistIp")}
          <input
            value={allowlistDraft.ipOrCidr}
            onChange={(event) =>
              onAllowlistDraftChange({ ...allowlistDraft, ipOrCidr: event.target.value })
            }
            required
          />
        </label>
        <label>
          {t("admin.rate.allowlistNote")}
          <input
            value={allowlistDraft.note}
            onChange={(event) =>
              onAllowlistDraftChange({ ...allowlistDraft, note: event.target.value })
            }
            required
          />
        </label>
        <button type="submit" disabled={rateLimitBusy}>
          {t("admin.rate.allowlistSave")}
        </button>
      </form>

      <div className="device-list" aria-label={t("admin.rate.allowlistAria")}>
        {rateLimitAllowlist.map((entry) => (
          <article className="device-row" key={entry.id}>
            <div>
              <strong>{entry.ipOrCidr}</strong>
              <span>{entry.note ?? t("admin.rate.allowlistNoLabel")}</span>
              <time dateTime={entry.updatedAt}>
                {t("admin.rate.allowlistUpdated")}{" "}
                {new Date(entry.updatedAt).toLocaleString(dateTag)}
              </time>
            </div>
            <div className="device-actions">
              <button
                type="button"
                className="secondary danger"
                onClick={() => onDeleteAllowlistEntry(entry)}
                disabled={rateLimitBusy}
              >
                {t("admin.rate.allowlistRemove")}
              </button>
            </div>
          </article>
        ))}
        {rateLimitAllowlist.length === 0 ? (
          <article className="device-row">
            <strong>{t("admin.allowlist.empty")}</strong>
            <span>{t("admin.allowlist.emptyHint")}</span>
          </article>
        ) : null}
      </div>
    </section>
  );
}
