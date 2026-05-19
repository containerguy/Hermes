import React from "react";
import type { AuditLogEntry } from "../types/core";
import { useI18n } from "../i18n/I18nContext";

interface AdminPanelAuditProps {
  auditLogs: AuditLogEntry[];
  dateTag: string;
  onRefresh: () => void;
}

export function AdminPanelAudit({ auditLogs, dateTag, onRefresh }: AdminPanelAuditProps) {
  const { t } = useI18n();

  return (
    <section id="admin-audit" className="audit-panel" aria-label={t("admin.audit.sectionAria")}>
      <div className="section-title-row">
        <div>
          <p className="eyebrow">{t("main.admin.nav.audit")}</p>
          <h2>{t("admin.audit.title")}</h2>
          <p className="muted">{t("admin.audit.intro")}</p>
        </div>
        <button type="button" className="secondary" onClick={onRefresh}>
          {t("loginProfile.devicesRefresh")}
        </button>
      </div>
      <div className="audit-list">
        {auditLogs.map((entry) => (
          <article className="audit-row" key={entry.id}>
            <time dateTime={entry.createdAt}>
              {new Date(entry.createdAt).toLocaleString(dateTag)}
            </time>
            <strong>{entry.summary}</strong>
            <span>
              {[entry.action, entry.actorUsername ?? t("admin.audit.actorSystem")]
                .filter(Boolean)
                .join(" | ")}
            </span>
          </article>
        ))}
        {auditLogs.length === 0 ? (
          <article className="audit-row">
            <strong>{t("admin.audit.empty")}</strong>
            <span>{t("admin.audit.emptyHint")}</span>
          </article>
        ) : null}
      </div>
    </section>
  );
}
