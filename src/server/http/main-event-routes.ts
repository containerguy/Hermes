import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { requireUser } from "../auth/current-user";
import { requireCsrf } from "../auth/csrf";
import { enforceApiTokenWriteAccess } from "../auth/hermes-auth";
import { tryWriteAuditLog, writeAuditLog } from "../audit-log";
import type { DatabaseContext } from "../db/client";
import { gameEvents, mainEventInvites, mainEventParticipants, mainEvents, users } from "../db/schema";
import { mainEventInputSchema, mainEventInviteSchema, mainEventUpdateSchema } from "../domain/main-events";
import { canManageMainEvents, type UserRole } from "../domain/users";
import {
  sendPushToEnabledUsers,
  sendPushToMainEventParticipants,
  sendPushToUserIds
} from "../push/push-service";
import { broadcastEventsChanged } from "../realtime/event-bus";

type MainEventRow = typeof mainEvents.$inferSelect;
type Viewer = { id: string; role: UserRole };

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null;
}

export function getMainEvent(context: DatabaseContext, id: string) {
  return context.db.select().from(mainEvents).where(eq(mainEvents.id, id)).get();
}

export function getRunningMainEvent(context: DatabaseContext) {
  return context.db.select().from(mainEvents).where(eq(mainEvents.status, "running")).get();
}

export function isInvited(context: DatabaseContext, mainEventId: string, userId: string) {
  return Boolean(
    context.db
      .select({ id: mainEventInvites.id })
      .from(mainEventInvites)
      .where(and(eq(mainEventInvites.mainEventId, mainEventId), eq(mainEventInvites.userId, userId)))
      .get()
  );
}

function invitedUserIds(context: DatabaseContext, mainEventId: string) {
  return context.db
    .select({ userId: mainEventInvites.userId })
    .from(mainEventInvites)
    .where(eq(mainEventInvites.mainEventId, mainEventId))
    .all()
    .map((row) => row.userId);
}

/** Private Events sehen nur Eingeladene sowie Manager und Admins. */
export function canSeeMainEvent(
  context: DatabaseContext,
  viewer: Viewer,
  event: Pick<MainEventRow, "id" | "visibility">
) {
  return event.visibility === "public" || canManageMainEvents(viewer) || isInvited(context, event.id, viewer.id);
}

/** IDs der Events, deren Runden der Betrachter nicht sehen darf (ohne Betrachter, z. B. Kiosk: alle privaten). */
export function hiddenMainEventIds(context: DatabaseContext, viewer: Viewer | null) {
  if (viewer && canManageMainEvents(viewer)) {
    return new Set<string>();
  }
  const privateEvents = context.db
    .select({ id: mainEvents.id, visibility: mainEvents.visibility })
    .from(mainEvents)
    .where(eq(mainEvents.visibility, "private"))
    .all();
  return new Set(
    privateEvents
      .filter((event) => !viewer || !isInvited(context, event.id, viewer.id))
      .map((event) => event.id)
  );
}

function inviteUsers(context: DatabaseContext, mainEventId: string, userIds: string[], invitedByUserId: string) {
  const timestamp = nowIso();
  const added: string[] = [];
  for (const userId of userIds) {
    const result = context.db
      .insert(mainEventInvites)
      .values({ id: randomUUID(), mainEventId, userId, invitedByUserId, createdAt: timestamp })
      .onConflictDoNothing()
      .run();
    if (result.changes > 0) {
      added.push(userId);
    }
  }
  return added;
}

function countRounds(context: DatabaseContext, mainEventId: string) {
  const row = context.sqlite
    .prepare("SELECT COUNT(*) AS count FROM game_events WHERE main_event_id = ? AND deleted_at IS NULL")
    .get(mainEventId) as { count: number };

  return row.count;
}

function countParticipants(context: DatabaseContext, mainEventId: string) {
  const row = context.sqlite
    .prepare("SELECT COUNT(*) AS count FROM main_event_participants WHERE main_event_id = ? AND status = 'joined'")
    .get(mainEventId) as { count: number };

  return row.count;
}

function findParticipation(context: DatabaseContext, mainEventId: string, userId: string) {
  return context.db
    .select()
    .from(mainEventParticipants)
    .where(and(eq(mainEventParticipants.mainEventId, mainEventId), eq(mainEventParticipants.userId, userId)))
    .get();
}

function setParticipation(
  context: DatabaseContext,
  mainEventId: string,
  userId: string,
  status: "joined" | "declined"
) {
  const timestamp = nowIso();
  context.db
    .insert(mainEventParticipants)
    .values({ id: randomUUID(), mainEventId, userId, status, createdAt: timestamp, updatedAt: timestamp })
    .onConflictDoUpdate({
      target: [mainEventParticipants.mainEventId, mainEventParticipants.userId],
      set: { status, updatedAt: timestamp }
    })
    .run();
}

/** Wer bei einer Runde des Events „dabei" sagt und sich zum Event noch nicht entschieden hat, nimmt teil. */
export function joinMainEventIfUndecided(context: DatabaseContext, mainEventId: string, userId: string) {
  if (findParticipation(context, mainEventId, userId)) {
    return false;
  }
  setParticipation(context, mainEventId, userId, "joined");
  return true;
}

function serializeMainEvent(context: DatabaseContext, event: MainEventRow, viewer: Viewer) {
  const creator = context.db.select().from(users).where(eq(users.id, event.createdByUserId)).get();
  // Die Gästeliste privater Events sehen nur Manager und Admins.
  const invites =
    event.visibility === "private" && canManageMainEvents(viewer)
      ? invitedUserIds(context, event.id).map((userId) => ({
          userId,
          username: context.db.select().from(users).where(eq(users.id, userId)).get()?.username ?? "unbekannt"
        }))
      : undefined;

  return {
    id: event.id,
    name: event.name,
    description: event.description,
    status: event.status,
    visibility: event.visibility,
    ...(invites ? { invites } : {}),
    plannedStartAt: event.plannedStartAt,
    plannedEndAt: event.plannedEndAt,
    startedAt: event.startedAt,
    endedAt: event.endedAt,
    createdByUserId: event.createdByUserId,
    createdByUsername: creator?.username ?? "unbekannt",
    roundCount: countRounds(context, event.id),
    participantCount: countParticipants(context, event.id),
    myParticipation: findParticipation(context, event.id, viewer.id)?.status ?? null,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt
  };
}

const statusOrder: Record<MainEventRow["status"], number> = { running: 0, planned: 1, ended: 2 };

function sortMainEvents(events: MainEventRow[]) {
  return [...events].sort((left, right) => {
    if (left.status !== right.status) {
      return statusOrder[left.status] - statusOrder[right.status];
    }
    if (left.status === "ended") {
      return (right.endedAt ?? "").localeCompare(left.endedAt ?? "");
    }
    return (left.plannedStartAt ?? left.createdAt).localeCompare(right.plannedStartAt ?? right.createdAt);
  });
}

export function createMainEventRouter(context: DatabaseContext) {
  const router = Router();

  router.use((request, response, next) => {
    const user = requireUser(context, request);

    if (!user) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
      if (!enforceApiTokenWriteAccess(request, response)) {
        return;
      }
      // Teilnahme zu- oder absagen darf jeder; alles andere ist Verwaltung.
      const isParticipation = request.method === "POST" && /^\/[^/]+\/participation$/.test(request.path);
      if (!isParticipation && !canManageMainEvents(user)) {
        response.status(403).json({ error: "hauptevent_manager_erforderlich" });
        return;
      }
      if (!requireCsrf(context, request, response)) {
        return;
      }
    }

    next();
  });

  router.get("/", (request, response) => {
    const actor = requireUser(context, request)!;
    const events = context.db
      .select()
      .from(mainEvents)
      .all()
      .filter((event) => canSeeMainEvent(context, actor, event));
    response.json({ mainEvents: sortMainEvents(events).map((event) => serializeMainEvent(context, event, actor)) });
  });

  router.post("/", (request, response) => {
    const actor = requireUser(context, request)!;
    const parsed = mainEventInputSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiges_hauptevent" });
      return;
    }

    const timestamp = nowIso();
    const id = randomUUID();
    context.db
      .insert(mainEvents)
      .values({
        id,
        name: parsed.data.name,
        description: normalizeText(parsed.data.description),
        status: "planned",
        visibility: parsed.data.visibility ?? "public",
        plannedStartAt: parsed.data.plannedStartAt ?? null,
        plannedEndAt: parsed.data.plannedEndAt ?? null,
        createdByUserId: actor.id,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run();

    const created = getMainEvent(context, id)!;
    writeAuditLog(context, {
      actor,
      action: "main_event.create",
      entityType: "main_event",
      entityId: id,
      summary: `${actor.username} hat das Event ${created.name} angelegt.`,
      metadata: {
        visibility: created.visibility,
        plannedStartAt: created.plannedStartAt,
        plannedEndAt: created.plannedEndAt
      }
    });
    broadcastEventsChanged("main_event_created");
    response.status(201).json({ mainEvent: serializeMainEvent(context, created, actor) });
  });

  router.patch("/:id", (request, response) => {
    const actor = requireUser(context, request)!;
    const event = getMainEvent(context, request.params.id);

    if (!event) {
      response.status(404).json({ error: "hauptevent_nicht_gefunden" });
      return;
    }

    if (event.status === "ended") {
      response.status(409).json({ error: "hauptevent_beendet" });
      return;
    }

    const parsed = mainEventUpdateSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiges_hauptevent" });
      return;
    }

    const plannedStartAt =
      parsed.data.plannedStartAt === undefined ? event.plannedStartAt : parsed.data.plannedStartAt;
    const plannedEndAt =
      parsed.data.plannedEndAt === undefined ? event.plannedEndAt : parsed.data.plannedEndAt;

    if (plannedStartAt && plannedEndAt && new Date(plannedEndAt) < new Date(plannedStartAt)) {
      response.status(400).json({ error: "ungueltiges_hauptevent" });
      return;
    }

    const visibility = parsed.data.visibility ?? event.visibility;
    if (visibility === "private" && event.visibility === "public") {
      // Wer schon zugesagt hat, behält beim Wechsel auf privat den Zugang.
      const joined = context.db
        .select({ userId: mainEventParticipants.userId })
        .from(mainEventParticipants)
        .where(and(eq(mainEventParticipants.mainEventId, event.id), eq(mainEventParticipants.status, "joined")))
        .all()
        .map((row) => row.userId);
      inviteUsers(context, event.id, joined, actor.id);
    }

    context.db
      .update(mainEvents)
      .set({
        name: parsed.data.name ?? event.name,
        visibility,
        description:
          parsed.data.description === undefined ? event.description : normalizeText(parsed.data.description),
        plannedStartAt,
        plannedEndAt,
        updatedAt: nowIso()
      })
      .where(eq(mainEvents.id, event.id))
      .run();

    const updated = getMainEvent(context, event.id)!;
    writeAuditLog(context, {
      actor,
      action: "main_event.update",
      entityType: "main_event",
      entityId: event.id,
      summary: `${actor.username} hat das Event ${updated.name} aktualisiert.`,
      metadata: parsed.data
    });
    broadcastEventsChanged("main_event_updated");
    response.json({ mainEvent: serializeMainEvent(context, updated, actor) });
  });

  router.post("/:id/start", (request, response) => {
    const actor = requireUser(context, request)!;
    const event = getMainEvent(context, request.params.id);

    if (!event) {
      response.status(404).json({ error: "hauptevent_nicht_gefunden" });
      return;
    }

    if (event.status !== "planned") {
      response.status(409).json({ error: "hauptevent_nicht_geplant" });
      return;
    }

    const running = getRunningMainEvent(context);
    if (running) {
      response.status(409).json({ error: "anderes_hauptevent_laeuft", runningMainEventId: running.id });
      return;
    }

    const timestamp = nowIso();
    context.db
      .update(mainEvents)
      .set({ status: "running", startedAt: timestamp, startedByUserId: actor.id, updatedAt: timestamp })
      .where(eq(mainEvents.id, event.id))
      .run();

    const updated = getMainEvent(context, event.id)!;
    writeAuditLog(context, {
      actor,
      action: "main_event.start",
      entityType: "main_event",
      entityId: event.id,
      summary: `${actor.username} hat das Event ${event.name} gestartet.`
    });
    broadcastEventsChanged("main_event_started");
    const startPush = {
      title: "Event gestartet",
      body: `${event.name} läuft jetzt. Bist du dabei?`,
      url: "/#events",
      vibrate: [220, 80, 220]
    };
    // Private Events laden nur die Eingeladenen ein.
    void (event.visibility === "private"
      ? sendPushToUserIds(context, invitedUserIds(context, event.id), startPush)
      : sendPushToEnabledUsers(context, startPush));
    response.json({ mainEvent: serializeMainEvent(context, updated, actor) });
  });

  router.post("/:id/end", (request, response) => {
    const actor = requireUser(context, request)!;
    const event = getMainEvent(context, request.params.id);

    if (!event) {
      response.status(404).json({ error: "hauptevent_nicht_gefunden" });
      return;
    }

    if (event.status !== "running") {
      response.status(409).json({ error: "hauptevent_laeuft_nicht" });
      return;
    }

    const timestamp = nowIso();
    // Mit dem Event enden auch seine offenen Runden: sie werden archiviert, damit keine
    // Benachrichtigungen mehr zu einem beendeten Event verschickt werden.
    const archivedRounds = context.sqlite.transaction(() => {
      const activeRounds = context.db
        .select({ id: gameEvents.id })
        .from(gameEvents)
        .where(
          and(
            eq(gameEvents.mainEventId, event.id),
            isNull(gameEvents.deletedAt),
            inArray(gameEvents.status, ["open", "ready", "running"])
          )
        )
        .all();

      if (activeRounds.length > 0) {
        context.db
          .update(gameEvents)
          .set({ status: "archived", archivedAt: timestamp, archivedByUserId: actor.id, updatedAt: timestamp })
          .where(
            inArray(
              gameEvents.id,
              activeRounds.map((round) => round.id)
            )
          )
          .run();
      }

      context.db
        .update(mainEvents)
        .set({ status: "ended", endedAt: timestamp, endedByUserId: actor.id, updatedAt: timestamp })
        .where(eq(mainEvents.id, event.id))
        .run();

      return activeRounds.length;
    })();

    const updated = getMainEvent(context, event.id)!;
    writeAuditLog(context, {
      actor,
      action: "main_event.end",
      entityType: "main_event",
      entityId: event.id,
      summary: `${actor.username} hat das Event ${event.name} beendet.`,
      metadata: { archivedRounds }
    });
    broadcastEventsChanged("main_event_ended");
    void sendPushToMainEventParticipants(context, event.id, {
      title: "Event beendet",
      body: `${event.name} ist vorbei. Danke fürs Mitspielen!`,
      url: "/#events",
      vibrate: [120]
    });
    response.json({ mainEvent: serializeMainEvent(context, updated, actor), archivedRounds });
  });

  router.post("/:id/participation", (request, response) => {
    const actor = requireUser(context, request)!;
    const event = getMainEvent(context, request.params.id);
    const parsed = z.object({ status: z.enum(["joined", "declined"]) }).safeParse(request.body);

    if (!event || !canSeeMainEvent(context, actor, event)) {
      response.status(404).json({ error: "hauptevent_nicht_gefunden" });
      return;
    }

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_teilnahme" });
      return;
    }

    if (event.status === "ended") {
      response.status(409).json({ error: "hauptevent_beendet" });
      return;
    }

    const previous = findParticipation(context, event.id, actor.id)?.status ?? null;
    setParticipation(context, event.id, actor.id, parsed.data.status);
    tryWriteAuditLog(context, {
      actor,
      action: "main_event.participation",
      entityType: "main_event",
      entityId: event.id,
      summary:
        parsed.data.status === "joined"
          ? `${actor.username} ist beim Event ${event.name} dabei.`
          : `${actor.username} ist beim Event ${event.name} nicht dabei.`,
      metadata: { participation: parsed.data.status, previousParticipation: previous }
    });
    broadcastEventsChanged("main_event_participation_updated");
    response.json({ mainEvent: serializeMainEvent(context, getMainEvent(context, event.id)!, actor) });
  });

  router.get("/invite-candidates", (request, response) => {
    const actor = requireUser(context, request)!;
    if (!canManageMainEvents(actor)) {
      response.status(403).json({ error: "hauptevent_manager_erforderlich" });
      return;
    }
    const candidates = context.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(isNull(users.deletedAt))
      .all()
      .sort((left, right) => left.username.localeCompare(right.username));
    response.json({ users: candidates });
  });

  router.post("/:id/invites", (request, response) => {
    const actor = requireUser(context, request)!;
    const event = getMainEvent(context, request.params.id);
    const parsed = mainEventInviteSchema.safeParse(request.body);

    if (!event) {
      response.status(404).json({ error: "hauptevent_nicht_gefunden" });
      return;
    }

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_einladung" });
      return;
    }

    if (event.status === "ended") {
      response.status(409).json({ error: "hauptevent_beendet" });
      return;
    }

    const userIds = Array.from(new Set(parsed.data.userIds));
    const existing = context.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, userIds), isNull(users.deletedAt)))
      .all();
    if (existing.length !== userIds.length) {
      response.status(400).json({ error: "ungueltige_einladung" });
      return;
    }

    const added = inviteUsers(context, event.id, userIds, actor.id);
    tryWriteAuditLog(context, {
      actor,
      action: "main_event.invite",
      entityType: "main_event",
      entityId: event.id,
      summary: `${actor.username} hat ${added.length} Person(en) zum Event ${event.name} eingeladen.`,
      metadata: { invitedUserIds: added }
    });
    broadcastEventsChanged("main_event_invites_updated");
    if (added.length > 0 && event.visibility === "private") {
      void sendPushToUserIds(context, added, {
        title: "Einladung",
        body:
          event.status === "running"
            ? `Du bist zu ${event.name} eingeladen. Das Event läuft schon, bist du dabei?`
            : `Du bist zu ${event.name} eingeladen.`,
        url: "/#events",
        vibrate: [180, 80, 180]
      });
    }
    response.json({ mainEvent: serializeMainEvent(context, getMainEvent(context, event.id)!, actor) });
  });

  router.delete("/:id/invites/:userId", (request, response) => {
    const actor = requireUser(context, request)!;
    const event = getMainEvent(context, request.params.id);

    if (!event) {
      response.status(404).json({ error: "hauptevent_nicht_gefunden" });
      return;
    }

    const removed = context.sqlite.transaction(() => {
      const result = context.db
        .delete(mainEventInvites)
        .where(and(eq(mainEventInvites.mainEventId, event.id), eq(mainEventInvites.userId, request.params.userId)))
        .run();
      // Ohne Einladung keine Teilnahme mehr an einem privaten Event.
      if (event.visibility === "private") {
        context.db
          .delete(mainEventParticipants)
          .where(
            and(
              eq(mainEventParticipants.mainEventId, event.id),
              eq(mainEventParticipants.userId, request.params.userId)
            )
          )
          .run();
      }
      return result.changes;
    })();

    if (removed === 0) {
      response.status(404).json({ error: "einladung_nicht_gefunden" });
      return;
    }

    tryWriteAuditLog(context, {
      actor,
      action: "main_event.uninvite",
      entityType: "main_event",
      entityId: event.id,
      summary: `${actor.username} hat eine Einladung zum Event ${event.name} zurückgenommen.`,
      metadata: { userId: request.params.userId }
    });
    broadcastEventsChanged("main_event_invites_updated");
    response.json({ mainEvent: serializeMainEvent(context, getMainEvent(context, event.id)!, actor) });
  });

  router.delete("/:id", (request, response) => {
    const actor = requireUser(context, request)!;
    const event = getMainEvent(context, request.params.id);

    if (!event) {
      response.status(404).json({ error: "hauptevent_nicht_gefunden" });
      return;
    }

    // Nur geplante Events lassen sich löschen; gelaufene bleiben als Historie erhalten.
    if (event.status !== "planned") {
      response.status(409).json({ error: "hauptevent_nicht_loeschbar" });
      return;
    }

    // Zugeordnete Runden bleiben bestehen und verlieren nur die Zuordnung (ON DELETE SET NULL).
    context.db.delete(mainEvents).where(eq(mainEvents.id, event.id)).run();
    writeAuditLog(context, {
      actor,
      action: "main_event.delete",
      entityType: "main_event",
      entityId: event.id,
      summary: `${actor.username} hat das Event ${event.name} gelöscht.`
    });
    broadcastEventsChanged("main_event_deleted");
    response.status(204).send();
  });

  return router;
}
