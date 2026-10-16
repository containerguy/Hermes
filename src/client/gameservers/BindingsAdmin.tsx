import { FormEvent, useEffect, useState } from "react";
import { requestJson } from "../api/request";
import { getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import type { AmpIntegrationInstance, BindingSuggestion, GameServerBinding } from "../types/core";

type Scheme = GameServerBinding["connectScheme"];

type Draft = {
  displayTitle: string;
  ampInstanceId: string;
  ampInstanceName: string;
  host: string;
  port: string;
  connectScheme: Scheme;
  enabled: boolean;
  autoStopEnabled: boolean;
};

const EMPTY: Draft = {
  displayTitle: "",
  ampInstanceId: "",
  ampInstanceName: "",
  host: "",
  port: "",
  connectScheme: "copy",
  enabled: true,
  autoStopEnabled: false
};

interface BindingsAdminProps {
  gameCatalog: string[];
}

function draftFromSuggestion(s: BindingSuggestion, title?: string): Draft {
  return {
    displayTitle: title ?? s.suggestedTitle ?? s.moduleDisplayName ?? s.friendlyName,
    ampInstanceId: s.ampInstanceId,
    ampInstanceName: s.ampInstanceName,
    host: s.host,
    port: s.port ? String(s.port) : "",
    connectScheme: s.connectScheme,
    enabled: true,
    autoStopEnabled: false
  };
}

/** Admin-Pflege der Bindungen Spiel -> AMP-Instanz (Phase 15, D-13), mit Vorschlägen aus AMP. */
export function BindingsAdmin({ gameCatalog }: BindingsAdminProps) {
  const { t, locale } = useI18n();
  const [bindings, setBindings] = useState<GameServerBinding[]>([]);
  const [instances, setInstances] = useState<AmpIntegrationInstance[]>([]);
  const [suggestions, setSuggestions] = useState<BindingSuggestion[]>([]);
  const [suggestionTitles, setSuggestionTitles] = useState<Record<string, string>>({});
  const [ampError, setAmpError] = useState("");
  const [ampLoading, setAmpLoading] = useState(false);
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

  async function loadFromAmp() {
    setAmpLoading(true);
    setAmpError("");
    try {
      const [inst, sugg] = await Promise.all([
        requestJson<{ instances: AmpIntegrationInstance[] }>("/api/integrations/amp/instances"),
        requestJson<{ suggestions: BindingSuggestion[] }>("/api/integrations/amp/bindings/suggestions")
      ]);
      setInstances(inst.instances);
      setSuggestions(sugg.suggestions);
      setSuggestionTitles((prev) => {
        const next = { ...prev };
        for (const s of sugg.suggestions) {
          if (!next[s.ampInstanceId]) {
            next[s.ampInstanceId] = s.suggestedTitle ?? "";
          }
        }
        return next;
      });
    } catch (caught) {
      setInstances([]);
      setSuggestions([]);
      setAmpError(getErrorMessage(caught, locale));
    } finally {
      setAmpLoading(false);
    }
  }

  useEffect(() => {
    void loadBindings();
    void loadFromAmp();
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
      enabled: binding.enabled,
      autoStopEnabled: binding.autoStopEnabled
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
    setDraft((prev) => ({
      ...prev,
      ampInstanceId: id,
      ampInstanceName: inst?.instanceName ?? prev.ampInstanceName,
      host: inst?.targetHost || prev.host,
      port: inst?.gamePort ? String(inst.gamePort) : prev.port
    }));
  }

  function takeSuggestion(s: BindingSuggestion) {
    setEditingId(null);
    setDraft(draftFromSuggestion(s, suggestionTitles[s.ampInstanceId] || undefined));
    setMessage("");
    setError("");
  }

  async function persist(body: Record<string, unknown>, id: string | null) {
    if (id) {
      await requestJson(`/api/integrations/amp/bindings/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(body)
      });
    } else {
      await requestJson("/api/integrations/amp/bindings", { method: "POST", body: JSON.stringify(body) });
    }
  }

  function bodyFromDraft(d: Draft) {
    return {
      displayTitle: d.displayTitle,
      ampInstanceId: d.ampInstanceId,
      ampInstanceName: d.ampInstanceName,
      host: d.host,
      port: Number(d.port),
      connectScheme: d.connectScheme,
      enabled: d.enabled,
      autoStopEnabled: d.autoStopEnabled
    };
  }

  async function createFromSuggestion(s: BindingSuggestion) {
    const title = suggestionTitles[s.ampInstanceId] || s.suggestedTitle;
    if (!title || !s.host || !s.port) {
      takeSuggestion(s);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await persist(bodyFromDraft(draftFromSuggestion(s, title)), null);
      setMessage(t("admin.amp.bindings.saved"));
      await Promise.all([loadBindings(), loadFromAmp()]);
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  async function createAllMatched() {
    const open = suggestions.filter(
      (s) => !s.existingBindingId && (suggestionTitles[s.ampInstanceId] || s.suggestedTitle) && s.host && s.port
    );
    if (open.length === 0) return;
    setBusy(true);
    setError("");
    let created = 0;
    try {
      for (const s of open) {
        const title = suggestionTitles[s.ampInstanceId] || (s.suggestedTitle as string);
        await persist(bodyFromDraft(draftFromSuggestion(s, title)), null);
        created += 1;
      }
      setMessage(t("admin.amp.bindings.createdMany", { count: created }));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setBusy(false);
      await Promise.all([loadBindings(), loadFromAmp()]);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await persist(bodyFromDraft(draft), editingId);
      setMessage(t("admin.amp.bindings.saved"));
      cancelEdit();
      await Promise.all([loadBindings(), loadFromAmp()]);
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
      await Promise.all([loadBindings(), loadFromAmp()]);
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  const openSuggestions = suggestions.filter((s) => !s.existingBindingId);
  const readyCount = openSuggestions.filter(
    (s) => (suggestionTitles[s.ampInstanceId] || s.suggestedTitle) && s.host && s.port
  ).length;

  return (
    <section className="admin-ops" aria-label={t("admin.amp.bindings.title")}>
      <header className="admin-section-head">
        <p className="eyebrow">{t("admin.amp.title")}</p>
        <h2>{t("admin.amp.bindings.title")}</h2>
      </header>
      <p className="muted">{t("admin.amp.bindings.help")}</p>

      <h3>{t("admin.amp.suggestions.title")}</h3>
      <p className="muted">{t("admin.amp.suggestions.help")}</p>
      {ampLoading ? <p className="muted">{t("admin.amp.suggestions.loading")}</p> : null}
      {ampError ? (
        <>
          <p className="error" role="alert">
            {ampError}
          </p>
          <div className="action-row">
            <button type="button" className="ghost" onClick={() => void loadFromAmp()}>
              {t("admin.amp.suggestions.reload")}
            </button>
          </div>
        </>
      ) : null}
      {!ampLoading && !ampError && openSuggestions.length === 0 ? (
        <p className="muted">{t("admin.amp.suggestions.none")}</p>
      ) : null}
      {openSuggestions.length > 0 ? (
        <>
          <table className="admin-table admin-table--suggestions">
            <thead>
              <tr>
                <th>{t("admin.amp.bindings.instance")}</th>
                <th>{t("admin.amp.bindings.displayTitle")}</th>
                <th>{t("admin.amp.bindings.endpoint")}</th>
                <th>{t("admin.amp.bindings.scheme")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {openSuggestions.map((s) => {
                const chosen = suggestionTitles[s.ampInstanceId] ?? s.suggestedTitle ?? "";
                return (
                  <tr key={s.ampInstanceId}>
                    <td>
                      {s.targetName ? `${s.targetName} · ` : ""}
                      {s.moduleDisplayName || s.friendlyName}
                      <br />
                      <small className="muted">{s.ampInstanceName}</small>
                    </td>
                    <td>
                      <select
                        value={chosen}
                        aria-label={t("admin.amp.suggestions.pickTitle")}
                        onChange={(event) =>
                          setSuggestionTitles((prev) => ({ ...prev, [s.ampInstanceId]: event.target.value }))
                        }
                      >
                        <option value="">{t("admin.amp.suggestions.noMatch")}</option>
                        {gameCatalog.map((title) => (
                          <option key={title} value={title}>
                            {title}
                            {s.catalogMatches.includes(title) ? " ✓" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {s.host || "?"}:{s.port ?? "?"}
                    </td>
                    <td>{s.connectScheme}</td>
                    <td>
                      <button
                        type="button"
                        disabled={busy || !chosen || !s.host || !s.port}
                        onClick={() => void createFromSuggestion(s)}
                      >
                        {t("admin.amp.suggestions.create")}
                      </button>{" "}
                      <button type="button" className="ghost" onClick={() => takeSuggestion(s)}>
                        {t("admin.amp.suggestions.edit")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="action-row">
            <button type="button" disabled={busy || readyCount === 0} onClick={() => void createAllMatched()}>
              {t("admin.amp.suggestions.createAll", { count: readyCount })}
            </button>
            <button type="button" className="ghost" disabled={ampLoading} onClick={() => void loadFromAmp()}>
              {t("admin.amp.suggestions.reload")}
            </button>
          </div>
        </>
      ) : null}

      <h3>{t("admin.amp.bindings.existing")}</h3>
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
              <th>{t("admin.amp.bindings.autoStopColumn")}</th>
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
                <td>{binding.autoStopEnabled ? "✓" : "–"}</td>
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
                {inst.moduleDisplayName || inst.friendlyName}
                {inst.gamePort ? ` (:${inst.gamePort})` : ""}
              </option>
            ))}
          </select>
        </label>
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
            <option value="ut2004">{t("admin.amp.bindings.scheme.ut2004")}</option>
            <option value="factorio">{t("admin.amp.bindings.scheme.factorio")}</option>
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
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={draft.autoStopEnabled}
            aria-describedby="amp-binding-autostop-hint"
            onChange={(event) => setDraft({ ...draft, autoStopEnabled: event.target.checked })}
          />
          {t("admin.amp.bindings.autoStop")}
        </label>
        <p className="muted field-hint" id="amp-binding-autostop-hint">
          {t("admin.amp.bindings.autoStopHint")}
        </p>
        <div className="action-row">
          <button type="submit" disabled={busy}>
            {t("admin.amp.bindings.save")}
          </button>
          {editingId || draft.ampInstanceId ? (
            <button type="button" className="ghost" onClick={cancelEdit}>
              {t("admin.amp.bindings.cancel")}
            </button>
          ) : null}
        </div>
        {message ? <p className="muted">{message}</p> : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
