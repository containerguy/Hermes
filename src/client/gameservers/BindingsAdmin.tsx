import { FormEvent, useEffect, useState } from "react";
import { requestJson } from "../api/request";
import { getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import type { AmpIntegrationInstance, GameServerBinding } from "../types/core";

type Scheme = GameServerBinding["connectScheme"];

type Draft = {
  displayTitle: string;
  ampInstanceId: string;
  ampInstanceName: string;
  host: string;
  port: string;
  connectScheme: Scheme;
  enabled: boolean;
};

const EMPTY: Draft = {
  displayTitle: "",
  ampInstanceId: "",
  ampInstanceName: "",
  host: "",
  port: "",
  connectScheme: "copy",
  enabled: true
};

interface BindingsAdminProps {
  gameCatalog: string[];
}

/** Admin-Pflege der Bindungen Spiel -> AMP-Instanz (Phase 15, D-13). */
export function BindingsAdmin({ gameCatalog }: BindingsAdminProps) {
  const { t, locale } = useI18n();
  const [bindings, setBindings] = useState<GameServerBinding[]>([]);
  const [instances, setInstances] = useState<AmpIntegrationInstance[]>([]);
  const [instancesError, setInstancesError] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadBindings() {
    try {
      const result = await requestJson<{ bindings: GameServerBinding[] }>(
        "/api/integrations/amp/bindings/all"
      );
      setBindings(result.bindings);
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  async function loadInstances() {
    setInstancesError("");
    try {
      const result = await requestJson<{ instances: AmpIntegrationInstance[] }>(
        "/api/integrations/amp/instances"
      );
      setInstances(result.instances);
    } catch (caught) {
      setInstances([]);
      setInstancesError(getErrorMessage(caught, locale));
    }
  }

  useEffect(() => {
    void loadBindings();
    void loadInstances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startEdit(binding: GameServerBinding) {
    setEditingId(binding.id);
    setDraft({
      displayTitle: binding.displayTitle,
      ampInstanceId: binding.ampInstanceId,
      ampInstanceName: binding.ampInstanceName,
      host: binding.host,
      port: String(binding.port),
      connectScheme: binding.connectScheme,
      enabled: binding.enabled
    });
    setMessage("");
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(EMPTY);
  }

  function selectInstance(id: string) {
    const inst = instances.find((x) => x.id === id);
    const hostFromEndpoint = inst?.serverHost.split(",")[0]?.trim().split(":") ?? [];
    setDraft((prev) => ({
      ...prev,
      ampInstanceId: id,
      ampInstanceName: inst?.instanceName ?? prev.ampInstanceName,
      host: prev.host || hostFromEndpoint[0] || "",
      port: prev.port || hostFromEndpoint[1] || ""
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    const body = {
      displayTitle: draft.displayTitle,
      ampInstanceId: draft.ampInstanceId,
      ampInstanceName: draft.ampInstanceName,
      host: draft.host,
      port: Number(draft.port),
      connectScheme: draft.connectScheme,
      enabled: draft.enabled
    };
    try {
      if (editingId) {
        await requestJson(`/api/integrations/amp/bindings/${encodeURIComponent(editingId)}`, {
          method: "PUT",
          body: JSON.stringify(body)
        });
      } else {
        await requestJson("/api/integrations/amp/bindings", {
          method: "POST",
          body: JSON.stringify(body)
        });
      }
      setMessage(t("admin.amp.bindings.saved"));
      cancelEdit();
      await loadBindings();
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  async function remove(binding: GameServerBinding) {
    if (!window.confirm(t("admin.amp.bindings.confirmDelete", { title: binding.displayTitle }))) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await requestJson(`/api/integrations/amp/bindings/${encodeURIComponent(binding.id)}`, {
        method: "DELETE"
      });
      if (editingId === binding.id) {
        cancelEdit();
      }
      setMessage(t("admin.amp.bindings.deleted"));
      await loadBindings();
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-ops" aria-label={t("admin.amp.bindings.title")}>
      <header className="admin-section-head">
        <p className="eyebrow">{t("admin.amp.title")}</p>
        <h2>{t("admin.amp.bindings.title")}</h2>
      </header>
      <p className="muted">{t("admin.amp.bindings.help")}</p>

      {bindings.length === 0 ? (
        <p className="muted">{t("admin.amp.bindings.empty")}</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("admin.amp.bindings.displayTitle")}</th>
              <th>{t("admin.amp.bindings.instance")}</th>
              <th>{t("admin.amp.bindings.endpoint")}</th>
              <th>{t("admin.amp.bindings.scheme")}</th>
              <th>{t("admin.amp.bindings.enabled")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bindings.map((binding) => (
              <tr key={binding.id}>
                <td>{binding.displayTitle}</td>
                <td>{binding.ampInstanceName}</td>
                <td>
                  {binding.host}:{binding.port}
                </td>
                <td>{binding.connectScheme}</td>
                <td>{binding.enabled ? "✓" : "–"}</td>
                <td>
                  <button type="button" className="ghost" onClick={() => startEdit(binding)}>
                    {t("admin.amp.bindings.edit")}
                  </button>{" "}
                  <button type="button" className="ghost" disabled={busy} onClick={() => void remove(binding)}>
                    {t("admin.amp.bindings.delete")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form className="admin-form" onSubmit={(event) => void submit(event)}>
        <h3>{editingId ? t("admin.amp.bindings.editTitle") : t("admin.amp.bindings.addTitle")}</h3>
        <label>
          {t("admin.amp.bindings.displayTitle")}
          <input
            list="amp-binding-games"
            value={draft.displayTitle}
            onChange={(event) => setDraft({ ...draft, displayTitle: event.target.value })}
            maxLength={160}
            required
          />
          <datalist id="amp-binding-games">
            {gameCatalog.map((title) => (
              <option key={title} value={title} />
            ))}
          </datalist>
        </label>
        <label>
          {t("admin.amp.bindings.instance")}
          <select value={draft.ampInstanceId} onChange={(event) => selectInstance(event.target.value)} required>
            <option value="">{t("admin.amp.bindings.selectInstance")}</option>
            {instances.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.targetName ? `${inst.targetName} · ` : ""}
                {inst.friendlyName}
                {inst.module ? ` (${inst.module})` : ""}
              </option>
            ))}
          </select>
        </label>
        {instancesError ? <p className="muted">{instancesError}</p> : null}
        <label>
          {t("admin.amp.bindings.host")}
          <input
            value={draft.host}
            onChange={(event) => setDraft({ ...draft, host: event.target.value })}
            maxLength={253}
            placeholder="cs2.lanparty.example"
            spellCheck={false}
            required
          />
        </label>
        <label>
          {t("admin.amp.bindings.port")}
          <input
            type="number"
            min={1}
            max={65535}
            value={draft.port}
            onChange={(event) => setDraft({ ...draft, port: event.target.value })}
            required
          />
        </label>
        <label>
          {t("admin.amp.bindings.scheme")}
          <select
            value={draft.connectScheme}
            onChange={(event) => setDraft({ ...draft, connectScheme: event.target.value as Scheme })}
          >
            <option value="steam">{t("admin.amp.bindings.scheme.steam")}</option>
            <option value="minecraft">{t("admin.amp.bindings.scheme.minecraft")}</option>
            <option value="copy">{t("admin.amp.bindings.scheme.copy")}</option>
          </select>
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          />
          {t("admin.amp.bindings.enabled")}
        </label>
        <div className="action-row">
          <button type="submit" disabled={busy}>
            {t("admin.amp.bindings.save")}
          </button>
          {editingId ? (
            <button type="button" className="ghost" onClick={cancelEdit}>
              {t("admin.amp.bindings.cancel")}
            </button>
          ) : null}
        </div>
        {message ? <p className="muted">{message}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
      </form>
    </section>
  );
}
