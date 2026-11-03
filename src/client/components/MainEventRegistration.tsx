import React, { useState } from "react";
import type { MainEvent, MainEventParticipantOverview, MainEventParticipation } from "../types/core";
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
  onSave: (changes: { maxParticipants: number | null; registrationDeadline: string | null }) => void;
}) {
  const { t } = useI18n();
  const [maxParticipants, setMaxParticipants] = useState(
    mainEvent.maxParticipants === null ? "" : String(mainEvent.maxParticipants)
  );
  const [deadline, setDeadline] = useState(
    mainEvent.registrationDeadline ? toDatetimeLocal(mainEvent.registrationDeadline) : ""
  );

  return (
    <details className="main-event-registration">
      <summary>{t("mainEvents.registration.toggle")}</summary>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            maxParticipants: maxParticipants.trim() ? Number(maxParticipants) : null,
            registrationDeadline: deadline ? fromDatetimeLocal(deadline) : null
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
        <button type="submit" className="secondary" disabled={busy}>
          {t("mainEvents.registration.save")}
        </button>
      </form>
    </details>
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
          {overview.participants.length === 0 ? <p className="muted">{t("mainEvents.overview.empty")}</p> : null}
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
