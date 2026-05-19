import React, { FormEvent } from "react";
import type { ApiToken } from "../types/core";
import { useI18n } from "../i18n/I18nContext";

interface ApiTokensSectionProps {
  apiTokens: ApiToken[];
  apiTokenLabel: string;
  apiTokenScope: "full" | "read_only";
  newApiTokenPlaintext: string | null;
  busy: boolean;
  onLabelChange: (value: string) => void;
  onScopeChange: (value: "full" | "read_only") => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onRevoke: (tokenId: string) => void;
}

export function ApiTokensSection({
  apiTokens,
  apiTokenLabel,
  apiTokenScope,
  newApiTokenPlaintext,
  busy,
  onLabelChange,
  onScopeChange,
  onCreate,
  onRevoke
}: ApiTokensSectionProps) {
  const { t, locale } = useI18n();
  const dateLocale = locale === "en" ? "en-US" : "de-DE";

  return (
    <section className="device-panel" aria-label={t("loginProfile.apiTokensEyebrow")}>
      <div className="section-title-row">
        <div>
          <p className="eyebrow">{t("loginProfile.apiTokensEyebrow")}</p>
          <h3>{t("loginProfile.apiTokensTitle")}</h3>
          <p className="muted">{t("loginProfile.apiTokensHelp")}</p>
        </div>
      </div>

      <form onSubmit={onCreate} className="admin-form">
        <label>
          {t("loginProfile.apiTokenLabel")}
          <input
            value={apiTokenLabel}
            onChange={(event) => onLabelChange(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          {t("loginProfile.apiTokenScope")}
          <select
            value={apiTokenScope}
            onChange={(event) => onScopeChange(event.target.value as "full" | "read_only")}
          >
            <option value="full">{t("loginProfile.apiTokenScopeFull")}</option>
            <option value="read_only">{t("loginProfile.apiTokenScopeReadOnly")}</option>
          </select>
        </label>
        <button type="submit" disabled={busy}>
          {t("loginProfile.apiTokenCreate")}
        </button>
      </form>

      {newApiTokenPlaintext ? (
        <div className="access-panel compact" role="status">
          <p className="eyebrow">{t("loginProfile.apiTokenReveal")}</p>
          <pre className="api-token-reveal">{newApiTokenPlaintext}</pre>
          <p className="muted">{t("loginProfile.apiTokenCopyHint")}</p>
        </div>
      ) : null}

      {(apiTokens ?? []).length === 0 ? (
        <p className="muted">{t("loginProfile.apiTokenListEmpty")}</p>
      ) : (
        <ul className="account-list api-token-list">
          {(apiTokens ?? []).map((token) => (
            <li key={token.id}>
              <div>
                <strong>{token.label || token.id.slice(0, 8)}</strong>
                <span className="muted">
                  {" "}
                  ·{" "}
                  {token.scope === "full"
                    ? t("loginProfile.apiTokenScopeFull")
                    : t("loginProfile.apiTokenScopeReadOnly")}
                </span>
                <div className="muted small-meta">
                  {t("loginProfile.apiTokenCreated")}:{" "}
                  {new Date(token.createdAt).toLocaleString(dateLocale)}
                  {token.lastUsedAt
                    ? ` · ${t("loginProfile.apiTokenLastUsed")}: ${new Date(token.lastUsedAt).toLocaleString(dateLocale)}`
                    : null}
                </div>
              </div>
              <button
                type="button"
                className="secondary danger"
                disabled={busy}
                onClick={() => onRevoke(token.id)}
              >
                {t("loginProfile.apiTokenRevoke")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
