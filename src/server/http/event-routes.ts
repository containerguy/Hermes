import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser } from "../auth/current-user";
import { enforceApiTokenWriteAccess } from "../auth/hermes-auth";
import { tryWriteAuditLog, writeAuditLog } from "../audit-log";
import type { DatabaseContext } from "../db/client";
import { appSettings, gameEvents, participations, users } from "../db/schema";
import { deriveEventStatus, eventInputSchema, shouldAutoArchive } from "../domain/events";
import { acceptsRounds, withMainEventLabel } from "../domain/main-events";
import { findBindingForTitle, getBinding } from "../domain/gameservers/bindings";
import { canCreateEvent, canManageEvent, type UserRole } from "../domain/users";
import {
  sendPushToEnabledUsers,
  sendPushToMainEventParticipants,
  sendPushToOperators,
  type PushPayload
} from "../push/push-service";
import { broadcastEventsChanged } from "../realtime/event-bus";
import {
  canSeeMainEvent,
  getMainEvent,
  getRunningMainEvent,
  hiddenMainEventIds,
  joinMainEventIfUndecided
} from "./main-event-routes";

const updateEventSchema = z.object({
  gameTitle: z.string().trim().min(1).max(120).optional(),
  startMode: z.enum(["now", "scheduled"]).optional(),
  startsAt: z.string().datetime().optional(),
  minPlayers: z.number().int().min(1).max(256).optional(),
  maxPlayers: z.number().int().min(1).max(256).optional(),
  details: z.string().trim().max(4000).nullable().optional(),
  serverBindingId: z.string().min(1).max(64).nullable().optional(),
  mainEventId: z.string().min(1).max(64).nullable().optional()
});

function nowIso() {
  return new Date().toISOString();
}

class EventCapacityError extends Error {
  joinedCount: number;
  maxPlayers: number;

  constructor(input: { joinedCount: number; maxPlayers: number }) {
    super("event_voll");
    this.joinedCount = input.joinedCount;
    this.maxPlayers = input.maxPlayers;
  }
}

type MainEventResolution = { ok: true; mainEventId: string | null } | { ok: false; status: 400 | 409; error: string };

type Viewer = { id: string; role: UserRole };

/** 0026: Runden privater Events, zu denen der Betrachter nicht eingeladen ist, gibt es für ihn nicht. */
function isHiddenRound(context: DatabaseContext, viewer: Viewer, round: { mainEventId: string | null }) {
  if (!round.mainEventId) {
    return false;
  }
  const mainEvent = getMainEvent(context, round.mainEventId);
  return Boolean(mainEvent && !canSeeMainEvent(context, viewer, mainEvent));
}

/** „Runde voll" an Operatoren; bei privaten Events nur an die, die das Event sehen dürfen. */
function notifyOperatorsAboutRound(
  context: DatabaseContext,
  round: { mainEventId: string | null },
  payload: PushPayload
) {
  const mainEvent = round.mainEventId ? getMainEvent(context, round.mainEventId) : undefined;
  return mainEvent?.visibility === "private"
    ? sendPushToOperators(context, payload, (user) => canSeeMainEvent(context, user, mainEvent))
    : sendPushToOperators(context, payload);
}

/** 0025: Event einer Runde bestimmen — explizit (auch null) oder das gerade laufende Event. */
function resolveMainEventId(
  context: DatabaseContext,
  viewer: Viewer,
  requested: string | null | undefined
): MainEventResolution {
  if (requested === undefined) {
    const running = getRunningMainEvent(context);
    return { ok: true, mainEventId: running && canSeeMainEvent(context, viewer, running) ? running.id : null };
  }
  if (requested === null) {
    return { ok: true, mainEventId: null };
  }
  const mainEvent = getMainEvent(context, requested);
  if (!mainEvent || !canSeeMainEvent(context, viewer, mainEvent)) {
    return { ok: false, status: 400, error: "hauptevent_nicht_gefunden" };
  }
  if (!acceptsRounds(mainEvent.status)) {
    return { ok: false, status: 409, error: "hauptevent_beendet" };
  }
  return { ok: true, mainEventId: mainEvent.id };
}

function mainEventName(context: DatabaseContext, mainEventId: string | null | undefined) {
  return mainEventId ? (getMainEvent(context, mainEventId)?.name ?? null) : null;
}

/** Runden eines Events benachrichtigen nur dessen Teilnehmer, Runden ohne Event alle. */
function sendPushForRound(context: DatabaseContext, mainEventId: string | null | undefined, payload: PushPayload) {
  return mainEventId
    ? sendPushToMainEventParticipants(context, mainEventId, payload)
    : sendPushToEnabledUsers(context, payload);
}

function isSqliteBusyOrLocked(error: unknown) {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code !== "string") return false;
  return (
    code === "SQLITE_BUSY" ||
    code.startsWith("SQLITE_BUSY_") ||
    code === "SQLITE_LOCKED" ||
    code.startsWith("SQLITE_LOCKED_")
  );
}

function readAutoArchiveHours(context: DatabaseContext) {
  const row = context.db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "eventAutoArchiveHours"))
    .get();

  if (!row) {
    return 8;
  }

  const value = Number(JSON.parse(row.value));
  return Number.isFinite(value) && value > 0 ? value : 8;
}

function countJoined(context: DatabaseContext, eventId: string) {
  const row = context.sqlite
    .prepare("SELECT COUNT(*) AS count FROM participations WHERE event_id = ? AND status = 'joined'")
    .get(eventId) as { count: number };

  return row.count;
}

function recalculateEventStatus(context: DatabaseContext, event: typeof gameEvents.$inferSelect) {
  if (event.status === "cancelled" || event.status === "archived") {
    return event.status;
  }

  const status = deriveEventStatus({
    status: event.status,
    startsAt: new Date(event.startsAt),
    joinedCount: countJoined(context, event.id),
    minPlayers: event.minPlayers
  });

  context.db
    .update(gameEvents)
    .set({
      status,
      updatedAt: nowIso()
    })
    .where(eq(gameEvents.id, event.id))
    .run();

  return status;
}

export function refreshEventStatuses(context: DatabaseContext) {
  const now = new Date();
  const archiveAfterHours = readAutoArchiveHours(context);
  let changed = false;
  const activeEvents = context.db
    .select()
    .from(gameEvents)
    .where(inArray(gameEvents.status, ["open", "ready", "running"]))
    .all();

  for (const event of activeEvents) {
    const startsAt = new Date(event.startsAt);
    const joinedCount = countJoined(context, event.id);
    const nextStatus = shouldAutoArchive(startsAt, now, archiveAfterHours)
      ? "archived"
      : deriveEventStatus({
          status: event.status,
          startsAt,
          joinedCount,
          minPlayers: event.minPlayers,
          now
        });

    if (nextStatus !== event.status) {
      changed = true;
      context.db
        .update(gameEvents)
        .set({
          status: nextStatus,
          archivedAt: nextStatus === "archived" ? nowIso() : event.archivedAt,
          updatedAt: nowIso()
        })
        .where(eq(gameEvents.id, event.id))
        .run();
    }
  }

  return changed;
}

function serializeEvent(
  context: DatabaseContext,
  event: typeof gameEvents.$inferSelect,
  currentUserId?: string
) {
  const creator = context.db.select().from(users).where(eq(users.id, event.createdByUserId)).get();
  const joinedCount = countJoined(context, event.id);
  const myParticipation = currentUserId
    ? context.db
        .select()
        .from(participations)
        .where(and(eq(participations.eventId, event.id), eq(participations.userId, currentUserId)))
        .get()
    : undefined;

  return {
    id: event.id,
    mainEventId: event.mainEventId ?? null,
    mainEventName: mainEventName(context, event.mainEventId),
    gameTitle: event.gameTitle,
    startMode: event.startMode,
    startsAt: event.startsAt,
    minPlayers: event.minPlayers,
    maxPlayers: event.maxPlayers,
    details: event.details,
    serverBindingId: event.serverBindingId ?? null,
    status: event.status,
    createdByUserId: event.createdByUserId,
    createdByUsername: creator?.username ?? "unbekannt",
    joinedCount,
    myParticipation: myParticipation?.status ?? null,
    cancelledAt: event.cancelledAt,
    archivedAt: event.archivedAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt
  };
}

export function createEventRouter(context: DatabaseContext) {
  const router = Router();

  router.use((request, response, next) => {
    const user = requireUser(context, request);

    if (!user) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    next();
  });

  router.use((request, response, next) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
      if (!enforceApiTokenWriteAccess(request, response)) {
        return;
      }
    }
    next();
  });

  router.get("/", (_request, response) => {
    const actor = requireUser(context, _request);
    refreshEventStatuses(context);
    // 0025: ?mainEventId=<id> zeigt nur Runden dieses Events, ?mainEventId=none nur Runden ohne Event.
    const mainEventFilter = typeof _request.query.mainEventId === "string" ? _request.query.mainEventId : undefined;
    const events = context.db
      .select()
      .from(gameEvents)
      .where(
        and(
          isNull(gameEvents.deletedAt),
          mainEventFilter === undefined
            ? undefined
            : mainEventFilter === "none"
              ? isNull(gameEvents.mainEventId)
              : eq(gameEvents.mainEventId, mainEventFilter)
        )
      )
      .orderBy(sql`datetime(${gameEvents.startsAt}) ASC`)
      .all();
    const hidden = hiddenMainEventIds(context, actor ?? null);
    const visible = events.filter((event) => !event.mainEventId || !hidden.has(event.mainEventId));

    response.json({ events: visible.map((event) => serializeEvent(context, event, actor?.id)) });
  });

  router.post("/", (request, response) => {
    const actor = requireUser(context, request);

    if (!actor || !canCreateEvent(actor)) {
      response.status(403).json({ error: "manager_erforderlich" });
      return;
    }

    const parsed = eventInputSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiges_event" });
      return;
    }

    // Phase 15: Bindung explizit (auch null) oder automatisch über den normalisierten Titel.
    let serverBindingId: string | null;
    if (parsed.data.serverBindingId === undefined) {
      serverBindingId = findBindingForTitle(context, parsed.data.gameTitle)?.id ?? null;
    } else if (parsed.data.serverBindingId !== null && !getBinding(context, parsed.data.serverBindingId)) {
      response.status(400).json({ error: "binding_nicht_gefunden" });
      return;
    } else {
      serverBindingId = parsed.data.serverBindingId;
    }

    const mainEvent = resolveMainEventId(context, actor, parsed.data.mainEventId);
    if (!mainEvent.ok) {
      response.status(mainEvent.status).json({ error: mainEvent.error });
      return;
    }

    const timestamp = nowIso();
    const startsAt =
      parsed.data.startMode === "now" ? timestamp : (parsed.data.startsAt as string);
    const id = randomUUID();

    context.db
      .insert(gameEvents)
      .values({
        id,
        mainEventId: mainEvent.mainEventId,
        gameTitle: parsed.data.gameTitle,
        startMode: parsed.data.startMode,
        startsAt,
        minPlayers: parsed.data.minPlayers,
        maxPlayers: parsed.data.maxPlayers,
        details: parsed.data.details?.trim() ? parsed.data.details.trim() : null,
        serverBindingId,
        status: deriveEventStatus({
          status: "open",
          startsAt: new Date(startsAt),
          joinedCount: 0,
          minPlayers: parsed.data.minPlayers
        }),
        createdByUserId: actor.id,
        cancelledByUserId: null,
        archivedByUserId: null,
        cancelledAt: null,
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run();

    const created = context.db.select().from(gameEvents).where(eq(gameEvents.id, id)).get();
    writeAuditLog(context, {
      actor,
      action: "event.create",
      entityType: "event",
      entityId: id,
      summary: `${actor.username} hat ${parsed.data.gameTitle} angelegt.`,
      metadata: {
        gameTitle: parsed.data.gameTitle,
        startMode: parsed.data.startMode,
        minPlayers: parsed.data.minPlayers,
        maxPlayers: parsed.data.maxPlayers,
        mainEventId: mainEvent.mainEventId
      }
    });
    broadcastEventsChanged("event_created");
    void sendPushForRound(context, mainEvent.mainEventId, {
      title: withMainEventLabel("Neue Runde", mainEventName(context, mainEvent.mainEventId)),
      body: `${actor.username}: ${parsed.data.gameTitle}`,
      url: "/#events",
      vibrate: [220, 80, 220],
      requireInteraction: true
    });
    response.status(201).json({
      event: created ? serializeEvent(context, created, actor.id) : undefined
    });
  });

  router.patch("/:id", (request, response) => {
    const actor = requireUser(context, request);
    const event = context.db.select().from(gameEvents).where(eq(gameEvents.id, request.params.id)).get();

    if (!actor) {
      response.status(403).json({ error: "verboten" });
      return;
    }

    if (!event || event.deletedAt || isHiddenRound(context, actor, event)) {
      response.status(404).json({ error: "event_nicht_gefunden" });
      return;
    }

    if (!canManageEvent(actor, event)) {
      response.status(403).json({ error: "verboten" });
      return;
    }

    if (event.status === "archived" || event.status === "cancelled") {
      response.status(409).json({ error: "event_abgeschlossen" });
      return;
    }

    const parsed = updateEventSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiges_event" });
      return;
    }

    const startsAt =
      parsed.data.startMode === "now"
        ? nowIso()
        : parsed.data.startsAt ?? event.startsAt;
    const startMode = parsed.data.startMode ?? event.startMode;
    const minPlayers = parsed.data.minPlayers ?? event.minPlayers;
    const maxPlayers = parsed.data.maxPlayers ?? event.maxPlayers;

    if (maxPlayers < minPlayers) {
      response.status(400).json({ error: "ungueltige_spielerzahl" });
      return;
    }

    // Phase 15: explizite Bindung gewinnt; sonst bei geändertem Titel neu zuordnen, sonst behalten.
    let serverBindingId: string | null = event.serverBindingId ?? null;
    if (parsed.data.serverBindingId !== undefined) {
      if (parsed.data.serverBindingId !== null && !getBinding(context, parsed.data.serverBindingId)) {
        response.status(400).json({ error: "binding_nicht_gefunden" });
        return;
      }
      serverBindingId = parsed.data.serverBindingId;
    } else if (parsed.data.gameTitle !== undefined && parsed.data.gameTitle !== event.gameTitle) {
      serverBindingId = findBindingForTitle(context, parsed.data.gameTitle)?.id ?? null;
    }

    let mainEventId = event.mainEventId ?? null;
    if (parsed.data.mainEventId !== undefined) {
      const resolved = resolveMainEventId(context, actor, parsed.data.mainEventId);
      if (!resolved.ok) {
        response.status(resolved.status).json({ error: resolved.error });
        return;
      }
      mainEventId = resolved.mainEventId;
    }

    context.db
      .update(gameEvents)
      .set({
        mainEventId,
        gameTitle: parsed.data.gameTitle ?? event.gameTitle,
        serverBindingId,
        startMode,
        startsAt,
        minPlayers,
        maxPlayers,
        details:
          parsed.data.details === undefined
            ? event.details
            : parsed.data.details === null
              ? null
              : parsed.data.details.trim() || null,
        status: deriveEventStatus({
          status: event.status,
          startsAt: new Date(startsAt),
          joinedCount: countJoined(context, event.id),
          minPlayers
        }),
        updatedAt: nowIso()
      })
      .where(eq(gameEvents.id, event.id))
      .run();

    const updated = context.db.select().from(gameEvents).where(eq(gameEvents.id, event.id)).get();
    writeAuditLog(context, {
      actor,
      action: "event.update",
      entityType: "event",
      entityId: event.id,
      summary: `${actor.username} hat ${event.gameTitle} aktualisiert.`,
      metadata: parsed.data
    });
    broadcastEventsChanged("event_updated");
    response.json({ event: updated ? serializeEvent(context, updated, actor.id) : undefined });
  });

  router.post("/:id/participation", (request, response) => {
    const actor = requireUser(context, request);
    const event = context.db.select().from(gameEvents).where(eq(gameEvents.id, request.params.id)).get();
    const parsed = z.object({ status: z.enum(["joined", "declined"]) }).safeParse(request.body);

    if (!actor) {
      response.status(403).json({ error: "verboten" });
      return;
    }

    if (!event || event.deletedAt || isHiddenRound(context, actor, event)) {
      response.status(404).json({ error: "event_nicht_gefunden" });
      return;
    }

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_teilnahme" });
      return;
    }

    if (event.status === "archived" || event.status === "cancelled") {
      response.status(409).json({ error: "event_abgeschlossen" });
      return;
    }

    const timestamp = nowIso();
    const transaction = context.sqlite.transaction(() => {
      const existing = context.db
        .select()
        .from(participations)
        .where(and(eq(participations.eventId, event.id), eq(participations.userId, actor.id)))
        .get();
      const alreadyJoined = existing?.status === "joined";

      if (parsed.data.status === "joined" && !alreadyJoined) {
        const joinedCount = countJoined(context, event.id);
        if (joinedCount >= event.maxPlayers) {
          throw new EventCapacityError({ joinedCount, maxPlayers: event.maxPlayers });
        }
      }

      context.db
        .insert(participations)
        .values({
          id: existing?.id ?? randomUUID(),
          eventId: event.id,
          userId: actor.id,
          status: parsed.data.status,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp
        })
        .onConflictDoUpdate({
          target: [participations.eventId, participations.userId],
          set: {
            status: parsed.data.status,
            updatedAt: timestamp
          }
        })
        .run();

      const previousStatus = event.status;
      const nextStatus = recalculateEventStatus(context, event);
      const updated = context.db.select().from(gameEvents).where(eq(gameEvents.id, event.id)).get();

      return {
        existingStatus: existing?.status ?? null,
        previousStatus,
        nextStatus,
        updated
      };
    });

    let transactionResult: {
      existingStatus: string | null;
      previousStatus: string;
      nextStatus: string;
      updated: typeof gameEvents.$inferSelect | undefined;
    };

    try {
      transactionResult = transaction.immediate();
    } catch (error) {
      if (error instanceof EventCapacityError) {
        const existing = context.db
          .select()
          .from(participations)
          .where(and(eq(participations.eventId, event.id), eq(participations.userId, actor.id)))
          .get();

        tryWriteAuditLog(context, {
          actor,
          action: "participation.set",
          entityType: "event",
          entityId: event.id,
          summary: `${actor.username} konnte bei ${event.gameTitle} nicht dabei sein (Event voll).`,
          metadata: {
            participation: parsed.data.status,
            previousParticipation: existing?.status ?? null,
            outcome: "rejected",
            reason: "event_voll",
            joinedCount: error.joinedCount,
            maxPlayers: error.maxPlayers
          }
        });
        void notifyOperatorsAboutRound(context, event, {
          title: withMainEventLabel("Runde voll", mainEventName(context, event.mainEventId)),
          body: `${event.gameTitle}: Beitritt abgelehnt (Spieler ${error.joinedCount + 1} von ${error.maxPlayers}).`,
          url: "/#events",
          vibrate: [180, 80, 180]
        });

        const refreshed = context.db.select().from(gameEvents).where(eq(gameEvents.id, event.id)).get();
        response.status(409).json({
          error: "event_voll",
          event: refreshed ? serializeEvent(context, refreshed, actor.id) : undefined
        });
        return;
      }

      if (isSqliteBusyOrLocked(error)) {
        try {
          transactionResult = transaction.immediate();
        } catch (retryError) {
          if (retryError instanceof EventCapacityError) {
            const existing = context.db
              .select()
              .from(participations)
              .where(and(eq(participations.eventId, event.id), eq(participations.userId, actor.id)))
              .get();

            tryWriteAuditLog(context, {
              actor,
              action: "participation.set",
              entityType: "event",
              entityId: event.id,
              summary: `${actor.username} konnte bei ${event.gameTitle} nicht dabei sein (Event voll).`,
              metadata: {
                participation: parsed.data.status,
                previousParticipation: existing?.status ?? null,
                outcome: "rejected",
                reason: "event_voll",
                joinedCount: retryError.joinedCount,
                maxPlayers: retryError.maxPlayers
              }
            });
            void notifyOperatorsAboutRound(context, event, {
              title: withMainEventLabel("Runde voll", mainEventName(context, event.mainEventId)),
              body: `${event.gameTitle}: Beitritt abgelehnt (Spieler ${retryError.joinedCount + 1} von ${retryError.maxPlayers}).`,
              url: "/#events",
              vibrate: [180, 80, 180]
            });

            const refreshed = context.db.select().from(gameEvents).where(eq(gameEvents.id, event.id)).get();
            response.status(409).json({
              error: "event_voll",
              event: refreshed ? serializeEvent(context, refreshed, actor.id) : undefined
            });
            return;
          }

          if (isSqliteBusyOrLocked(retryError)) {
            console.error(
              "[Hermes] Participation update failed after retry (sqlite busy/locked)",
              retryError
            );
            response.status(503).json({ error: "teilnahme_fehlgeschlagen" });
            return;
          }

          throw retryError;
        }
      } else {
        throw error;
      }
    }

    const { existingStatus, previousStatus, nextStatus, updated } = transactionResult;
    // Zusage zu einer Runde gilt auch als Teilnahme am Event, wenn dazu noch nichts entschieden ist.
    if (parsed.data.status === "joined" && event.mainEventId) {
      joinMainEventIfUndecided(context, event.mainEventId, actor.id);
    }
    tryWriteAuditLog(context, {
      actor,
      action: "participation.set",
      entityType: "event",
      entityId: event.id,
      summary:
        parsed.data.status === "joined"
          ? `${actor.username} ist bei ${event.gameTitle} dabei.`
          : `${actor.username} ist bei ${event.gameTitle} nicht dabei.`,
      metadata: {
        participation: parsed.data.status,
        previousParticipation: existingStatus
      }
    });
    broadcastEventsChanged("participation_updated");
    if (previousStatus !== nextStatus && updated) {
      void sendPushForRound(context, updated.mainEventId, {
        title: withMainEventLabel("Runde aktualisiert", mainEventName(context, updated.mainEventId)),
        body:
          nextStatus === "ready"
            ? `${updated.gameTitle} ist startbereit.`
            : `${updated.gameTitle}: ${nextStatus}`,
        url: "/#events",
        vibrate: [180, 80, 180]
      });
    }
    response.json({ event: updated ? serializeEvent(context, updated, actor.id) : undefined });
  });

  router.post("/:id/cancel", (request, response) => {
    const actor = requireUser(context, request);
    const event = context.db.select().from(gameEvents).where(eq(gameEvents.id, request.params.id)).get();

    if (!actor) {
      response.status(403).json({ error: "verboten" });
      return;
    }

    if (!event || event.deletedAt || isHiddenRound(context, actor, event)) {
      response.status(404).json({ error: "event_nicht_gefunden" });
      return;
    }

    if (!canManageEvent(actor, event)) {
      response.status(403).json({ error: "verboten" });
      return;
    }

    context.db
      .update(gameEvents)
      .set({
        status: "cancelled",
        cancelledByUserId: actor.id,
        cancelledAt: nowIso(),
        updatedAt: nowIso()
      })
      .where(eq(gameEvents.id, event.id))
      .run();

    const updated = context.db.select().from(gameEvents).where(eq(gameEvents.id, event.id)).get();
    writeAuditLog(context, {
      actor,
      action: "event.cancel",
      entityType: "event",
      entityId: event.id,
      summary: `${actor.username} hat ${event.gameTitle} storniert.`
    });
    broadcastEventsChanged("event_cancelled");
    void sendPushForRound(context, event.mainEventId, {
      title: withMainEventLabel("Runde storniert", mainEventName(context, event.mainEventId)),
      body: `${event.gameTitle} wurde storniert.`,
      url: "/#events",
      vibrate: [260, 90, 120]
    });
    response.json({ event: updated ? serializeEvent(context, updated, actor.id) : undefined });
  });

  router.post("/:id/archive", (request, response) => {
    const actor = requireUser(context, request);
    const event = context.db.select().from(gameEvents).where(eq(gameEvents.id, request.params.id)).get();

    if (!actor) {
      response.status(403).json({ error: "verboten" });
      return;
    }

    if (!event || event.deletedAt || isHiddenRound(context, actor, event)) {
      response.status(404).json({ error: "event_nicht_gefunden" });
      return;
    }

    if (!canManageEvent(actor, event)) {
      response.status(403).json({ error: "verboten" });
      return;
    }

    context.db
      .update(gameEvents)
      .set({
        status: "archived",
        archivedByUserId: actor.id,
        archivedAt: nowIso(),
        updatedAt: nowIso()
      })
      .where(eq(gameEvents.id, event.id))
      .run();

    const updated = context.db.select().from(gameEvents).where(eq(gameEvents.id, event.id)).get();
    writeAuditLog(context, {
      actor,
      action: "event.archive",
      entityType: "event",
      entityId: event.id,
      summary: `${actor.username} hat ${event.gameTitle} archiviert.`
    });
    broadcastEventsChanged("event_archived");
    void sendPushForRound(context, event.mainEventId, {
      title: withMainEventLabel("Runde archiviert", mainEventName(context, event.mainEventId)),
      body: `${event.gameTitle} wurde archiviert.`,
      url: "/#events",
      vibrate: [120]
    });
    response.json({ event: updated ? serializeEvent(context, updated, actor.id) : undefined });
  });

  return router;
}
