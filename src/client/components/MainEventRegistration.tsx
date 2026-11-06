import React, { useEffect, useState } from "react";
import type { GameServerBinding, MainEvent, MainEventParticipantOverview, MainEventParticipation } from "../types/core";
import { requestJson } from "../api/request";
import { getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/catalog/index";
import { fromDatetimeLocal, toDatetimeLocal } from "../lib/event-format";

/** Plätze und Anmeldeschluss eines bestehenden Events ändern (Manager/Admin). */
export function MainEventRegistrationEditor({
  mainEvent,
  busy,
  onSave
}: {
  mainEvent: MainEvent;
  busy: boolean;
  onSave: (changes: {
    maxParticipants: number | null;
    registrationDeadline: string | null;
    remindersEnabled: boolean;
  }) => void;
}) {
  const { t } = useI18n();
  const [maxParticipants, setMaxParticipants] = useState(
    mainEvent.maxParticipants === null ? "" : String(mainEvent.maxParticipants)
  );
  const [deadline, setDeadline] = useState(
    mainEvent.registrationDeadline ? toDatetimeLocal(mainEvent.registrationDeadline) : ""
  );
  const [reminders, setReminders] = useState(mainEvent.remindersEnabled !== false);

  return (
    <div className="main-event-registration">
      <h3>{t("mainEvents.registration.toggle")}</h3>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            maxParticipants: maxParticipants.trim() ? Number(maxParticipants) : null,
            registrationDeadline: deadline ? fromDatetimeLocal(deadline) : null,
            remindersEnabled: reminders
          });
        }}
      >
        <label>
          {t("mainEvents.form.maxParticipants")}
          <input
            type="number"
            min={1}
            max={10000}
            value={maxParticipants}
            onChange={(event) => setMaxParticipants(event.target.value)}
          />
        </label>
        <label>
          {t("mainEvents.form.registrationDeadline")}
          <input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={reminders} onChange={(event) => setReminders(event.target.checked)} />
          {t("mainEvents.form.reminders")}
        </label>
        <button type="submit" className="secondary" disabled={busy}>
          {t("mainEvents.registration.save")}
        </button>
      </form>
    </div>
  );
}

const overviewGroups: Array<{ status: MainEventParticipation; label: MessageKey }> = [
  { status: "joined", label: "mainEvents.overview.status.joined" },
  { status: "waitlisted", label: "mainEvents.overview.status.waitlisted" },
  { status: "interested", label: "mainEvents.overview.status.interested" },
  { status: "declined", label: "mainEvents.overview.status.declined" }
];

function personLabel(person: { username: string; displayName: string | null }) {
  return person.displayName && person.displayName !== person.username
    ? `${person.displayName} (${person.username})`
    : person.username;
}

/** Anmeldeübersicht für Manager: lädt beim Aufklappen, mit CSV-Download. */
export function MainEventParticipantList({ mainEvent }: { mainEvent: MainEvent }) {
  const { t, locale } = useI18n();
  const [overview, setOverview] = useState<MainEventParticipantOverview | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setOverview(
        await requestJson<MainEventParticipantOverview>(`/api/main-events/${mainEvent.id}/participants`)
      );
      setError("");
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  return (
    <details
      className="main-event-overview"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) {
          void load();
        }
      }}
    >
      <summary>{t("mainEvents.overview.toggle")}</summary>
      {error ? <p className="error">{error}</p> : null}
      {overview ? (
        <div className="main-event-overview-body">
          {overview.participants.length === 0 ? <p className="empty-state">{t("mainEvents.overview.empty")}</p> : null}
          {overviewGroups.map((group) => {
            const people = overview.participants.filter((person) => person.status === group.status);
            if (people.length === 0) {
              return null;
            }
            return (
              <div key={group.status}>
                <p className="muted">{t(group.label, { n: people.length })}</p>
                <ul>
                  {people.map((person) => (
                    <li key={person.userId}>
                      {person.waitlistPosition ? `${person.waitlistPosition}. ` : ""}
                      {personLabel(person)}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {overview.noResponse.length > 0 ? (
            <div>
              <p className="muted">{t("mainEvents.overview.noResponse", { n: overview.noResponse.length })}</p>
              <ul>
                {overview.noResponse.map((person) => (
                  <li key={person.userId}>{personLabel(person)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <a className="button-link" href={`/api/main-events/${mainEvent.id}/participants.csv`} download>
            {t("mainEvents.overview.csv")}
          </a>
        </div>
      ) : null}
    </details>
  );
}

/** Infos zum Event (Anfahrt, WLAN, Ablauf …) als Markdown; erscheinen auf der Seite „Infos“. */
export function MainEventInfosEditor({
  mainEvent,
  busy,
  onSave
}: {
  mainEvent: MainEvent;
  busy: boolean;
  onSave: (infosMarkdown: string | null) => void;
}) {
  const { t } = useI18n();
  const [markdown, setMarkdown] = useState(mainEvent.infosMarkdown ?? "");

  return (
    <details className="main-event-infos-editor">
      <summary>{t("mainEvents.infos.toggle")}</summary>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(markdown.trim() ? markdown : null);
        }}
      >
        <label>
          {t("mainEvents.infos.label")}
          <textarea rows={8} value={markdown} onChange={(ev) => setMarkdown(ev.target.value)} />
        </label>
        <p className="muted">{t("mainEvents.infos.help")}</p>
        <button type="submit" disabled={busy}>
          {t("mainEvents.infos.save")}
        </button>
      </form>
    </details>
  );
}

/** Gameserver, die das Event anbietet (keiner angekreuzt = alle). Nur sichtbar, wenn es Server gibt. */
export function MainEventServersEditor({
  mainEvent,
  busy,
  onSave
}: {
  mainEvent: MainEvent;
  busy: boolean;
  onSave: (bindingIds: string[]) => void;
}) {
  const { t } = useI18n();
  const [bindings, setBindings] = useState<GameServerBinding[]>([]);
  const [selected, setSelected] = useState<string[]>(mainEvent.serverBindingIds ?? []);

  useEffect(() => {
    let cancelled = false;
    requestJson<{ bindings: GameServerBinding[] }>("/api/integrations/amp/bindings")
      .then((result) => {
        if (!cancelled) setBindings(result?.bindings ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (bindings.length === 0) return null;

  return (
    <details className="main-event-servers">
      <summary>{t("mainEvents.servers.toggle")}</summary>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(selected);
        }}
      >
        <p className="muted">{t("mainEvents.servers.help")}</p>
        {bindings.map((binding) => (
          <label key={binding.id} className="checkbox-label">
            <input
              type="checkbox"
              checked={selected.includes(binding.id)}
              onChange={(ev) =>
                setSelected(
                  ev.target.checked ? [...selected, binding.id] : selected.filter((id) => id !== binding.id)
                )
              }
            />
            {binding.displayTitle} ({binding.ampInstanceName})
          </label>
        ))}
        <button type="submit" disabled={busy}>
          {t("mainEvents.servers.save")}
        </button>
      </form>
    </details>
  );
}
