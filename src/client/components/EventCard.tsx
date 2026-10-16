import React, { useMemo } from "react";
import type { GameEvent } from "../types/core";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/catalog/index";
import { Cod4KeyGenerator } from "../cod4/Cod4KeyGenerator";
import { isCod4Game } from "../cod4/isCod4Game";
import { ServerPanel, type ServerPanelBinding } from "../gameservers/ServerPanel";
import {
  capacityPercent,
  getEventStatusClass,
  isSameLocalCalendarDay,
  toDatetimeLocal
} from "../lib/event-format";

interface EventCardProps {
  event: GameEvent;
  markSrc: string;
  compact: boolean;
  expanded: boolean;
  canManage: boolean;
  canSoftDelete: boolean;
  joinDisabled: boolean;
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

export function EventCard({
  event,
  markSrc,
  compact,
  expanded,
  canManage,
  canSoftDelete,
  joinDisabled,
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

  function formatStartForCompactOverview(iso: string): string {
    const start = new Date(iso);
    const now = new Date();
    const timeOnly = new Intl.DateTimeFormat(dateTag, { hour: "2-digit", minute: "2-digit" });
    if (isSameLocalCalendarDay(start, now)) {
      return timeOnly.format(start);
    }
    return new Intl.DateTimeFormat(dateTag, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(start);
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

  function myParticipationLabel(): string | null {
    if (event.myParticipation === "joined") {
      return t("events.part.joined");
    }
    if (event.myParticipation === "declined") {
      return t("events.part.declined");
    }
    return null;
  }

  const statusLabel = getEventStatusLabel();
  const statusClass = getEventStatusClass(event);
  const pct = capacityPercent(event);
  const panelId = `event-expand-${event.id}`;
  const compactStartLabel = formatStartForCompactOverview(event.startsAt);
  const which = expanded ? t("events.tile.collapse") : t("events.tile.expand");
  const tileAriaLabel = compact
    ? t("events.tile.aria", {
        title: event.gameTitle,
        start: compactStartLabel,
        status: statusLabel,
        which
      })
    : t("events.tile.ariaNoStart", {
        title: event.gameTitle,
        status: statusLabel,
        which
      });

  return (
    <div className="event-expandable" key={event.id}>
      <button
        type="button"
        className={`event-compact-tile event-tile-${statusClass}`}
        aria-expanded={expanded}
        aria-controls={panelId}
        id={`event-tile-${event.id}`}
        onClick={onToggleExpand}
        aria-label={tileAriaLabel}
      >
        <img src={markSrc} alt="" className="event-compact-icon" width={36} height={36} />
        <div className="event-compact-tile-body">
          <span className="event-compact-title">{event.gameTitle}</span>
          {compact ? (
            <time className="event-compact-start" dateTime={event.startsAt}>
              {compactStartLabel}
            </time>
          ) : null}
          <div className="event-compact-track" aria-hidden="true">
            <div className="event-compact-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="event-compact-meta">
            <span className="event-compact-count">
              {event.joinedCount}/{event.maxPlayers}
            </span>
            <span className={`status-pill status-${statusClass}`}>{statusLabel}</span>
          </div>
        </div>
        <span className="event-compact-chevron" aria-hidden="true">
          {expanded ? "▼" : "▶"}
        </span>
      </button>
      {expanded ? (
        <div
          className="event-expanded-panel"
          id={panelId}
          role="region"
          aria-labelledby={`event-tile-${event.id}`}
          aria-label={t("events.panel.details", { title: event.gameTitle })}
        >
          <article
            className={`event-card event-${statusClass} event-card--expanded-follow`}
          >
            <div className="event-header event-header--expanded-follow">
              <div>
                <p className="eyebrow">
                  {event.startMode === "now"
                    ? t("events.mode.now")
                    : t("events.mode.scheduled")}
                </p>
                <h2>{event.gameTitle}</h2>
              </div>
              <span className={`status-pill status-${statusClass}`}>{statusLabel}</span>
            </div>
            <ExpandedContent
              event={event}
              t={t}
              dateTag={dateTag}
              selfStatusLabel={myParticipationLabel()}
              gapHint={minPlayersGapHint()}
              startRelative={formatStartRelative(event.startsAt)}
              canManage={canManage}
              canSoftDelete={canSoftDelete}
              joinDisabled={joinDisabled}
              editedStartsAt={editedStartsAt}
              onEditedStartsAtChange={onEditedStartsAtChange}
              onJoin={onJoin}
              onDecline={onDecline}
              onUpdateStart={onUpdateStart}
              onArchive={onArchive}
              onCancel={onCancel}
              onSoftDelete={onSoftDelete}
              server={server}
            />
          </article>
        </div>
      ) : null}
    </div>
  );
}

interface ExpandedContentProps {
  event: GameEvent;
  t: ReturnType<typeof useI18n>["t"];
  dateTag: string;
  selfStatusLabel: string | null;
  gapHint: string | null;
  startRelative: string;
  canManage: boolean;
  canSoftDelete: boolean;
  joinDisabled: boolean;
  editedStartsAt: string | undefined;
  onEditedStartsAtChange: (value: string) => void;
  onJoin: () => void;
  onDecline: () => void;
  onUpdateStart: () => void;
  onArchive: () => void;
  onCancel: () => void;
  onSoftDelete: () => void;
  server?: ServerPanelBinding;
}

function ExpandedContent({
  event,
  t,
  dateTag,
  selfStatusLabel,
  gapHint,
  startRelative,
  canManage,
  canSoftDelete,
  joinDisabled,
  editedStartsAt,
  onEditedStartsAtChange,
  onJoin,
  onDecline,
  onUpdateStart,
  onArchive,
  onCancel,
  onSoftDelete,
  server
}: ExpandedContentProps) {
  const startAbsolute = new Date(event.startsAt).toLocaleString(dateTag);
  const pct = capacityPercent(event);
  const isActive = event.status !== "archived" && event.status !== "cancelled";

  return (
    <>
      {selfStatusLabel && event.myParticipation ? (
        <p className={`event-self-status event-self-${event.myParticipation}`} role="status">
          {selfStatusLabel}
        </p>
      ) : null}
      <div className="event-meta-row">
        <span className="event-organizer">
          {t("events.organizer")} <strong>{event.createdByUsername}</strong>
        </span>
        <time className="event-relative-start" dateTime={event.startsAt} title={startAbsolute}>
          {startRelative}
        </time>
      </div>
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
            <time dateTime={event.startsAt}>{startAbsolute}</time>
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
      {isActive ? (
        <div className="action-row">
          <button
            type="button"
            className={`participation-btn${event.myParticipation === "joined" ? " participation-btn--joined" : ""}`}
            onClick={onJoin}
            disabled={joinDisabled}
          >
            {t("events.action.join")}
          </button>
          <button
            type="button"
            className={`participation-btn${event.myParticipation === "declined" ? " participation-btn--declined" : ""}`}
            onClick={onDecline}
            disabled={event.myParticipation === "declined"}
          >
            {t("events.action.decline")}
          </button>
        </div>
      ) : null}
      {canManage && isActive ? (
        <div className="manage-row">
          <input
            type="datetime-local"
            value={editedStartsAt ?? toDatetimeLocal(event.startsAt)}
            onChange={(change) => onEditedStartsAtChange(change.target.value)}
          />
          <button type="button" className="secondary" onClick={onUpdateStart}>
            {t("events.action.saveStart")}
          </button>
          <button type="button" className="secondary" onClick={onArchive}>
            {t("events.action.archive")}
          </button>
          <button type="button" className="secondary" onClick={onCancel}>
            {t("events.action.cancel")}
          </button>
        </div>
      ) : null}
      {canSoftDelete ? (
        <div className="action-row">
          <button type="button" className="secondary danger" onClick={onSoftDelete}>
            {t("events.action.delete")}
          </button>
        </div>
      ) : null}
    </>
  );
}
