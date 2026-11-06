import React, { useMemo } from "react";
import type { GameEvent } from "../types/core";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/catalog/index";
import { Cod4KeyGenerator } from "../cod4/Cod4KeyGenerator";
import { isCod4Game } from "../cod4/isCod4Game";
import { ServerPanel, type ServerPanelBinding } from "../gameservers/ServerPanel";
import { MoreMenu } from "./MoreMenu";
import {
  capacityPercent,
  getEventStatusBadgeModifier,
  getEventStatusClass,
  toDatetimeLocal
} from "../lib/event-format";

interface EventCardProps {
  event: GameEvent;
  /** Steuert, ob das Panel „Details & Server“ unter der Zeile aufgeklappt ist. */
  expanded: boolean;
  canManage: boolean;
  canSoftDelete: boolean;
  joinDisabled: boolean;
  /** P3 (HCI-110): Zeile trägt ein Auswahlkästchen für die Mehrfachauswahl (nur mit `rounds.manage`). */
  selectable: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  editedStartsAt: string | undefined;
  onToggleExpand: () => void;
  onEditedStartsAtChange: (value: string) => void;
  onJoin: () => void;
  onDecline: () => void;
  onUpdateStart: () => void;
  onArchive: () => void;
  onCancel: () => void;
  onSoftDelete: () => void;
  /** Phase 15: gebundener Server (undefined = Modul aus oder Event ohne Bindung). */
  server?: ServerPanelBinding;
}

/**
 * Zeile im Runden-Board (`.device-list` / `.device-row`). Beitreten/Doch-nicht und – für Orga –
 * Archivieren sitzen direkt in der Zeile; seltene Aktionen (Details & Server, Startzeit ändern,
 * Absagen) stecken hinter „Mehr“. Die Zeile ist bewusst kein `<button>` mehr (HCI-109): sie trägt
 * mehrere eigenständige Bedienelemente, und ein Knopf im Knopf ist nicht zulässig.
 */
export function EventCard({
  event,
  expanded,
  canManage,
  canSoftDelete,
  joinDisabled,
  selectable,
  selected,
  onToggleSelected,
  editedStartsAt,
  onToggleExpand,
  onEditedStartsAtChange,
  onJoin,
  onDecline,
  onUpdateStart,
  onArchive,
  onCancel,
  onSoftDelete,
  server
}: EventCardProps) {
  const { t, locale } = useI18n();
  const dateTag = locale === "en" ? "en-US" : "de-DE";
  const relFormatter = useMemo(
    () => new Intl.RelativeTimeFormat(locale === "en" ? "en" : "de", { numeric: "auto" }),
    [locale]
  );

  function getEventStatusLabel(): string {
    if (
      event.status !== "archived" &&
      event.status !== "cancelled" &&
      event.joinedCount >= event.maxPlayers
    ) {
      return t("events.status.full");
    }
    const labels: Record<GameEvent["status"], MessageKey> = {
      open: "events.status.open",
      ready: "events.status.ready",
      running: "events.status.running",
      cancelled: "events.status.cancelled",
      archived: "events.status.archived"
    };
    return t(labels[event.status]);
  }

  function formatStartRelative(iso: string): string {
    const startMs = new Date(iso).getTime();
    const diffSec = Math.round((startMs - Date.now()) / 1000);
    const abs = Math.abs(diffSec);
    if (abs < 60) {
      return relFormatter.format(diffSec, "second");
    }
    if (abs < 3600) {
      return relFormatter.format(Math.round(diffSec / 60), "minute");
    }
    if (abs < 172_800) {
      return relFormatter.format(Math.round(diffSec / 3600), "hour");
    }
    return relFormatter.format(Math.round(diffSec / 86_400), "day");
  }

  function minPlayersGapHint(): string | null {
    if (event.status === "archived" || event.status === "cancelled") {
      return null;
    }
    const gap = event.minPlayers - event.joinedCount;
    if (gap <= 0) {
      return t("events.minMet");
    }
    if (gap === 1) {
      return t("events.minOne");
    }
    return t("events.minN", { n: gap });
  }

  const isActive = event.status !== "archived" && event.status !== "cancelled";
  const isJoined = event.myParticipation === "joined";
  const isDeclined = event.myParticipation === "declined";
  const statusLabel = getEventStatusLabel();
  const badgeModifier = getEventStatusBadgeModifier(event);
  const panelId = `event-details-${event.id}`;
  const detailsTriggerId = `event-details-trigger-${event.id}`;

  const participationLabel = isJoined ? t("events.action.decline") : t("events.action.join");
  const participationHandler = isJoined ? onDecline : onJoin;
  const participationDisabled = !isJoined && joinDisabled;

  return (
    <li
      className={`device-row event-row${selectable ? " device-row--selectable" : ""}${
        selectable && selected ? " device-row--selected" : ""
      }`}
    >
      {selectable ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          aria-label={t("events.bulk.selectRound", { title: event.gameTitle })}
        />
      ) : null}
      <div>
        <p className="item-title">
          <strong>{event.gameTitle}</strong>
          <span className={`badge${badgeModifier ? ` ${badgeModifier}` : ""}`}>{statusLabel}</span>
          {isJoined ? <span className="badge badge--ok">{t("events.part.joined")}</span> : null}
          {isDeclined ? <span className="badge">{t("events.part.declined")}</span> : null}
        </p>
        <p className="item-sub">
          {formatStartRelative(event.startsAt)} ·{" "}
          {t("events.capacity.players", { joined: event.joinedCount, max: event.maxPlayers })} ·{" "}
          {t("events.organizer")} {event.createdByUsername}
        </p>
      </div>
      <div className="device-actions">
        {isActive ? (
          <button
            type="button"
            className={`participation-btn${isJoined ? " participation-btn--joined" : ""}`}
            onClick={participationHandler}
            disabled={participationDisabled}
          >
            {participationLabel}
          </button>
        ) : null}
        {canManage && isActive ? (
          <button type="button" className="secondary" onClick={onArchive}>
            {t("events.action.archive")}
          </button>
        ) : null}
        {canSoftDelete && !isActive ? (
          <button type="button" className="secondary danger" onClick={onSoftDelete}>
            {t("events.action.delete")}
          </button>
        ) : null}
        <MoreMenu label={t("events.action.more")}>
          <button
            type="button"
            className="secondary"
            id={detailsTriggerId}
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggleExpand}
          >
            {t("events.action.details")}
          </button>
          {canManage && isActive ? (
            <button
              type="button"
              className="secondary"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={onToggleExpand}
            >
              {t("events.action.editStart")}
            </button>
          ) : null}
          {canManage && isActive ? (
            <button type="button" className="secondary danger" onClick={onCancel}>
              {t("events.action.cancel")}
            </button>
          ) : null}
        </MoreMenu>
      </div>
      {expanded ? (
        <div
          className="event-row-details"
          id={panelId}
          role="region"
          aria-labelledby={detailsTriggerId}
          // In einer Auswahlzeile (.device-row--selectable) ist die Zeile ein 3-Spalten-Raster;
          // das Detailpanel muss über alle Spalten laufen, sonst landet es in der schmalen Kästchenspalte.
          style={selectable ? { gridColumn: "1 / -1" } : undefined}
        >
          <EventRowDetails
            event={event}
            t={t}
            dateTag={dateTag}
            gapHint={minPlayersGapHint()}
            canManage={canManage}
            isActive={isActive}
            editedStartsAt={editedStartsAt}
            onEditedStartsAtChange={onEditedStartsAtChange}
            onUpdateStart={onUpdateStart}
            server={server}
          />
        </div>
      ) : null}
    </li>
  );
}

interface EventRowDetailsProps {
  event: GameEvent;
  t: ReturnType<typeof useI18n>["t"];
  dateTag: string;
  gapHint: string | null;
  canManage: boolean;
  isActive: boolean;
  editedStartsAt: string | undefined;
  onEditedStartsAtChange: (value: string) => void;
  onUpdateStart: () => void;
  server?: ServerPanelBinding;
}

/** Inhalt von „Details & Server“: Belegung, Kennzahlen, Verbindung, Server – und bei Orga die Startzeit. */
function EventRowDetails({
  event,
  t,
  dateTag,
  gapHint,
  canManage,
  isActive,
  editedStartsAt,
  onEditedStartsAtChange,
  onUpdateStart,
  server
}: EventRowDetailsProps) {
  const startAbsolute = new Date(event.startsAt).toLocaleString(dateTag);
  const pct = capacityPercent(event);

  return (
    <>
      <div className="event-capacity-block">
        <div
          className="event-capacity-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={event.maxPlayers}
          aria-valuenow={event.joinedCount}
          aria-label={t("events.capacity.aria", {
            joined: event.joinedCount,
            max: event.maxPlayers
          })}
        >
          <div className="event-capacity-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="event-capacity-caption">
          <span className="event-capacity-count">
            {t("events.capacity.players", { joined: event.joinedCount, max: event.maxPlayers })}
          </span>
          {gapHint ? <span className="event-capacity-hint">{gapHint}</span> : null}
        </div>
      </div>
      <dl className="event-stats event-stats--pair">
        <div>
          <dt>{t("events.meta.min")}</dt>
          <dd>{event.minPlayers}</dd>
        </div>
        <div>
          <dt>{t("events.meta.startLocal")}</dt>
          <dd>
            {canManage && isActive ? (
              <div className="field-action-row">
                <label>
                  {t("events.meta.editStartLabel")}
                  <input
                    type="datetime-local"
                    value={editedStartsAt ?? toDatetimeLocal(event.startsAt)}
                    onChange={(change) => onEditedStartsAtChange(change.target.value)}
                  />
                </label>
                <button type="button" className="secondary" onClick={onUpdateStart}>
                  {t("events.action.saveStart")}
                </button>
              </div>
            ) : (
              <time dateTime={event.startsAt}>{startAbsolute}</time>
            )}
          </dd>
        </div>
      </dl>
      {event.details?.trim() ? (
        <div className="event-connection-details">
          <div className="event-conn-line">
            <span className="event-conn-label">{t("events.conn.details")}</span>
            <span className="event-conn-value">{event.details}</span>
          </div>
        </div>
      ) : (
        <p className="muted event-join-hint">{t("events.conn.missing")}</p>
      )}
      {server ? <ServerPanel {...server} /> : null}
      {isCod4Game(event.gameTitle) ? <Cod4KeyGenerator /> : null}
    </>
  );
}
