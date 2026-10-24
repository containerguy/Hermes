import React, { FormEvent, useEffect, useState } from "react";
import type { MainEvent } from "../types/core";
import { requestJson } from "../api/request";
import { getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/catalog/index";
import { fromDatetimeLocal } from "../lib/event-format";
import { subscribeEventsChanged } from "../realtime/events-changed-bus";

const statusLabels: Record<MainEvent["status"], MessageKey> = {
  planned: "mainEvents.status.planned",
  running: "mainEvents.status.running",
  ended: "mainEvents.status.ended"
};

/** Farben der bestehenden Status-Pills wiederverwenden. */
const statusClasses: Record<MainEvent["status"], string> = {
  planned: "open",
  running: "running",
  ended: "archived"
};

const emptyDraft = { name: "", description: "", plannedStartAt: "", plannedEndAt: "", private: false };

/** Events (LAN-Party, Turniertag) anlegen, starten, beenden — für Manager und Admins. */
export function MainEventsPanel() {
  const { t, locale } = useI18n();
  const dateFormatter = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "de-DE", {
    dateStyle: "medium",
    timeStyle: "short"
  });
  const [mainEvents, setMainEvents] = useState<MainEvent[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Array<{ id: string; username: string }>>([]);
  const [inviteDrafts, setInviteDrafts] = useState<Record<string, string>>({});

  async function load() {
    const result = await requestJson<{ mainEvents: MainEvent[] }>("/api/main-events");
    setMainEvents(result?.mainEvents ?? []);
  }

  const hasPrivate = mainEvents.some((entry) => entry.visibility === "private" && entry.status !== "ended");

  useEffect(() => {
    if (!hasPrivate || candidates.length > 0) {
      return;
    }
    requestJson<{ users: Array<{ id: string; username: string }> }>("/api/main-events/invite-candidates")
      .then((result) => setCandidates(result?.users ?? []))
      .catch(() => undefined);
  }, [hasPrivate]);

  useEffect(() => {
    load().catch(() => undefined);
    return subscribeEventsChanged(() => {
      load().catch(() => undefined);
    });
  }, []);

  function formatDate(iso: string | null) {
    return iso ? dateFormatter.format(new Date(iso)) : "";
  }

  async function run(action: () => Promise<unknown>, success: MessageKey) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      await load();
      setMessage(t(success));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  async function createMainEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await requestJson<{ mainEvent: MainEvent }>("/api/main-events", {
        method: "POST",
        body: JSON.stringify({
          name: draft.name,
          description: draft.description.trim() || null,
          visibility: draft.private ? "private" : "public",
          plannedStartAt: draft.plannedStartAt ? fromDatetimeLocal(draft.plannedStartAt) : null,
          plannedEndAt: draft.plannedEndAt ? fromDatetimeLocal(draft.plannedEndAt) : null
        })
      });
      setDraft(emptyDraft);
    }, "mainEvents.msg.created");
  }

  async function changeStatus(mainEvent: MainEvent, action: "start" | "end" | "delete") {
    const confirmKey: MessageKey =
      action === "start"
        ? "mainEvents.confirm.start"
        : action === "end"
          ? "mainEvents.confirm.end"
          : "mainEvents.confirm.delete";
    if (!window.confirm(t(confirmKey, { name: mainEvent.name }))) {
      return;
    }

    await run(
      () =>
        action === "delete"
          ? requestJson<void>(`/api/main-events/${mainEvent.id}`, { method: "DELETE" })
          : requestJson<{ mainEvent: MainEvent }>(`/api/main-events/${mainEvent.id}/${action}`, {
              method: "POST"
            }),
      action === "start" ? "mainEvents.msg.started" : action === "end" ? "mainEvents.msg.ended" : "mainEvents.msg.deleted"
    );
  }

  async function invite(mainEvent: MainEvent) {
    const userId = inviteDrafts[mainEvent.id];
    if (!userId) {
      return;
    }
    await run(async () => {
      await requestJson<{ mainEvent: MainEvent }>(`/api/main-events/${mainEvent.id}/invites`, {
        method: "POST",
        body: JSON.stringify({ userIds: [userId] })
      });
      setInviteDrafts((drafts) => ({ ...drafts, [mainEvent.id]: "" }));
    }, "mainEvents.msg.invited");
  }

  async function uninvite(mainEvent: MainEvent, userId: string) {
    await run(
      () => requestJson<{ mainEvent: MainEvent }>(`/api/main-events/${mainEvent.id}/invites/${userId}`, { method: "DELETE" }),
      "mainEvents.msg.uninvited"
    );
  }

  async function toggleVisibility(mainEvent: MainEvent) {
    const next = mainEvent.visibility === "private" ? "public" : "private";
    const confirmKey: MessageKey = next === "private" ? "mainEvents.confirm.makePrivate" : "mainEvents.confirm.makePublic";
    if (!window.confirm(t(confirmKey, { name: mainEvent.name }))) {
      return;
    }
    await run(
      () =>
        requestJson<{ mainEvent: MainEvent }>(`/api/main-events/${mainEvent.id}`, {
          method: "PATCH",
          body: JSON.stringify({ visibility: next })
        }),
      "mainEvents.msg.visibility"
    );
  }

  const running = mainEvents.find((entry) => entry.status === "running");

  return (
    <details className="main-events-panel" aria-label={t("mainEvents.aria")}>
      <summary>
        <span className="eyebrow">{t("mainEvents.eyebrow")}</span>
        <span className="main-events-summary">
          {running ? t("mainEvents.running", { name: running.name }) : t("mainEvents.title")}
        </span>
      </summary>
      <p className="muted">{t("mainEvents.intro")}</p>
      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <ul className="main-events-list">
        {mainEvents.map((mainEvent) => {
          const planned = [formatDate(mainEvent.plannedStartAt), formatDate(mainEvent.plannedEndAt)]
            .filter(Boolean)
            .join(" – ");
          return (
            <li key={mainEvent.id} className={`main-event main-event-${mainEvent.status}`}>
              <div className="main-event-header">
                <span className="main-event-title">
                  <strong>{mainEvent.name}</strong>
                  {mainEvent.visibility === "private" ? (
                    <span className="status-pill status-cancelled">{t("mainEvents.private")}</span>
                  ) : null}
                </span>
                <span className={`status-pill status-${statusClasses[mainEvent.status]}`}>
                  {t(statusLabels[mainEvent.status])}
                </span>
              </div>
              {mainEvent.description ? <p className="muted">{mainEvent.description}</p> : null}
              <p className="muted main-event-meta">
                {mainEvent.roundCount === 1
                  ? t("mainEvents.rounds.one")
                  : t("mainEvents.rounds.many", { n: mainEvent.roundCount })}
                {" · "}
                {mainEvent.participantCount === 1
                  ? t("mainEvents.participants.one")
                  : t("mainEvents.participants.many", { n: mainEvent.participantCount })}
                {mainEvent.status === "planned" && planned ? ` · ${t("mainEvents.planned", { range: planned })}` : null}
                {mainEvent.status === "running" && mainEvent.startedAt
                  ? ` · ${t("mainEvents.startedAt", { at: formatDate(mainEvent.startedAt) })}`
                  : null}
                {mainEvent.status === "ended" && mainEvent.endedAt
                  ? ` · ${t("mainEvents.endedAt", { at: formatDate(mainEvent.endedAt) })}`
                  : null}
              </p>
              {mainEvent.visibility === "private" && mainEvent.status !== "ended" ? (
                <div className="main-event-invites">
                  <p className="muted">{t("mainEvents.invites.title")}</p>
                  <ul>
                    {(mainEvent.invites ?? []).map((entry) => (
                      <li key={entry.userId}>
                        {entry.username}
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          aria-label={t("mainEvents.invites.removeAria", { name: entry.username })}
                          onClick={() => uninvite(mainEvent, entry.userId)}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                    {(mainEvent.invites ?? []).length === 0 ? <li className="muted">{t("mainEvents.invites.empty")}</li> : null}
                  </ul>
                  <div className="main-event-invite-form">
                    <select
                      aria-label={t("mainEvents.invites.pick")}
                      value={inviteDrafts[mainEvent.id] ?? ""}
                      onChange={(ev) => setInviteDrafts({ ...inviteDrafts, [mainEvent.id]: ev.target.value })}
                    >
                      <option value="">{t("mainEvents.invites.pick")}</option>
                      {candidates
                        .filter((candidate) => !(mainEvent.invites ?? []).some((entry) => entry.userId === candidate.id))
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.username}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy || !inviteDrafts[mainEvent.id]}
                      onClick={() => invite(mainEvent)}
                    >
                      {t("mainEvents.invites.add")}
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="action-row">
                {mainEvent.status === "planned" ? (
                  <>
                    <button
                      type="button"
                      disabled={busy || Boolean(running)}
                      onClick={() => changeStatus(mainEvent, "start")}
                    >
                      {t("mainEvents.action.start")}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => changeStatus(mainEvent, "delete")}
                    >
                      {t("mainEvents.action.delete")}
                    </button>
                  </>
                ) : null}
                {mainEvent.status !== "ended" ? (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => toggleVisibility(mainEvent)}
                  >
                    {mainEvent.visibility === "private"
                      ? t("mainEvents.action.makePublic")
                      : t("mainEvents.action.makePrivate")}
                  </button>
                ) : null}
                {mainEvent.status === "running" ? (
                  <button
                    type="button"
                    className="secondary danger"
                    disabled={busy}
                    onClick={() => changeStatus(mainEvent, "end")}
                  >
                    {t("mainEvents.action.end")}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
        {mainEvents.length === 0 ? <li className="muted">{t("mainEvents.empty")}</li> : null}
      </ul>
      <form onSubmit={createMainEvent} className="event-form" aria-label={t("mainEvents.form.aria")}>
        <label>
          {t("mainEvents.form.name")}
          <input
            value={draft.name}
            maxLength={120}
            required
            onChange={(ev) => setDraft({ ...draft, name: ev.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            {t("mainEvents.form.plannedStart")}
            <input
              type="datetime-local"
              value={draft.plannedStartAt}
              onChange={(ev) => setDraft({ ...draft, plannedStartAt: ev.target.value })}
            />
          </label>
          <label>
            {t("mainEvents.form.plannedEnd")}
            <input
              type="datetime-local"
              value={draft.plannedEndAt}
              onChange={(ev) => setDraft({ ...draft, plannedEndAt: ev.target.value })}
            />
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={draft.private}
            onChange={(ev) => setDraft({ ...draft, private: ev.target.checked })}
          />
          {t("mainEvents.form.private")}
        </label>
        <label>
          {t("mainEvents.form.description")}
          <textarea
            rows={2}
            value={draft.description}
            onChange={(ev) => setDraft({ ...draft, description: ev.target.value })}
          />
        </label>
        <button type="submit" disabled={busy}>
          {t("mainEvents.form.submit")}
        </button>
      </form>
    </details>
  );
}
