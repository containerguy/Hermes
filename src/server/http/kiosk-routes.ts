import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { DatabaseContext } from "../db/client";
import { gameEvents, users } from "../db/schema";
import { readSettings } from "../settings";
import { refreshEventStatuses } from "./event-routes";

function safeEqualString(a: string, b: string) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function countJoined(context: DatabaseContext, eventId: string) {
  const row = context.sqlite
    .prepare("SELECT COUNT(*) AS count FROM participations WHERE event_id = ? AND status = 'joined'")
    .get(eventId) as { count: number };

  return row.count;
}

function serializeKioskEvent(context: DatabaseContext, event: typeof gameEvents.$inferSelect) {
  const creator = context.db.select().from(users).where(eq(users.id, event.createdByUserId)).get();
  const joinedCount = countJoined(context, event.id);

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
    myParticipation: null,
    cancelledAt: event.cancelledAt,
    archivedAt: event.archivedAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt
  };
}

export function createKioskRouter(context: DatabaseContext) {
  const router = Router();

  router.get("/events", (request, response) => {
    const settings = readSettings(context);

    if (!settings.kioskStreamEnabled) {
      response.status(403).json({ error: "kiosk_ungueltig" });
      return;
    }

    const idRaw = request.query.id;
    const id =
      typeof idRaw === "string"
        ? idRaw
        : Array.isArray(idRaw) && typeof idRaw[0] === "string"
          ? idRaw[0]
          : "";
    if (!id || !safeEqualString(id, settings.kioskStreamSecret)) {
      response.status(403).json({ error: "kiosk_ungueltig" });
      return;
    }

    refreshEventStatuses(context);

    const events = context.db
      .select()
      .from(gameEvents)
      .where(
        and(
          isNull(gameEvents.deletedAt),
          inArray(gameEvents.status, ["open", "ready", "running"])
        )
      )
      .orderBy(sql`datetime(${gameEvents.startsAt}) ASC`)
      .all();

    response.json({
      events: events.map((event) => serializeKioskEvent(context, event))
    });
  });

  return router;
}
