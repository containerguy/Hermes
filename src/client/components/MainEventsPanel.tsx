import React, { FormEvent, useEffect, useState } from "react";
import type { MainEvent } from "../types/core";
import {
  MainEventInfosEditor,
  MainEventParticipantList,
  MainEventRegistrationEditor,
  MainEventServersEditor
} from "./MainEventRegistration";
import { eventShareText, MainEventBroadcast, whatsappShareUrl } from "./MainEventBroadcast";
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

const emptyDraft = {
  name: "",
  description: "",
  plannedStartAt: "",
  plannedEndAt: "",
  maxParticipants: "",
  registrationDeadline: "",
  private: false
};

/**
 * Seite „Events“: alle sichtbaren Events mit eigener Teilnahme. Manager und Admins legen hier
 * außerdem Events an, starten und beenden sie und verwalten Einladungen.
 */
export function MainEventsPanel({
  canManage = true,
  canManageEvent,
  showInfosLink = false
}: {
  /** Globales Recht: Events anlegen und alle verwalten. */
  canManage?: boolean;
  /** Recht für ein einzelnes Event (auch per Event-Vergabe). */
  canManageEvent?: (mainEventId: string) => boolean;
  /** Link zur Unterseite „Infos" zeigen (Admin hat den allgemeinen Infotext eingeschaltet). */
  showInfosLink?: boolean;
}) {
  const manages = (mainEventId: string) => canManage || Boolean(canManageEvent?.(mainEventId));
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

  const managesAny = mainEvents.some((entry) => manages(entry.id));

  useEffect(() => {
    if (!managesAny || !hasPrivate || candidates.length > 0) {
      return;
    }
    requestJson<{ users: Array<{ id: string; username: string }> }>("/api/main-events/invite-candidates")
      .then((result) => setCandidates(result?.users ?? []))
      .catch(() => undefined);
  }, [hasPrivate, managesAny]);

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
          plannedEndAt: draft.plannedEndAt ? fromDatetimeLocal(draft.plannedEndAt) : null,
          maxParticipants: draft.maxParticipants.trim() ? Number(draft.maxParticipants) : null,
          registrationDeadline: draft.registrationDeadline ? fromDatetimeLocal(draft.registrationDeadline) : null
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

  async function saveRegistration(
    mainEvent: MainEvent,
    changes: { maxParticipants: number | null; registrationDeadline: string | null; remindersEnabled: boolean }
  ) {
    await run(
      () =>
        requestJson<{ mainEvent: MainEvent }>(`/api/main-events/${mainEvent.id}`, {
          method: "PATCH",
          body: JSON.stringify(changes)
        }),
      "mainEvents.msg.registration"
    );
  }

  async function saveInfos(mainEvent: MainEvent, infosMarkdown: string | null) {
    await run(
      () =>
        requestJson<{ mainEvent: MainEvent }>(`/api/main-events/${mainEvent.id}`, {
          method: "PATCH",
          body: JSON.stringify({ infosMarkdown })
        }),
      "mainEvents.msg.infos"
    );
  }

  async function saveServers(mainEvent: MainEvent, bindingIds: string[]) {
    await run(
      () =>
        requestJson<{ mainEvent: MainEvent }>(`/api/main-events/${mainEvent.id}/servers`, {
          method: "PUT",
          body: JSON.stringify({ bindingIds })
        }),
      "mainEvents.msg.servers"
    );
  }

  /** Text zum eigenen Anmeldestatus; Nachrücker sehen ihren Platz in der Liste. */
  function participationText(mainEvent: MainEvent) {
    switch (mainEvent.myParticipation) {
      case "joined":
        return t("mainEvents.participation.joined");
      case "interested":
        return t("mainEvents.participation.interested");
      case "waitlisted":
        return t("mainEvents.participation.waitlisted", { n: mainEvent.myWaitlistPosition ?? 1 });
      case "declined":
        return t("mainEvents.participation.declined");
      default:
        return t("mainEvents.participation.open");
    }
  }

  async function setParticipation(mainEvent: MainEvent, status: "joined" | "interested" | "declined") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await requestJson<{ mainEvent: MainEvent }>(`/api/main-events/${mainEvent.id}/participation`, {
        method: "POST",
        body: JSON.stringify({ status })
      });
      await load();
      // Bei vollem Event wird aus der Zusage ein Nachrückerplatz: das sagen wir deutlich.
      const updated = result?.mainEvent;
      setMessage(
        updated?.myParticipation === "waitlisted"
          ? t("mainEvents.participation.waitlistedShort", { n: updated.myWaitlistPosition ?? 1 })
          : updated
            ? participationText(updated)
            : ""
      );
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  // Laufende zuerst, dann geplante, beendete zuletzt — innerhalb gleicher Reihenfolge wie vom Server.
  const statusOrder: Record<MainEvent["status"], number> = { running: 0, planned: 1, ended: 2 };
  const sorted = [...mainEvents].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  return (
    <section className="main-events-panel" aria-label={canManage ? t("mainEvents.aria") : t("mainEvents.ariaList")}>
      {canManage ? <p className="muted">{t("mainEvents.intro")}</p> : null}
      {showInfosLink ? (
        <a className="text-link main-events-infos-link" href="#main-events/infos">
          {t("mainEvents.infosLink")}
        </a>
      ) : null}
      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <ul className="main-events-list">
        {sorted.map((mainEvent) => {
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
                {mainEvent.maxParticipants !== null
                  ? t("mainEvents.seats", { n: mainEvent.participantCount, max: mainEvent.maxParticipants })
                  : mainEvent.participantCount === 1
                    ? t("mainEvents.participants.one")
                    : t("mainEvents.participants.many", { n: mainEvent.participantCount })}
                {mainEvent.waitlistCount > 0 ? ` · ${t("mainEvents.waitlist", { n: mainEvent.waitlistCount })}` : null}
                {mainEvent.interestedCount > 0
                  ? ` · ${t("mainEvents.interested", { n: mainEvent.interestedCount })}`
                  : null}
                {mainEvent.status === "planned" && planned ? ` · ${t("mainEvents.planned", { range: planned })}` : null}
                {mainEvent.status === "running" && mainEvent.startedAt
                  ? ` · ${t("mainEvents.startedAt", { at: formatDate(mainEvent.startedAt) })}`
                  : null}
                {mainEvent.status === "ended" && mainEvent.endedAt
                  ? ` · ${t("mainEvents.endedAt", { at: formatDate(mainEvent.endedAt) })}`
                  : null}
              </p>
              {mainEvent.status === "planned" && mainEvent.registrationDeadline ? (
                <p className={mainEvent.registrationClosed ? "muted main-event-deadline closed" : "muted main-event-deadline"}>
                  {mainEvent.registrationClosed
                    ? t("mainEvents.deadlinePassed", { at: formatDate(mainEvent.registrationDeadline) })
                    : t("mainEvents.deadline", { at: formatDate(mainEvent.registrationDeadline) })}
                </p>
              ) : null}
              {mainEvent.status !== "ended" ? (
                <div className="action-row main-event-participation">
                  <span className="toolbar-hint">{participationText(mainEvent)}</span>
                  {mainEvent.myParticipation !== "joined" && mainEvent.myParticipation !== "waitlisted" ? (
                    <button
                      type="button"
                      disabled={busy || mainEvent.registrationClosed}
                      onClick={() => setParticipation(mainEvent, "joined")}
                    >
                      {t("mainEvents.participation.join")}
                    </button>
                  ) : null}
                  {/* Nachrücker behalten ihren Listenplatz: kein „Interessiert“, das sie stillschweigend von der Liste nimmt. */}
                  {mainEvent.myParticipation === null || mainEvent.myParticipation === "declined" ? (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy || mainEvent.registrationClosed}
                      onClick={() => setParticipation(mainEvent, "interested")}
                    >
                      {t("mainEvents.participation.interest")}
                    </button>
                  ) : null}
                  {mainEvent.myParticipation !== "declined" ? (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => setParticipation(mainEvent, "declined")}
                    >
                      {t("mainEvents.participation.decline")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {manages(mainEvent.id) && mainEvent.visibility === "private" && mainEvent.status !== "ended" ? (
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
              {manages(mainEvent.id) && mainEvent.status !== "ended" ? (
                <MainEventRegistrationEditor
                  key={`${mainEvent.id}-${mainEvent.maxParticipants}-${mainEvent.registrationDeadline}-${mainEvent.remindersEnabled}`}
                  mainEvent={mainEvent}
                  busy={busy}
                  onSave={(changes) => saveRegistration(mainEvent, changes)}
                />
              ) : null}
              {manages(mainEvent.id) && mainEvent.status !== "ended" ? (
                <MainEventInfosEditor
                  key={`${mainEvent.id}-infos-${mainEvent.infosMarkdown ?? ""}`}
                  mainEvent={mainEvent}
                  busy={busy}
                  onSave={(infosMarkdown) => saveInfos(mainEvent, infosMarkdown)}
                />
              ) : null}
              {manages(mainEvent.id) && mainEvent.status !== "ended" ? (
                <MainEventServersEditor
                  key={`${mainEvent.id}-servers-${(mainEvent.serverBindingIds ?? []).join(",")}`}
                  mainEvent={mainEvent}
                  busy={busy}
                  onSave={(bindingIds) => saveServers(mainEvent, bindingIds)}
                />
              ) : null}
              {manages(mainEvent.id) ? <MainEventParticipantList mainEvent={mainEvent} /> : null}
              {manages(mainEvent.id) ? <MainEventBroadcast mainEvent={mainEvent} /> : null}
              {mainEvent.plannedStartAt && mainEvent.status !== "ended" ? (
                <a className="button-link secondary calendar-download" href={`/api/main-events/${mainEvent.id}/calendar.ics`} download>
                  {t("mainEvents.calendarDownload")}
                </a>
              ) : null}
              {mainEvent.status !== "ended" ? (
                <a
                  className="button-link secondary whatsapp-share"
                  href={whatsappShareUrl(eventShareText(mainEvent, planned || null))}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("mainEvents.shareWhatsapp")}
                </a>
              ) : null}
              {manages(mainEvent.id) ? (
              <div className="action-row">
                {mainEvent.status === "planned" ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
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
              ) : null}
            </li>
          );
        })}
        {mainEvents.length === 0 ? <li className="muted">{t("mainEvents.empty")}</li> : null}
      </ul>
      {canManage ? (
      <details className="main-events-create">
      <summary>{t("mainEvents.form.toggle")}</summary>
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
        <div className="form-grid">
          <label>
            {t("mainEvents.form.maxParticipants")}
            <input
              type="number"
              min={1}
              max={10000}
              value={draft.maxParticipants}
              onChange={(ev) => setDraft({ ...draft, maxParticipants: ev.target.value })}
            />
          </label>
          <label>
            {t("mainEvents.form.registrationDeadline")}
            <input
              type="datetime-local"
              value={draft.registrationDeadline}
              onChange={(ev) => setDraft({ ...draft, registrationDeadline: ev.target.value })}
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
      ) : null}
    </section>
  );
}
