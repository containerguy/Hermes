import { and, eq, inArray, sql } from "drizzle-orm";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser } from "../auth/current-user";
import type { DatabaseContext } from "../db/client";
import { appSettings, gameEvents, participations, users } from "../db/schema";
import { deriveEventStatus, eventInputSchema, shouldAutoArchive } from "../domain/events";
import { canCreateEvent, canManageEvent } from "../domain/users";

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

function refreshEventStatuses(context: DatabaseContext) {
  const now = new Date();
  const archiveAfterHours = readAutoArchiveHours(context);
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

    const existing = context.db
      .select()
      .from(participations)
      .where(and(eq(participations.eventId, event.id), eq(participations.userId, actor.id)))
      .get();
    const alreadyJoined = existing?.status === "joined";

    if (parsed.data.status === "joined" && !alreadyJoined && countJoined(context, event.id) >= event.maxPlayers) {
      response.status(409).json({ error: "event_voll" });
      return;
    }

    const timestamp = nowIso();

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

    recalculateEventStatus(context, event);

    const updated = context.db.select().from(gameEvents).where(eq(gameEvents.id, event.id)).get();
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
    response.json({ event: updated ? serializeEvent(context, updated, actor.id) : undefined });
  });

  return router;
}
