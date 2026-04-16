import { and, eq, inArray, sql } from "drizzle-orm";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser } from "../auth/current-user";
import { tryWriteAuditLog, writeAuditLog } from "../audit-log";
import type { DatabaseContext } from "../db/client";
import { appSettings, gameEvents, participations, users } from "../db/schema";
import { deriveEventStatus, eventInputSchema, shouldAutoArchive } from "../domain/events";
import { canCreateEvent, canManageEvent } from "../domain/users";
import { sendPushToEnabledUsers, sendPushToOperators } from "../push/push-service";
import { broadcastEventsChanged } from "../realtime/event-bus";

const updateEventSchema = z.object({
  gameTitle: z.string().trim().min(1).max(120).optional(),
  startMode: z.enum(["now", "scheduled"]).optional(),
  startsAt: z.string().datetime().optional(),
  minPlayers: z.number().int().min(1).max(256).optional(),
  maxPlayers: z.number().int().min(1).max(256).optional(),
  serverHost: z.string().trim().max(160).optional(),
  connectionInfo: z.string().trim().max(2000).optional()
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
    gameTitle: event.gameTitle,
    startMode: event.startMode,
    startsAt: event.startsAt,
    minPlayers: event.minPlayers,
    maxPlayers: event.maxPlayers,
    serverHost: event.serverHost,
    connectionInfo: event.connectionInfo,
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

  router.get("/", (_request, response) => {
    const actor = requireUser(context, _request);
    refreshEventStatuses(context);
    const events = context.db
      .select()
      .from(gameEvents)
      .orderBy(sql`datetime(${gameEvents.startsAt}) ASC`)
      .all();

    response.json({ events: events.map((event) => serializeEvent(context, event, actor?.id)) });
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

    const timestamp = nowIso();
    const startsAt =
      parsed.data.startMode === "now" ? timestamp : (parsed.data.startsAt as string);
    const id = randomUUID();

    context.db
      .insert(gameEvents)
      .values({
        id,
        gameTitle: parsed.data.gameTitle,
        startMode: parsed.data.startMode,
        startsAt,
        minPlayers: parsed.data.minPlayers,
        maxPlayers: parsed.data.maxPlayers,
        serverHost: parsed.data.serverHost || null,
        connectionInfo: parsed.data.connectionInfo || null,
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
        maxPlayers: parsed.data.maxPlayers
      }
    });
    broadcastEventsChanged("event_created");
    void sendPushToEnabledUsers(context, {
      title: "Neue Runde",
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

    if (!actor || !event) {
      response.status(event ? 403 : 404).json({ error: event ? "verboten" : "event_nicht_gefunden" });
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

    context.db
      .update(gameEvents)
      .set({
        gameTitle: parsed.data.gameTitle ?? event.gameTitle,
        startMode,
        startsAt,
        minPlayers,
        maxPlayers,
        serverHost: parsed.data.serverHost ?? event.serverHost,
        connectionInfo: parsed.data.connectionInfo ?? event.connectionInfo,
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

    if (!actor || !event) {
      response.status(event ? 403 : 404).json({ error: event ? "verboten" : "event_nicht_gefunden" });
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
        void sendPushToOperators(context, {
          title: "Runde voll",
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
            void sendPushToOperators(context, {
              title: "Runde voll",
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
            throw retryError;
          }

          throw retryError;
        }
      } else {
        throw error;
      }
    }

    const { existingStatus, previousStatus, nextStatus, updated } = transactionResult;
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
      void sendPushToEnabledUsers(context, {
        title: "Runde aktualisiert",
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

    if (!actor || !event) {
      response.status(event ? 403 : 404).json({ error: event ? "verboten" : "event_nicht_gefunden" });
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
    void sendPushToEnabledUsers(context, {
      title: "Runde storniert",
      body: `${event.gameTitle} wurde storniert.`,
      url: "/#events",
      vibrate: [260, 90, 120]
    });
    response.json({ event: updated ? serializeEvent(context, updated, actor.id) : undefined });
  });

  router.post("/:id/archive", (request, response) => {
    const actor = requireUser(context, request);
    const event = context.db.select().from(gameEvents).where(eq(gameEvents.id, request.params.id)).get();

    if (!actor || !event) {
      response.status(event ? 403 : 404).json({ error: event ? "verboten" : "event_nicht_gefunden" });
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
    void sendPushToEnabledUsers(context, {
      title: "Runde archiviert",
      body: `${event.gameTitle} wurde archiviert.`,
      url: "/#events",
      vibrate: [120]
    });
    response.json({ event: updated ? serializeEvent(context, updated, actor.id) : undefined });
  });

  return router;
}
