import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { requestJson } from "../api/request";
import { MoreMenu } from "../components/MoreMenu";
import { ApiError } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import type { User } from "../types/core";
import { ModuleSlot, notifyModulesChanged } from "./runtime";
import type { ModuleAdminProps, RuntimeModuleInfo } from "./types";
import { moduleText, type ModuleTextKey } from "./texts";

type Localized = string | { de: string; en?: string };

type Source = {
  id: string;
  name: string;
  url: string;
  ref: string;
  trust: "official" | "third_party";
  tokenEnv: string | null;
  lastFetchedAt: string | null;
  lastError: string | null;
};

type ManifestSummary = {
  id: string;
  name: Localized;
  version: string;
  description: Localized | null;
  author: string | null;
  homepage: string | null;
  permissions: Array<{ key: string; label: Localized; scopable: boolean; defaultRoles: string[] }>;
  tables: string[];
  secrets: string[];
  network: string[];
  trust: Source["trust"] | null;
};

type InstalledModule = {
  id: string;
  name: Localized;
  version: string;
  previousVersion: string | null;
  state: "installed" | "enabled" | "disabled";
  running: boolean;
  error: string | null;
  orphaned: boolean;
  source: { id: string; name: string; trust: Source["trust"] } | null;
  sha256: string;
  manifest: ManifestSummary;
  settingsSchema: JsonSchema | null;
  adminPage: boolean;
  clientUrl: string | null;
};

type AvailableModule = {
  id: string;
  name: Localized;
  description: Localized | null;
  latestCompatible: string | null;
  versions: Array<{ version: string; compatible: boolean; changelog: string | null }>;
  installed: { version: string; state: string; fromThisSource: boolean } | null;
  updateAvailable: boolean;
};

type UpdateHint = { id: string; installed: string; latest: string; sourceId: string };

type JsonSchema = {
  type?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  default?: unknown;
  minimum?: number;
  maximum?: number;
};

type Pending =
  | { kind: "install"; sourceId: string; moduleId: string; preview: ManifestSummary }
  | { kind: "update"; moduleId: string; from: string; to: string; preview: ManifestSummary; diff: Record<string, string[]> };

function errorOf(caught: unknown) {
  if (caught instanceof ApiError) {
    const body = caught.body as { message?: string; error?: string } | undefined;
    return body?.message && body.message !== body.error ? `${body.error}: ${body.message}` : caught.message;
  }
  return caught instanceof Error ? caught.message : String(caught);
}

function useTexts() {
  const { locale } = useI18n();
  return useMemo(
    () => ({
      locale,
      tx: (key: ModuleTextKey, vars?: Record<string, string | number>) => moduleText(locale, key, vars),
      loc: (value: Localized | null | undefined) =>
        value == null ? "" : typeof value === "string" ? value : locale === "en" && value.en ? value.en : value.de
    }),
    [locale]
  );
}

/** Admin › Module: installierte Module, Update-Empfehlungen, Quellen und Modul-Einstellungen. */
export function AdminModules({ currentUser, subPath }: { currentUser: User; subPath: string }) {
  const detailId = subPath.split("/")[1] ?? "";
  const [data, setData] = useState<{ sources: Source[]; modules: InstalledModule[] } | null>(null);
  const [updates, setUpdates] = useState<UpdateHint[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const { tx, loc } = useTexts();

  const reload = useCallback(async () => {
    const result = await requestJson<{ sources: Source[]; modules: InstalledModule[] }>("/api/admin/modules");
    setData(result);
  }, []);

  const reloadUpdates = useCallback(async (force = false) => {
    try {
      const result = await requestJson<{ updates: UpdateHint[] }>(`/api/admin/modules/updates${force ? "?force=1" : ""}`);
      setUpdates(result.updates);
    } catch {
      setUpdates([]);
    }
  }, []);

  useEffect(() => {
    reload().catch((caught) => setMessage({ kind: "error", text: errorOf(caught) }));
    void reloadUpdates();
  }, [reload, reloadUpdates]);

  async function run(action: () => Promise<unknown>, okText?: string, changed = true) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (okText) setMessage({ kind: "ok", text: okText });
      await reload();
      if (changed) notifyModulesChanged();
    } catch (caught) {
      setMessage({ kind: "error", text: errorOf(caught) });
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function startInstall(sourceId: string, moduleId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await requestJson<{ preview: ManifestSummary }>("/api/admin/modules/install", {
        method: "POST",
        body: JSON.stringify({ sourceId, moduleId })
      });
      setPending({ kind: "install", sourceId, moduleId, preview: result.preview });
    } catch (caught) {
      setMessage({ kind: "error", text: errorOf(caught) });
    } finally {
      setBusy(false);
    }
  }

  async function startUpdate(moduleId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await requestJson<{ from: string; to: string; preview: ManifestSummary; diff: Record<string, string[]> }>(
        `/api/admin/modules/${moduleId}/update`,
        { method: "POST", body: JSON.stringify({}) }
      );
      setPending({ kind: "update", moduleId, ...result });
    } catch (caught) {
      setMessage({ kind: "error", text: errorOf(caught) });
    } finally {
      setBusy(false);
    }
  }

  async function confirmPending() {
    if (!pending) return;
    const current = pending;
    setPending(null);
    if (current.kind === "install") {
      await run(
        () =>
          requestJson("/api/admin/modules/install", {
            method: "POST",
            body: JSON.stringify({ sourceId: current.sourceId, moduleId: current.moduleId, confirm: true })
          }),
        tx("installed", { id: current.moduleId })
      );
    } else {
      await run(
        () =>
          requestJson(`/api/admin/modules/${current.moduleId}/update`, {
            method: "POST",
            body: JSON.stringify({ version: current.to, confirm: true })
          }),
        tx("updated", { id: current.moduleId, version: current.to })
      );
      await reloadUpdates();
    }
  }

  async function uninstall(module: InstalledModule) {
    const typed = window.prompt(tx("uninstallPrompt", { id: module.id }));
    if (typed === null) return;
    await run(
      () =>
        requestJson(`/api/admin/modules/${module.id}/uninstall`, {
          method: "POST",
          body: JSON.stringify({ confirmId: typed.trim() })
        }),
      tx("uninstalled", { id: module.id })
    );
  }

  async function downloadExport(module: InstalledModule) {
    try {
      const exported = await requestJson<unknown>(`/api/admin/modules/${module.id}/export`);
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `matchdesk-modul-${module.id}-${module.version}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setMessage({ kind: "error", text: errorOf(caught) });
    }
  }

  if (!data) {
    return (
      <section className="admin-modules">
        <p className="eyebrow">{tx("eyebrow")}</p>
        {message ? <p className="notice">{message.text}</p> : <p className="muted">…</p>}
      </section>
    );
  }

  const detail = detailId ? data.modules.find((module) => module.id === detailId) : undefined;
  if (detail) {
    return <ModuleDetail module={detail} currentUser={currentUser} onBack={() => (window.location.hash = "#admin/module")} />;
  }

  return (
    <section className="admin-modules" aria-label={tx("eyebrow")}>
      <p className="eyebrow">{tx("eyebrow")}</p>
      <h2>{tx("title")}</h2>
      <p className="muted">{tx("help")}</p>
      {message ? (
        <p className={message.kind === "error" ? "error" : "notice"} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}

      {updates.length > 0 ? (
        <div className="notice module-updates" role="status">
          <strong>{tx("updatesTitle")}</strong>
          <ul>
            {updates.map((hint) => (
              <li key={hint.id}>
                {tx("updateHint", { id: hint.id, from: hint.installed, to: hint.latest })}{" "}
                <button type="button" className="secondary" disabled={busy} onClick={() => startUpdate(hint.id)}>
                  {tx("reviewUpdate")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pending ? (
        <ConfirmPanel pending={pending} busy={busy} onConfirm={confirmPending} onCancel={() => setPending(null)} />
      ) : null}

      <h3>{tx("installedTitle")}</h3>
      {data.modules.length === 0 ? <p className="empty-state">{tx("noneInstalled")}</p> : null}
      <ul className="device-list module-list">
        {data.modules.map((module) => (
          <li key={module.id} className="device-row module-row">
            <div>
              <p className="item-title">
                <strong>{loc(module.name)}</strong>
                <span className="item-meta">{module.version}</span>
                <span className={`badge ${module.state === "enabled" ? "badge--ok" : ""}`}>{tx(`state_${module.state}`)}</span>
                {module.state === "enabled" && !module.running ? <span className="badge badge--danger">{tx("notRunning")}</span> : null}
              </p>
              <p className="item-sub">
                <code>{module.id}</code>
                {module.orphaned ? ` · ${tx("orphaned")}` : module.source ? ` · ${module.source.name}` : ""}
              </p>
              {module.error ? <p className="error">{module.error}</p> : null}
            </div>
            <div className="device-actions">
              {module.state === "enabled" ? (
                <button type="button" className="secondary" disabled={busy} onClick={() => run(() => post(`/api/admin/modules/${module.id}/disable`), tx("disabled", { id: module.id }))}>
                  {tx("disable")}
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => run(() => post(`/api/admin/modules/${module.id}/enable`), tx("enabled", { id: module.id }))}>
                  {tx("enable")}
                </button>
              )}
              <a className="button-link secondary" href={`#admin/module/${module.id}`}>
                {tx("settings")}
              </a>
              <MoreMenu label={tx("more")}>
                {!module.orphaned ? (
                  <button type="button" className="secondary" disabled={busy} onClick={() => startUpdate(module.id)}>
                    {tx("update")}
                  </button>
                ) : null}
                <button type="button" className="secondary" disabled={busy} onClick={() => downloadExport(module)}>
                  {tx("export")}
                </button>
                {module.state !== "enabled" ? (
                  <button type="button" className="secondary danger" disabled={busy} onClick={() => uninstall(module)}>
                    {tx("uninstall")}
                  </button>
                ) : null}
              </MoreMenu>
            </div>
          </li>
        ))}
      </ul>

      <Sources
        sources={data.sources}
        modules={data.modules}
        busy={busy}
        onRun={run}
        onInstall={startInstall}
        onUpdate={startUpdate}
        onRefreshUpdates={() => reloadUpdates(true)}
      />
    </section>
  );
}

function post(url: string, body: unknown = {}) {
  return requestJson(url, { method: "POST", body: JSON.stringify(body) });
}

function ConfirmPanel({
  pending,
  busy,
  onConfirm,
  onCancel
}: {
  pending: Pending;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { tx, loc } = useTexts();
  const [accepted, setAccepted] = useState(false);
  const preview = pending.preview;
  const thirdParty = preview.trust === "third_party";
  return (
    <section className="admin-fieldset module-confirm" aria-label={tx("confirmTitle")}>
      <h3>
        {pending.kind === "install"
          ? tx("confirmInstall", { name: loc(preview.name), version: preview.version })
          : tx("confirmUpdate", { name: loc(preview.name), from: pending.from, to: pending.to })}
      </h3>
      {preview.description ? <p>{loc(preview.description)}</p> : null}
      {preview.author ? <p className="muted">{tx("author", { author: preview.author })}</p> : null}
      <p className={thirdParty ? "error" : "notice"}>{thirdParty ? tx("warnThirdParty") : tx("warnOfficial")}</p>
      <dl className="module-manifest">
        <dt>{tx("permissions")}</dt>
        <dd>
          {preview.permissions.length === 0
            ? "–"
            : preview.permissions.map((permission) => (
                <div key={permission.key}>
                  <code>{permission.key}</code> {loc(permission.label)}
                  {permission.scopable ? ` · ${tx("scopable")}` : ""}
                  {permission.defaultRoles.length ? ` · ${tx("defaultRoles")}: ${permission.defaultRoles.join(", ")}` : ""}
                </div>
              ))}
        </dd>
        <dt>{tx("tables")}</dt>
        <dd>{preview.tables.join(", ") || "–"}</dd>
        <dt>{tx("secrets")}</dt>
        <dd>{preview.secrets.map((secret) => `MATCHDESK_${secret}`).join(", ") || "–"}</dd>
        <dt>{tx("network")}</dt>
        <dd>{preview.network.join(", ") || "–"}</dd>
        {pending.kind === "update" ? (
          <>
            <dt>{tx("changes")}</dt>
            <dd>
              {Object.entries(pending.diff)
                .filter(([, values]) => values.length > 0)
                .map(([key, values]) => (
                  <div key={key}>
                    {tx(`diff_${key}` as ModuleTextKey)}: {values.join(", ")}
                  </div>
                ))}
              {Object.values(pending.diff).every((values) => values.length === 0) ? tx("noManifestChanges") : null}
            </dd>
          </>
        ) : null}
      </dl>
      <label className="checkbox-label">
        <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
        {tx("acceptRisk")}
      </label>
      <div className="action-row">
        <button type="button" disabled={!accepted || busy} onClick={onConfirm}>
          {pending.kind === "install" ? tx("install") : tx("update")}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          {tx("cancel")}
        </button>
      </div>
    </section>
  );
}

const emptySource = { name: "", url: "", ref: "main", trust: "third_party" as Source["trust"], tokenEnv: "" };

function Sources({
  sources,
  modules,
  busy,
  onRun,
  onInstall,
  onUpdate,
  onRefreshUpdates
}: {
  sources: Source[];
  modules: InstalledModule[];
  busy: boolean;
  onRun: (action: () => Promise<unknown>, okText?: string, changed?: boolean) => Promise<void>;
  onInstall: (sourceId: string, moduleId: string) => void;
  onUpdate: (moduleId: string) => void;
  onRefreshUpdates: () => void;
}) {
  const { tx, loc } = useTexts();
  const [draft, setDraft] = useState(emptySource);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState(emptySource);
  const [thirdPartyAccepted, setThirdPartyAccepted] = useState(false);
  const [available, setAvailable] = useState<Record<string, AvailableModule[] | string>>({});

  const activeBySource = (sourceId: string) =>
    modules.filter((module) => module.source?.id === sourceId && module.state === "enabled").map((module) => module.id);

  async function showModules(sourceId: string) {
    try {
      const result = await requestJson<{ modules: AvailableModule[] }>(`/api/admin/modules/sources/${sourceId}/modules?force=1`);
      setAvailable((current) => ({ ...current, [sourceId]: result.modules }));
    } catch (caught) {
      setAvailable((current) => ({ ...current, [sourceId]: errorOf(caught) }));
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onRun(
      () =>
        requestJson("/api/admin/modules/sources", {
          method: "POST",
          body: JSON.stringify({ ...draft, tokenEnv: draft.tokenEnv.trim() || null })
        }),
      tx("sourceAdded", { name: draft.name }),
      false
    ).then(() => {
      setDraft(emptySource);
      setThirdPartyAccepted(false);
    });
  }

  function saveEdit(source: Source) {
    void onRun(
      () =>
        requestJson(`/api/admin/modules/sources/${source.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...editDraft, tokenEnv: editDraft.tokenEnv.trim() || null })
        }),
      tx("sourceSaved", { name: editDraft.name }),
      false
    ).then(() => setEditing(null));
  }

  return (
    <>
      <div className="section-title-row">
        <h3>{tx("sourcesTitle")}</h3>
        <button type="button" className="secondary" onClick={onRefreshUpdates}>
          {tx("checkUpdates")}
        </button>
      </div>
      <p className="muted">{tx("sourcesHelp")}</p>
      <ul className="device-list">
        {sources.map((source) => {
          const active = activeBySource(source.id);
          const list = available[source.id];
          return (
            <li key={source.id} className="device-row module-source">
              {editing === source.id ? (
                <div className="form-grid">
                  <label>
                    {tx("sourceName")}
                    <input value={editDraft.name} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} />
                  </label>
                  <label>
                    {tx("sourceUrl")}
                    <input value={editDraft.url} onChange={(event) => setEditDraft({ ...editDraft, url: event.target.value })} />
                  </label>
                  <label>
                    {tx("sourceRef")}
                    <input value={editDraft.ref} onChange={(event) => setEditDraft({ ...editDraft, ref: event.target.value })} />
                  </label>
                  <label>
                    {tx("sourceToken")}
                    <input
                      value={editDraft.tokenEnv}
                      placeholder="MATCHDESK_SOURCE_TOKEN_…"
                      onChange={(event) => setEditDraft({ ...editDraft, tokenEnv: event.target.value })}
                    />
                  </label>
                  <div className="action-row">
                    <button type="button" disabled={busy} onClick={() => saveEdit(source)}>
                      {tx("save")}
                    </button>
                    <button type="button" className="secondary" onClick={() => setEditing(null)}>
                      {tx("cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="item-title">
                    <strong>{source.name}</strong>
                    <span className={`badge ${source.trust === "third_party" ? "badge--warn" : ""}`}>{tx(`trust_${source.trust}`)}</span>
                  </p>
                  <p className="item-sub">
                    <code>{source.url}</code> · {source.ref}
                    {source.tokenEnv ? ` · ${source.tokenEnv}` : ""}
                  </p>
                  {source.lastError ? <p className="error">{source.lastError}</p> : null}
                  {active.length > 0 ? <p className="item-sub">{tx("sourceLocked", { modules: active.join(", ") })}</p> : null}
                </div>
              )}
              <div className="device-actions">
                <button type="button" className="secondary" onClick={() => showModules(source.id)}>
                  {tx("showModules")}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || active.length > 0}
                  onClick={() => {
                    setEditing(source.id);
                    setEditDraft({ name: source.name, url: source.url, ref: source.ref, trust: source.trust, tokenEnv: source.tokenEnv ?? "" });
                  }}
                >
                  {tx("edit")}
                </button>
                <button
                  type="button"
                  className="secondary danger"
                  disabled={busy || active.length > 0}
                  onClick={() => {
                    if (window.confirm(tx("deleteSourceConfirm", { name: source.name }))) {
                      void onRun(
                        () => requestJson(`/api/admin/modules/sources/${source.id}`, { method: "DELETE" }),
                        tx("sourceDeleted", { name: source.name }),
                        false
                      );
                    }
                  }}
                >
                  {tx("delete")}
                </button>
              </div>
              {typeof list === "string" ? <p className="error">{list}</p> : null}
              {Array.isArray(list) ? (
                list.length === 0 ? (
                  <p className="empty-state">{tx("sourceEmpty")}</p>
                ) : (
                  <ul className="device-list module-available">
                    {list.map((module) => (
                      <li key={module.id} className="device-row">
                        <div>
                          <p className="item-title">
                            <strong>{loc(module.name)}</strong>
                            <span className="item-meta">{module.latestCompatible ?? tx("noCompatible")}</span>
                            {module.installed ? (
                              <span className="badge badge--ok">{tx("alreadyInstalled", { version: module.installed.version })}</span>
                            ) : null}
                          </p>
                          {module.description ? <p className="item-sub">{loc(module.description)}</p> : null}
                        </div>
                        <div className="device-actions">
                          {module.installed ? (
                            module.updateAvailable ? (
                              <button type="button" className="secondary" disabled={busy} onClick={() => onUpdate(module.id)}>
                                {tx("updateTo", { version: module.latestCompatible ?? "" })}
                              </button>
                            ) : null
                          ) : module.latestCompatible ? (
                            <button type="button" className="secondary" disabled={busy} onClick={() => onInstall(source.id, module.id)}>
                              {tx("install")}
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </li>
          );
        })}
      </ul>

      <details className="module-source-add">
        <summary>{tx("addSource")}</summary>
        <form className="admin-form module-source-form" onSubmit={submit}>
          <div className="form-grid">
            <label>
              {tx("sourceName")}
              <input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label>
              {tx("sourceUrl")}
              <input
                required
                value={draft.url}
                placeholder="https://github.com/…/…"
                onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              />
            </label>
            <label>
              {tx("sourceRef")}
              <input value={draft.ref} onChange={(event) => setDraft({ ...draft, ref: event.target.value })} />
            </label>
            <label>
              {tx("sourceToken")}
              <input
                value={draft.tokenEnv}
                placeholder="MATCHDESK_SOURCE_TOKEN_…"
                onChange={(event) => setDraft({ ...draft, tokenEnv: event.target.value })}
              />
            </label>
            <label>
              {tx("sourceTrust")}
              <select value={draft.trust} onChange={(event) => setDraft({ ...draft, trust: event.target.value as Source["trust"] })}>
                <option value="third_party">{tx("trust_third_party")}</option>
                <option value="official">{tx("trust_official")}</option>
              </select>
            </label>
          </div>
          <p className="muted">{tx("sourceTokenHelp")}</p>
          <label className="checkbox-label">
            <input type="checkbox" checked={thirdPartyAccepted} onChange={(event) => setThirdPartyAccepted(event.target.checked)} />
            {tx("acceptSource")}
          </label>
          <button type="submit" disabled={busy || !thirdPartyAccepted}>
            {tx("addSource")}
          </button>
        </form>
      </details>
    </>
  );
}

type SecretStatus = {
  name: string;
  envName: string;
  fromEnv: boolean;
  stored: "stored" | "unreadable" | "missing";
  updatedAt: string | null;
};

/** Zugangsdaten aus `secrets` im Manifest: nur Status anzeigen, Werte nur schreiben. */
function ModuleSecrets({ moduleId, onChanged }: { moduleId: string; onChanged: () => void }) {
  const { tx } = useTexts();
  const [state, setState] = useState<{ defaultKey: boolean; secrets: SecretStatus[] } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    requestJson<{ defaultKey: boolean; secrets: SecretStatus[] }>(`/api/admin/modules/${moduleId}/secrets`)
      .then(setState)
      .catch((caught) => setMessage({ kind: "error", text: errorOf(caught) }));
  }, [moduleId]);

  async function run(name: string, method: "PUT" | "DELETE") {
    setBusy(true);
    setMessage(null);
    try {
      const result = await requestJson<{ defaultKey: boolean; secrets: SecretStatus[] }>(
        `/api/admin/modules/${moduleId}/secrets/${encodeURIComponent(name)}`,
        method === "PUT" ? { method, body: JSON.stringify({ value: values[name] ?? "" }) } : { method }
      );
      setState(result);
      setValues((current) => ({ ...current, [name]: "" }));
      setMessage({ kind: "ok", text: tx(method === "PUT" ? "secretSaved" : "secretRemoved") });
      onChanged();
    } catch (caught) {
      setMessage({ kind: "error", text: errorOf(caught) });
    } finally {
      setBusy(false);
    }
  }

  function statusText(secret: SecretStatus) {
    if (secret.fromEnv) return tx("secretFromEnv", { env: secret.envName });
    if (secret.stored === "stored") return tx("secretStored");
    if (secret.stored === "unreadable") return tx("secretUnreadable");
    return tx("secretMissing");
  }

  return (
    <>
      <h3>{tx("secretsTitle")}</h3>
      <p className="muted">{tx("secretsHelp")}</p>
      {state?.defaultKey ? <p className="notice module-secret-warning">{tx("secretsDefaultKey")}</p> : null}
      {message ? (
        <p className={message.kind === "error" ? "error" : "notice"} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}
      {state ? (
        state.secrets.map((secret) => (
          <form
            key={secret.name}
            className="admin-form module-secret"
            onSubmit={(event) => {
              event.preventDefault();
              void run(secret.name, "PUT");
            }}
          >
            <label>
              <span>
                <code>{secret.name}</code> ·{" "}
                <span className={`badge ${secret.fromEnv || secret.stored === "stored" ? "badge--ok" : "badge--danger"}`}>{statusText(secret)}</span>
              </span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={values[secret.name] ?? ""}
                placeholder={tx("secretPlaceholder")}
                onChange={(event) => setValues({ ...values, [secret.name]: event.target.value })}
              />
            </label>
            <div className="module-secret-actions">
              <button type="submit" disabled={busy || !(values[secret.name] ?? "").trim()}>
                {secret.stored === "missing" ? tx("save") : tx("secretReplace")}
              </button>
              {secret.stored !== "missing" ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(tx("secretRemoveConfirm", { name: secret.name }))) void run(secret.name, "DELETE");
                  }}
                >
                  {tx("secretRemove")}
                </button>
              ) : null}
            </div>
          </form>
        ))
      ) : (
        <p className="muted">…</p>
      )}
    </>
  );
}

function ModuleDetail({ module, currentUser, onBack }: { module: InstalledModule; currentUser: User; onBack: () => void }) {
  const { tx, loc, locale } = useTexts();
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // Neu zählen, wenn das Modul nach geänderten Zugangsdaten neu gestartet wurde (Admin-Ansicht neu laden).
  const [adminKey, setAdminKey] = useState(0);

  const load = useCallback(() => {
    requestJson<{ settings: Record<string, unknown> }>(`/api/admin/modules/${module.id}/settings`)
      .then((result) => {
        setSettings(result.settings);
        setDraft(result.settings);
      })
      .catch((caught) => setMessage({ kind: "error", text: errorOf(caught) }));
  }, [module.id]);

  useEffect(load, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      const result = await requestJson<{ settings: Record<string, unknown> }>(`/api/admin/modules/${module.id}/settings`, {
        method: "PUT",
        body: JSON.stringify({ settings: draft })
      });
      setSettings(result.settings);
      setDraft(result.settings);
      setMessage({ kind: "ok", text: tx("settingsSaved") });
    } catch (caught) {
      setMessage({ kind: "error", text: errorOf(caught) });
    }
  }

  // Übersetzungen und Rechte des laufenden Moduls für seine eigene Admin-Ansicht
  const [runtime, setRuntime] = useState<RuntimeModuleInfo | null>(null);
  useEffect(() => {
    if (!module.running) return;
    requestJson<{ modules: RuntimeModuleInfo[] }>("/api/modules")
      .then((result) => setRuntime(result.modules.find((entry) => entry.id === module.id) ?? null))
      .catch(() => setRuntime(null));
  }, [module.id, module.version, module.running]);

  const properties = Object.entries(module.settingsSchema?.properties ?? {});
  const runtimeInfo: RuntimeModuleInfo = runtime ?? {
    id: module.id,
    version: module.version,
    name: loc(module.name),
    clientUrl: module.clientUrl,
    adminPage: module.adminPage,
    permissions: [],
    menu: [],
    i18n: { de: {}, en: {} }
  };

  return (
    <section className="admin-modules module-detail">
      <p className="eyebrow">{tx("eyebrow")}</p>
      <h2>
        {loc(module.name)} <small>{module.version}</small>
      </h2>
      <button type="button" className="secondary" onClick={onBack}>
        {tx("back")}
      </button>
      {message ? (
        <p className={message.kind === "error" ? "error" : "notice"} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}

      <h3>{tx("permissions")}</h3>
      <p className="muted">{tx("permissionsHelp")}</p>
      <ul>
        {module.manifest.permissions.map((permission) => (
          <li key={permission.key}>
            <code>{permission.key}</code> {loc(permission.label)}
            {permission.scopable ? ` · ${tx("scopable")}` : ""} · {tx("defaultRoles")}: {permission.defaultRoles.join(", ") || "admin"}
          </li>
        ))}
      </ul>

      <h3>{tx("settings")}</h3>
      {properties.length === 0 ? (
        <p className="empty-state">{tx("noSettings")}</p>
      ) : settings ? (
        <form className="admin-form" onSubmit={save}>
          {properties.map(([key, schema]) => (
            <SettingField key={key} name={key} schema={schema} value={draft[key]} onChange={(value) => setDraft({ ...draft, [key]: value })} />
          ))}
          <button type="submit">{tx("save")}</button>
        </form>
      ) : (
        <p className="muted">…</p>
      )}

      {module.manifest.secrets.length > 0 ? (
        <ModuleSecrets moduleId={module.id} onChanged={() => setAdminKey((key) => key + 1)} />
      ) : null}

      {module.adminPage && module.running && module.clientUrl && runtime ? (
        <>
          <h3>{tx("moduleAdmin")}</h3>
          <ModuleSlot
            key={adminKey}
            info={runtimeInfo}
            locale={locale}
            pick={(definition) => definition.Admin as React.ComponentType<never> | undefined}
            render={(Admin) => {
              const Component = Admin as unknown as React.ComponentType<ModuleAdminProps>;
              return <Component user={currentUser} settings={settings ?? {}} reloadSettings={load} />;
            }}
          />
        </>
      ) : null}
    </section>
  );
}

/** Formularfeld aus dem JSON-Schema einer Einstellung (Text, Zahl, Schalter, Auswahl). */
export function SettingField({
  name,
  schema,
  value,
  onChange
}: {
  name: string;
  schema: JsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  // Ohne title dient die Beschreibung (zod: .describe()) als Beschriftung.
  const label = schema.title ?? schema.description ?? name;
  const help = schema.title && schema.description ? <small className="muted">{schema.description}</small> : null;
  if (schema.enum) {
    return (
      <label>
        {label}
        <select value={String(value ?? "")} onChange={(event) => onChange(schema.enum?.find((option) => String(option) === event.target.value))}>
          {schema.enum.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
        {help}
      </label>
    );
  }
  if (schema.type === "boolean") {
    return (
      <label className="checkbox-label">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        {label}
        {help}
      </label>
    );
  }
  if (schema.type === "integer" || schema.type === "number") {
    return (
      <label>
        {label}
        <input
          type="number"
          step={schema.type === "integer" ? 1 : "any"}
          min={schema.minimum}
          max={schema.maximum}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
        />
        {help}
      </label>
    );
  }
  if (schema.type === "string") {
    return (
      <label>
        {label}
        <input value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />
        {help}
      </label>
    );
  }
  return (
    <label>
      {label} (JSON)
      <textarea
        defaultValue={JSON.stringify(value ?? null, null, 2)}
        onBlur={(event) => {
          try {
            onChange(JSON.parse(event.target.value));
          } catch {
            /* ungültiges JSON: Server meldet den Fehler beim Speichern */
          }
        }}
      />
      {help}
    </label>
  );
}
