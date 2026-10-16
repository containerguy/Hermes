import React, { FormEvent, RefObject } from "react";
import type {
  AppSettings,
  RestoreDiagnostics,
  RestoreRecovery,
  StorageInfo
} from "../types/core";
import { useI18n } from "../i18n/I18nContext";
import { PizzaMenuJsonAdmin } from "../pizza/PizzaMenuJsonAdmin";
import { BindingsAdmin } from "../gameservers/BindingsAdmin";

function generateKioskStreamSecret(): string {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface AdminPanelBetriebProps {
  settings: AppSettings;
  gameCatalogDraft: string;
  storage: StorageInfo | null;
  restoreDiagnostics: RestoreDiagnostics | null;
  restoreRecovery: RestoreRecovery | null;
  opsBusy: boolean;
  dateTag: string;
  settingsImportRef: RefObject<HTMLInputElement | null>;
  onSettingsChange: (next: AppSettings) => void;
  onGameCatalogDraftChange: (next: string) => void;
  onSaveSettings: (event: FormEvent<HTMLFormElement>) => void;
  onMessage: (message: string) => void;
  onError: (error: string) => void;
  onDownloadJsonAttachment: (path: string, fallbackName: string) => void;
  onRunSettingsImport: (file: File) => void;
  onRunBackup: () => void;
  onRunRestore: () => void;
}

export function AdminPanelBetrieb({
  settings,
  gameCatalogDraft,
  storage,
  restoreDiagnostics,
  restoreRecovery,
  opsBusy,
  dateTag,
  settingsImportRef,
  onSettingsChange,
  onGameCatalogDraftChange,
  onSaveSettings,
  onMessage,
  onError,
  onDownloadJsonAttachment,
  onRunSettingsImport,
  onRunBackup,
  onRunRestore
}: AdminPanelBetriebProps) {
  const { t } = useI18n();

  async function copyKioskUrl() {
    const path = settings.kioskStreamPath.trim().replace(/^\/+|\/+$/g, "") || "stream";
    const origin = window.location.origin;
    const url = `${origin}/${path}?id=${encodeURIComponent(settings.kioskStreamSecret)}`;
    try {
      await navigator.clipboard.writeText(url);
      onMessage(t("admin.kiosk.copied"));
      onError("");
    } catch {
      onError(t("admin.kiosk.copyFailed"));
    }
  }

  return (
    <>
      <header className="admin-section-head">
        <p className="eyebrow">{t("main.admin.nav.ops")}</p>
        <h2>{t("admin.betrieb.title")}</h2>
      </header>
      <form id="admin-betrieb" onSubmit={onSaveSettings} className="admin-form">
        <label>
          {t("admin.label.appName")}
          <input
            value={settings.appName}
            onChange={(event) => onSettingsChange({ ...settings, appName: event.target.value })}
            maxLength={80}
            placeholder={t("brand.displayName")}
          />
        </label>
        <p className="muted">{t("admin.help.appName")}</p>
        <label>
          {t("admin.label.brandMark")}
          <select
            value={settings.brandMark}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                brandMark: event.target.value as AppSettings["brandMark"]
              })
            }
          >
            <option value="mitspiel">{t("admin.brandMark.mitspiel")}</option>
            <option value="hermes">{t("admin.brandMark.hermes")}</option>
          </select>
        </label>
        <p className="muted">{t("admin.help.brandMark")}</p>
        <label>
          {t("admin.label.archiveHours")}
          <input
            type="number"
            min={1}
            max={72}
            value={settings.eventAutoArchiveHours}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                eventAutoArchiveHours: Number(event.target.value)
              })
            }
            required
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.defaultNotificationsEnabled}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                defaultNotificationsEnabled: event.target.checked
              })
            }
          />
          {t("admin.label.notifyDefault")}
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.publicRegistrationEnabled}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                publicRegistrationEnabled: event.target.checked
              })
            }
          />
          {t("admin.label.publicReg")}
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.s3SnapshotEnabled}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                s3SnapshotEnabled: event.target.checked
              })
            }
          />
          {t("admin.label.s3snap")}
        </label>
        <p className="muted">{t("admin.help.s3snap")}</p>
        <label>
          {t("admin.projectTemplate.label")}
          <select
            value={settings.projectTemplate}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                projectTemplate: event.target.value as AppSettings["projectTemplate"]
              })
            }
          >
            <option value="lan_party">{t("admin.projectTemplate.lan_party")}</option>
            <option value="table_tennis">{t("admin.projectTemplate.table_tennis")}</option>
          </select>
        </label>
        <p className="muted">{t("admin.projectTemplate.help")}</p>
        <label>
          {t("admin.label.defaultLocale")}
          <select
            value={settings.defaultLocale}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                defaultLocale: event.target.value as AppSettings["defaultLocale"]
              })
            }
          >
            <option value="de">{t("admin.locale.de")}</option>
            <option value="en">{t("admin.locale.en")}</option>
          </select>
        </label>
        <p className="muted">{t("admin.help.defaultLocale")}</p>
        <p className="eyebrow admin-kiosk-eyebrow">{t("admin.kiosk.title")}</p>
        <p className="muted">{t("admin.kiosk.help")}</p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.kioskStreamEnabled}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                kioskStreamEnabled: event.target.checked
              })
            }
          />
          {t("admin.kiosk.enabled")}
        </label>
        <label>
          {t("admin.kiosk.path")}
          <input
            value={settings.kioskStreamPath}
            onChange={(event) =>
              onSettingsChange({ ...settings, kioskStreamPath: event.target.value.trim() })
            }
            maxLength={63}
            pattern="[a-zA-Z0-9][a-zA-Z0-9_-]*"
            spellCheck={false}
            autoComplete="off"
            placeholder="stream"
          />
        </label>
        <label>
          {t("admin.kiosk.secret")}
          <input
            type="password"
            value={settings.kioskStreamSecret}
            onChange={(event) =>
              onSettingsChange({ ...settings, kioskStreamSecret: event.target.value })
            }
            maxLength={128}
            spellCheck={false}
            autoComplete="new-password"
            placeholder={t("admin.kiosk.secretPlaceholder")}
          />
        </label>
        <div className="action-row">
          <button
            type="button"
            className="secondary"
            onClick={() =>
              onSettingsChange({ ...settings, kioskStreamSecret: generateKioskStreamSecret() })
            }
          >
            {t("admin.kiosk.generate")}
          </button>
          <button type="button" className="secondary" onClick={() => void copyKioskUrl()}>
            {t("admin.kiosk.copyUrl")}
          </button>
        </div>
        <p className="muted">{t("admin.shell.help")}</p>
        <label>
          {t("admin.shell.heroTitle")}
          <input
            value={settings.shellStartTitle}
            onChange={(event) =>
              onSettingsChange({ ...settings, shellStartTitle: event.target.value })
            }
            maxLength={240}
            placeholder={t("main.route.events.title")}
          />
        </label>
        <label>
          {t("admin.shell.heroDesc")}
          <textarea
            value={settings.shellStartDescription}
            onChange={(event) =>
              onSettingsChange({ ...settings, shellStartDescription: event.target.value })
            }
            maxLength={2000}
            rows={4}
            placeholder={t("main.route.events.description")}
          />
        </label>
        <label>
          {t("admin.shell.emptyTitle")}
          <input
            value={settings.shellEventsEmptyTitle}
            onChange={(event) =>
              onSettingsChange({ ...settings, shellEventsEmptyTitle: event.target.value })
            }
            maxLength={240}
            placeholder={t("events.empty.defaultTitle")}
          />
        </label>
        <label>
          {t("admin.shell.emptyBody")}
          <textarea
            value={settings.shellEventsEmptyBody}
            onChange={(event) =>
              onSettingsChange({ ...settings, shellEventsEmptyBody: event.target.value })
            }
            maxLength={2000}
            rows={3}
            placeholder={t("events.empty.defaultBody")}
          />
        </label>
        <label>
          {t("admin.catalog.label")}
          <textarea
            value={gameCatalogDraft}
            onChange={(event) => onGameCatalogDraftChange(event.target.value)}
            rows={6}
            placeholder={"Counter-Strike 2\nLeague of Legends"}
          />
        </label>
        <p className="muted">{t("admin.catalog.help")}</p>
        <section className="admin-ops" aria-label={t("admin.portability.title")}>
          <p className="eyebrow">{t("admin.portability.eyebrow")}</p>
          <h3>{t("admin.portability.title")}</h3>
          <p className="muted">{t("admin.portability.help")}</p>
          <div className="action-row">
            <button
              type="button"
              onClick={() =>
                onDownloadJsonAttachment("/api/admin/settings/export", "hermes-settings.json")
              }
            >
              {t("admin.settings.export")}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => settingsImportRef.current?.click()}
            >
              {t("admin.settings.import")}
            </button>
            <input
              ref={settingsImportRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onRunSettingsImport(file);
                }
              }}
            />
          </div>
        </section>
        <fieldset className="admin-fieldset">
          <legend>{t("admin.features.pizza.legend")}</legend>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.featuresPizzaEnabled}
              onChange={(event) =>
                onSettingsChange({ ...settings, featuresPizzaEnabled: event.target.checked })
              }
            />
            {t("admin.features.pizza.enable")}
          </label>
          <p className="muted">{t("admin.features.pizza.help")}</p>
          {settings.featuresPizzaEnabled ? (
            <>
              <p className="muted">{t("admin.features.pizza.paymentHelp")}</p>
              <label>
                {t("admin.features.pizza.paypalHandle")}
                <input
                  value={settings.pizzaPaypalHandle}
                  onChange={(event) =>
                    onSettingsChange({ ...settings, pizzaPaypalHandle: event.target.value })
                  }
                  maxLength={80}
                  placeholder="renekeller"
                />
              </label>
              <label>
                {t("admin.features.pizza.paypalName")}
                <input
                  value={settings.pizzaPaypalName}
                  onChange={(event) =>
                    onSettingsChange({ ...settings, pizzaPaypalName: event.target.value })
                  }
                  maxLength={120}
                  placeholder="Rene Keller"
                />
              </label>
              <label>
                {t("admin.features.pizza.cashRecipient")}
                <input
                  value={settings.pizzaCashRecipient}
                  onChange={(event) =>
                    onSettingsChange({ ...settings, pizzaCashRecipient: event.target.value })
                  }
                  maxLength={120}
                  placeholder="Rene"
                />
              </label>
            </>
          ) : null}
        </fieldset>
        <fieldset className="admin-fieldset">
          <legend>{t("admin.amp.title")}</legend>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.ampIntegrationEnabled}
              onChange={(event) =>
                onSettingsChange({ ...settings, ampIntegrationEnabled: event.target.checked })
              }
            />
            {t("admin.amp.enabled")}
          </label>
          <p className="muted">{t("admin.amp.help")}</p>
          {settings.ampIntegrationEnabled ? (
            <>
              <label>
                {t("admin.amp.baseUrl")}
                <input
                  value={settings.ampBaseUrl}
                  onChange={(event) => onSettingsChange({ ...settings, ampBaseUrl: event.target.value })}
                  maxLength={512}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="https://amp-ctl.lanparty.example"
                />
              </label>
              <p className="muted">{t("admin.amp.envHint")}</p>
            </>
          ) : null}
        </fieldset>
        <button type="submit">{t("admin.settings.save")}</button>
      </form>

      <section className="admin-ops" aria-label={t("admin.storage.title")}>
        <p className="eyebrow">{t("admin.storage.eyebrow")}</p>
        <h2>{t("admin.storage.title")}</h2>
        <p className="muted">{t("admin.storage.intro1")}</p>
        <p className="muted">{t("admin.storage.intro2")}</p>
        {storage?.backend === "disabled" ? (
          storage?.envS3Configured ? (
            <p className="muted">{t("admin.storage.disabled.app")}</p>
          ) : (
            <p className="muted">{t("admin.storage.disabled.env")}</p>
          )
        ) : (
          <div className="device-list" aria-label={t("admin.storage.backupStatus")}>
            <article className="device-row">
              <div>
                <strong>{t("admin.storage.backupStatus")}</strong>
                <span>
                  {t("admin.storage.lastOk")}{" "}
                  {storage?.backupStatus?.lastSuccessAt
                    ? new Date(storage.backupStatus.lastSuccessAt).toLocaleString(dateTag)
                    : "—"}
                </span>
                <span>
                  {t("admin.storage.lastErr")}{" "}
                  {storage?.backupStatus?.lastFailureAt
                    ? new Date(storage.backupStatus.lastFailureAt).toLocaleString(dateTag)
                    : "—"}
                </span>
                <span>
                  {t("admin.storage.errCode")}{" "}
                  {storage?.backupStatus?.failureCode ? storage.backupStatus.failureCode : "—"}
                </span>
                <span>
                  {t("admin.storage.hint")}{" "}
                  {storage?.backupStatus?.failureSummary ? storage.backupStatus.failureSummary : "—"}
                </span>
                <span>
                  {t("admin.storage.target")}{" "}
                  {storage?.location
                    ? `s3://${storage.location.bucket}/${storage.location.key} (${storage.location.region})`
                    : "—"}
                </span>
                <span>
                  {t("admin.storage.endpoint")} {storage?.location?.endpoint ?? "—"}
                </span>
              </div>
            </article>
          </div>
        )}
        <div className="action-row">
          <button type="button" onClick={onRunBackup} disabled={opsBusy}>
            {t("admin.storage.backupRun")}
          </button>
          <button type="button" className="secondary" onClick={onRunRestore} disabled={opsBusy}>
            {t("admin.storage.restoreRun")}
          </button>
        </div>
        {restoreRecovery ? (
          <p className="muted">
            {t("admin.storage.recovery")} <strong>{restoreRecovery.id}</strong> ·{" "}
            <code>{restoreRecovery.key}</code>
          </p>
        ) : null}
        {restoreDiagnostics ? (
          <div className="device-list" aria-label={t("admin.storage.diagTitle")}>
            <article className="device-row">
              <div>
                <strong>{t("admin.storage.diagTitle")}</strong>
                <span>
                  {t("admin.storage.diagType")} {restoreDiagnostics.kind}
                </span>
                <span>
                  {t("admin.storage.diagHint")} {restoreDiagnostics.summary}
                </span>
                {restoreDiagnostics.migrations ? (
                  <span>
                    {t("admin.storage.diagMigrations", {
                      live: restoreDiagnostics.migrations.liveLatest ?? "—",
                      snap: restoreDiagnostics.migrations.snapshotLatest ?? "—"
                    })}
                  </span>
                ) : null}
                {restoreDiagnostics.missingTables?.length ? (
                  <span>
                    {t("admin.storage.diagMissing", {
                      tables: restoreDiagnostics.missingTables.slice(0, 10).join(", ")
                    })}
                  </span>
                ) : null}
                {restoreDiagnostics.columnMismatches?.length ? (
                  <span>
                    {t("admin.storage.diagColumns", {
                      detail: restoreDiagnostics.columnMismatches
                        .slice(0, 5)
                        .map(
                          (m) =>
                            `${m.table} (missing: ${m.missingInSnapshot.slice(0, 6).join(", ")})`
                        )
                        .join(" · ")
                    })}
                  </span>
                ) : null}
                {restoreDiagnostics.foreignKeyFailures?.length ? (
                  <span>
                    {t("admin.storage.diagFk", {
                      detail: restoreDiagnostics.foreignKeyFailures
                        .slice(0, 5)
                        .map((fk) => `${fk.table}#${fk.rowid} -> ${fk.parent}`)
                        .join(" · ")
                    })}
                  </span>
                ) : null}
                {restoreDiagnostics.snapshot ? (
                  <span>
                    Snapshot: s3://{restoreDiagnostics.snapshot.bucket}/
                    {restoreDiagnostics.snapshot.key}
                  </span>
                ) : null}
              </div>
            </article>
          </div>
        ) : null}
      </section>
      {settings.featuresPizzaEnabled ? <PizzaMenuJsonAdmin /> : null}
      {settings.ampIntegrationEnabled ? <BindingsAdmin gameCatalog={settings.gameCatalog} /> : null}
    </>
  );
}
