import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AuditLogEntry } from "../types/core";
import { useI18n } from "../i18n/I18nContext";
import { requestJson } from "../api/request";

export const AUDIT_PAGE_SIZE = 50;
const SYSTEM_ACTOR = "__system";

type AuditResponse = {
  auditLogs: AuditLogEntry[];
  total?: number;
  actions?: string[];
  actors?: string[];
};

interface AdminPanelAuditProps {
  dateTag: string;
  onError?: (message: string) => void;
}

/**
 * Audit-Log als Tabelle: Suche, Filter nach Aktion und Benutzer, Seiten zu je 50 Einträgen.
 * Lädt selbst vom Server, damit auch große Logs nicht komplett übertragen werden.
 */
export function AdminPanelAudit({ dateTag, onError }: AdminPanelAuditProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Suche erst nach kurzer Tipp-Pause an den Server schicken.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppliedQuery(query.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(AUDIT_PAGE_SIZE), offset: String(page * AUDIT_PAGE_SIZE) });
    if (appliedQuery) params.set("q", appliedQuery);
    if (action) params.set("action", action);
    if (actor) params.set("actor", actor);
    setLoading(true);
    try {
      setData(await requestJson<AuditResponse>(`/api/admin/audit-log?${params.toString()}`));
    } catch (error) {
      onErrorRef.current?.(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [appliedQuery, action, actor, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const entries = data?.auditLogs ?? [];
  const total = data?.total ?? entries.length;
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const filtersActive = Boolean(appliedQuery || action || actor);
  const actions = withSelected(data?.actions ?? [], action);
  const actors = withSelected(data?.actors ?? [], actor === SYSTEM_ACTOR ? "" : actor);

  function resetFilters() {
    setQuery("");
    setAppliedQuery("");
    setAction("");
    setActor("");
    setPage(0);
  }

  return (
    <section id="admin-audit" className="audit-panel" aria-label={t("admin.audit.sectionAria")}>
      <div className="section-title-row">
        <div>
          <p className="eyebrow">{t("main.admin.nav.audit")}</p>
          <h2>{t("admin.audit.title")}</h2>
          <p className="muted">{t("admin.audit.intro")}</p>
        </div>
        <button type="button" className="secondary" onClick={() => void load()} disabled={loading}>
          {t("loginProfile.devicesRefresh")}
        </button>
      </div>

      <div className="data-toolbar">
        <input
          type="search"
          className="data-toolbar__search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("admin.audit.searchPlaceholder")}
          aria-label={t("admin.audit.searchAria")}
        />
        <select
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            setPage(0);
          }}
          aria-label={t("admin.audit.actionFilterAria")}
        >
          <option value="">{t("admin.audit.allActions")}</option>
          {actions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={actor}
          onChange={(event) => {
            setActor(event.target.value);
            setPage(0);
          }}
          aria-label={t("admin.audit.actorFilterAria")}
        >
          <option value="">{t("admin.audit.allActors")}</option>
          <option value={SYSTEM_ACTOR}>{t("admin.audit.actorSystem")}</option>
          {actors.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <p className="data-toolbar__count" aria-live="polite">
          {t(filtersActive ? "admin.audit.countFiltered" : "admin.audit.count", { total })}
          {filtersActive ? (
            <button type="button" className="link-button" onClick={resetFilters}>
              {t("admin.userTable.reset")}
            </button>
          ) : null}
        </p>
      </div>

      {entries.length === 0 && !loading ? (
        filtersActive ? (
          <p className="empty-state">{t("admin.audit.emptyFiltered")}</p>
        ) : (
          <div className="empty-state">
            <strong>{t("admin.audit.empty")}</strong>
            <span>{t("admin.audit.emptyHint")}</span>
          </div>
        )
      ) : (
        <div className="data-table__scroll audit-list">
          <table className="data-table audit-table">
            <thead>
              <tr>
                <th scope="col">{t("admin.audit.colSummary")}</th>
                <th scope="col">{t("admin.audit.colTime")}</th>
                <th scope="col">{t("admin.audit.colActor")}</th>
                <th scope="col">{t("admin.audit.colAction")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="data-table__primary">
                    <strong>{entry.summary}</strong>
                    {entry.metadata ? (
                      <details className="audit-table__details">
                        <summary>{t("admin.audit.details")}</summary>
                        <pre>{JSON.stringify(entry.metadata, null, 2)}</pre>
                      </details>
                    ) : null}
                  </td>
                  <td data-label={t("admin.audit.colTime")} className="audit-table__time">
                    <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString(dateTag)}</time>
                  </td>
                  <td data-label={t("admin.audit.colActor")}>
                    {entry.actorUsername ?? <span className="muted">{t("admin.audit.actorSystem")}</span>}
                  </td>
                  <td data-label={t("admin.audit.colAction")}>
                    <code className="audit-table__action">{entry.action}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 ? (
        <nav className="data-pager" aria-label={t("admin.audit.pagerAria")}>
          <button type="button" className="secondary" onClick={() => setPage(page - 1)} disabled={page === 0 || loading}>
            {t("admin.audit.prev")}
          </button>
          <span>{t("admin.audit.pageOf", { page: page + 1, pages: pageCount })}</span>
          <button
            type="button"
            className="secondary"
            onClick={() => setPage(page + 1)}
            disabled={page + 1 >= pageCount || loading}
          >
            {t("admin.audit.next")}
          </button>
        </nav>
      ) : null}
    </section>
  );
}

/** Ein gewählter Filterwert bleibt in der Liste, auch wenn der Server ihn (noch) nicht liefert. */
function withSelected(values: string[], selected: string) {
  return selected && !values.includes(selected) ? [selected, ...values] : values;
}
