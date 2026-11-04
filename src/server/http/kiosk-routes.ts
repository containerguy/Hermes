import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { DatabaseContext } from "../db/client";
import { gameEvents, mainEvents, users } from "../db/schema";
import { getMainEvent, hiddenMainEventIds } from "./main-event-routes";
import { getServerStatus } from "../integrations/amp/amp-status";
import { readSettings } from "../settings";
import { refreshEventStatuses } from "./event-routes";

/** Phase 15 (D-14): Serverstatus für den Kiosk — nur diese sechs Felder, keine Geheimnisse. */
function serializeKioskServer(bindingId: string | null) {
  const status = bindingId ? getServerStatus(bindingId) : null;
  if (!status) {
    return null;
  }
  return {
    running: status.running,
    appState: status.appState,
    players: status.players,
    maxPlayers: status.maxPlayers,
    host: status.host,
    port: status.port
  };
}

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
    details: event.details,
    status: event.status,
    createdByUserId: event.createdByUserId,
    createdByUsername: creator?.username ?? "unbekannt",
    joinedCount,
    myParticipation: null,
    mainEventId: event.mainEventId ?? null,
    mainEventName: event.mainEventId ? (getMainEvent(context, event.mainEventId)?.name ?? null) : null,
    server: serializeKioskServer(event.serverBindingId ?? null),
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

    // Ein Event: `&event=<id>` in der URL, sonst die Einstellung; leer = alle laufenden Events.
    const eventRaw = typeof request.query.event === "string" ? request.query.event.trim() : "";
    const chosenId = eventRaw || settings.kioskMainEventId;
    const chosen = chosenId ? getMainEvent(context, chosenId) : undefined;
    if (chosen) {
      // Bewusst gewähltes Event: auch ein privates zeigen (die Adresse ist durch den Schlüssel geschützt).
      response.json({
        mainEvent: { id: chosen.id, name: chosen.name, status: chosen.status },
        mainEvents: [{ id: chosen.id, name: chosen.name, status: chosen.status }],
        events: events
          .filter((event) => event.mainEventId === chosen.id)
          .map((event) => serializeKioskEvent(context, event))
      });
      return;
    }

    // Die Kiosk-Anzeige ist ohne Login sichtbar: Runden privater Events bleiben draußen.
    const hidden = hiddenMainEventIds(context, null);
    const running = context.db
      .select({ id: mainEvents.id, name: mainEvents.name, status: mainEvents.status })
      .from(mainEvents)
      .where(eq(mainEvents.status, "running"))
      .all()
      .filter((entry) => !hidden.has(entry.id));
    response.json({
      mainEvent: null,
      mainEvents: running,
      events: events
        .filter((event) => !event.mainEventId || !hidden.has(event.mainEventId))
        .map((event) => serializeKioskEvent(context, event))
    });
  });

  return router;
}
