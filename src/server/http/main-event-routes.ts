import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { requireUser, selfUser } from "../auth/current-user";
import { requireCsrf } from "../auth/csrf";
import { enforceApiTokenWriteAccess } from "../auth/matchdesk-auth";
import { tryWriteAuditLog, writeAuditLog } from "../audit-log";
import { readSettings } from "../settings";
import { listEventServerIds, setEventServers } from "../domain/gameservers/event-servers";
import { getBinding } from "../domain/gameservers/bindings";
import type { DatabaseContext } from "../db/client";
import {
  gameEvents,
  inviteCodes,
  mainEventBroadcastDeliveries,
  mainEventBroadcasts,
  mainEventInvites,
  mainEventParticipants,
  mainEvents,
  users
} from "../db/schema";
import { notifyUsers } from "../notifications/dispatcher";
import { calendarFor, resetRemindersOnChange, sendJoinConfirmation } from "../notifications/reminders";
import {
  csvCell,
  isRegistrationClosed,
  mainEventInputSchema,
  mainEventInviteSchema,
  mainEventParticipationRequestSchema,
  mainEventUpdateSchema,
  resolveParticipationStatus,
  type MainEventParticipationStatus,
  type RequestedMainEventParticipation
} from "../domain/main-events";
import { canManageMainEvents, type UserRole } from "../domain/users";
import { revokeEventGrants, scopedEventIds } from "../domain/permissions";
import {
  sendPushToEnabledUsers,
  sendPushToMainEventParticipants,
  sendPushToUserIds
} from "../push/push-service";
import { broadcastEventsChanged } from "../realtime/event-bus";

type MainEventRow = typeof mainEvents.$inferSelect;
type Viewer = { id: string; role: UserRole };

const broadcastSchema = z.object({
  subject: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(5000),
  audience: z
    .array(z.enum(["joined", "interested", "waitlisted", "declined", "no_response"]))
    .min(1)
    .max(5)
});

/** Für Tests: Versand der letzten Rundnachricht abwarten. */
export let lastBroadcastDelivery: Promise<void> = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

/** Markdown bleibt wie eingegeben (Zeilenumbrüche, Einrückung); nur leer wird zu null. */
function normalizeMarkdown(value: string | null | undefined) {
  return value?.trim() ? value : null;
}

function normalizeText(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null;
}

export function getMainEvent(context: DatabaseContext, id: string) {
  return context.db.select().from(mainEvents).where(eq(mainEvents.id, id)).get();
}

/** Mehrere Events dürfen gleichzeitig laufen (Obergrenze: Einstellung maxRunningMainEvents). */
export function getRunningMainEvents(context: DatabaseContext) {
  return context.db.select().from(mainEvents).where(eq(mainEvents.status, "running")).all();
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
  return (
    event.visibility === "public" ||
    canManageMainEvents(context, viewer, event.id) ||
    isInvited(context, event.id, viewer.id)
  );
}

/** IDs der Events, deren Runden der Betrachter nicht sehen darf (ohne Betrachter, z. B. Kiosk: alle privaten). */
export function hiddenMainEventIds(context: DatabaseContext, viewer: Viewer | null) {
  if (viewer && canManageMainEvents(context, viewer)) {
    return new Set<string>();
  }
  // Wer ein Event nur per Event-Vergabe verwaltet, sieht dessen Runden auch ohne Einladung.
  const managed = new Set(viewer ? scopedEventIds(context, viewer, "main_events.manage") : []);
  const privateEvents = context.db
    .select({ id: mainEvents.id, visibility: mainEvents.visibility })
    .from(mainEvents)
    .where(eq(mainEvents.visibility, "private"))
    .all();
  return new Set(
    privateEvents
      .filter((event) => !viewer || (!managed.has(event.id) && !isInvited(context, event.id, viewer.id)))
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

/** Gelöschte Benutzer zählen nicht mit (weder Plätze noch Nachrückerliste). */
function countByStatus(context: DatabaseContext, mainEventId: string, status: MainEventParticipationStatus) {
  const row = context.sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM main_event_participants p
         JOIN users u ON u.id = p.user_id
       WHERE p.main_event_id = ? AND p.status = ? AND u.deleted_at IS NULL`
    )
    .get(mainEventId, status) as { count: number };

  return row.count;
}

function countParticipants(context: DatabaseContext, mainEventId: string) {
  return countByStatus(context, mainEventId, "joined");
}

/** Nachrücker in Reihenfolge: wer zuerst auf der Liste stand, rückt zuerst nach. */
function waitlist(context: DatabaseContext, mainEventId: string) {
  return context.db
    .select({ userId: mainEventParticipants.userId })
    .from(mainEventParticipants)
    .innerJoin(users, eq(mainEventParticipants.userId, users.id))
    .where(
      and(
        eq(mainEventParticipants.mainEventId, mainEventId),
        eq(mainEventParticipants.status, "waitlisted"),
        isNull(users.deletedAt)
      )
    )
    .orderBy(asc(mainEventParticipants.updatedAt), asc(mainEventParticipants.id))
    .all()
    .map((row) => row.userId);
}

function waitlistPosition(context: DatabaseContext, mainEventId: string, userId: string) {
  const index = waitlist(context, mainEventId).indexOf(userId);
  return index === -1 ? null : index + 1;
}

export function findParticipation(context: DatabaseContext, mainEventId: string, userId: string) {
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
  status: MainEventParticipationStatus
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

/**
 * Freie Plätze an Nachrücker vergeben (z. B. nach einer Absage oder mehr Plätzen).
 * Gibt die IDs der Nachgerückten zurück, damit sie benachrichtigt werden können.
 */
function promoteWaitlisted(context: DatabaseContext, mainEventId: string) {
  const event = getMainEvent(context, mainEventId);
  if (!event || event.status === "ended") {
    return [];
  }
  const queue = waitlist(context, mainEventId);
  const free =
    event.maxParticipants === null ? queue.length : Math.max(0, event.maxParticipants - countParticipants(context, mainEventId));
  const promoted = queue.slice(0, free);
  for (const userId of promoted) {
    setParticipation(context, mainEventId, userId, "joined");
  }
  return promoted;
}

function notifyPromoted(context: DatabaseContext, event: MainEventRow, userIds: string[]) {
  if (userIds.length === 0) {
    return;
  }
  sendJoinConfirmation(context, event, userIds);
  void sendPushToUserIds(context, userIds, {
    title: "Nachgerückt",
    body: `Ein Platz bei ${event.name} ist frei geworden: Du bist jetzt dabei.`,
    url: "/#main-events",
    vibrate: [180, 80, 180]
  });
}

/**
 * Teilnahme setzen und Plätze beachten: Eine Zusage bei vollem Event landet auf der
 * Nachrückerliste, eine frei gewordene Stelle geht an den ersten Nachrücker.
 * Bleibt der Status gleich, wird nichts geändert (Nachrücker behalten ihren Platz in der Liste).
 */
function applyParticipation(
  context: DatabaseContext,
  event: MainEventRow,
  userId: string,
  requested: RequestedMainEventParticipation
) {
  const result = context.sqlite.transaction(() => {
    const previous = findParticipation(context, event.id, userId)?.status ?? null;
    const status = resolveParticipationStatus({
      requested,
      previous,
      joinedCount: countParticipants(context, event.id),
      maxParticipants: event.maxParticipants,
      waitlistCount: countByStatus(context, event.id, "waitlisted")
    });
    if (status !== previous) {
      setParticipation(context, event.id, userId, status);
    }
    // Ein freier Platz geht immer an den Ersten der Liste (auch wenn er z. B. durch Löschen frei wurde).
    const promoted = promoteWaitlisted(context, event.id);
    const finalStatus = promoted.includes(userId) ? "joined" : status;
    return { previous, status: finalStatus, promoted: promoted.filter((id) => id !== userId) };
  })();
  // Zusage-Mail mit Kalendereintrag (nur Mail, nur beim Wechsel auf „dabei“).
  if (result.status === "joined" && result.previous !== "joined") {
    sendJoinConfirmation(context, event, [userId]);
  }
  return result;
}

/** Wer bei einer Runde des Events „dabei" sagt und sich zum Event noch nicht entschieden hat, nimmt teil. */
export function joinMainEventIfUndecided(context: DatabaseContext, mainEventId: string, userId: string) {
  const event = getMainEvent(context, mainEventId);
  if (!event || findParticipation(context, mainEventId, userId) || isRegistrationClosed(event)) {
    return false;
  }
  // Ist das Event voll (oder warten schon Nachrücker), bleibt man unentschieden: Dann fragt die
  // Event-Abfrage selbst nach, statt jemanden still auf die Nachrückerliste zu setzen.
  if (
    event.maxParticipants !== null &&
    (countParticipants(context, mainEventId) >= event.maxParticipants ||
      countByStatus(context, mainEventId, "waitlisted") > 0)
  ) {
    return false;
  }
  return applyParticipation(context, event, userId, "joined").status === "joined";
}

function serializeMainEvent(context: DatabaseContext, event: MainEventRow, viewer: Viewer) {
  const creator = context.db.select().from(users).where(eq(users.id, event.createdByUserId)).get();
  // Die Gästeliste privater Events sehen nur Manager und Admins.
  const invites =
    event.visibility === "private" && canManageMainEvents(context, viewer, event.id)
      ? invitedUserIds(context, event.id).map((userId) => ({
          userId,
          username: context.db.select().from(users).where(eq(users.id, userId)).get()?.username ?? "unbekannt"
        }))
      : undefined;

  return {
    id: event.id,
    name: event.name,
    description: event.description,
    infosMarkdown: event.infosMarkdown,
    /** 0037: angebotene Gameserver (Bindungs-IDs); leer = alle. */
    serverBindingIds: listEventServerIds(context, event.id),
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
    interestedCount: countByStatus(context, event.id, "interested"),
    waitlistCount: countByStatus(context, event.id, "waitlisted"),
    maxParticipants: event.maxParticipants,
    registrationDeadline: event.registrationDeadline,
    registrationClosed: isRegistrationClosed(event),
    remindersEnabled: event.remindersEnabled,
    myParticipation: findParticipation(context, event.id, viewer.id)?.status ?? null,
    myWaitlistPosition: waitlistPosition(context, event.id, viewer.id),
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

  function auditPromotions(
    actor: Parameters<typeof tryWriteAuditLog>[1]["actor"],
    event: MainEventRow,
    promoted: string[]
  ) {
    for (const userId of promoted) {
      tryWriteAuditLog(context, {
        actor,
        action: "main_event.waitlist_promoted",
        entityType: "main_event",
        entityId: event.id,
        summary: `Ein Nachrücker ist beim Event ${event.name} nachgerückt.`,
        metadata: { userId }
      });
    }
  }

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
      // Das eigene aktuelle Event (globaler Umschalter) wählt jeder für sich.
      const isCurrentChoice = request.method === "PUT" && request.path === "/current";
      // Anlegen nur mit globalem Recht; ein bestehendes Event auch mit Vergabe nur für dieses Event.
      const eventId = request.path === "/" ? null : (/^\/([^/]+)/.exec(request.path)?.[1] ?? null);
      if (!isParticipation && !isCurrentChoice && !canManageMainEvents(context, user, eventId)) {
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
        infosMarkdown: normalizeMarkdown(parsed.data.infosMarkdown),
        status: "planned",
        visibility: parsed.data.visibility ?? "public",
        plannedStartAt: parsed.data.plannedStartAt ?? null,
        plannedEndAt: parsed.data.plannedEndAt ?? null,
        maxParticipants: parsed.data.maxParticipants ?? null,
        registrationDeadline: parsed.data.registrationDeadline ?? null,
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
        plannedEndAt: created.plannedEndAt,
        maxParticipants: created.maxParticipants,
        registrationDeadline: created.registrationDeadline
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
      // Wer schon zugesagt hat, interessiert ist oder nachrückt, behält beim Wechsel auf privat den Zugang
      // (sonst könnte ein Nachrücker einen Platz in einem Event bekommen, das er nicht sieht).
      const registered = context.db
        .select({ userId: mainEventParticipants.userId })
        .from(mainEventParticipants)
        .where(
          and(
            eq(mainEventParticipants.mainEventId, event.id),
            inArray(mainEventParticipants.status, ["joined", "interested", "waitlisted"])
          )
        )
        .all()
        .map((row) => row.userId);
      inviteUsers(context, event.id, registered, actor.id);
    }

    const promoted = context.sqlite.transaction(() => {
      context.db
        .update(mainEvents)
        .set({
          name: parsed.data.name ?? event.name,
          visibility,
          description:
            parsed.data.description === undefined ? event.description : normalizeText(parsed.data.description),
          infosMarkdown:
            parsed.data.infosMarkdown === undefined ? event.infosMarkdown : normalizeMarkdown(parsed.data.infosMarkdown),
          plannedStartAt,
          plannedEndAt,
          maxParticipants:
            parsed.data.maxParticipants === undefined ? event.maxParticipants : parsed.data.maxParticipants,
          registrationDeadline:
            parsed.data.registrationDeadline === undefined
              ? event.registrationDeadline
              : parsed.data.registrationDeadline,
          remindersEnabled: parsed.data.remindersEnabled ?? event.remindersEnabled,
          updatedAt: nowIso()
        })
        .where(eq(mainEvents.id, event.id))
        .run();

      // Neuer Termin oder Anmeldeschluss: die zugehörigen Erinnerungen dürfen neu verschickt werden.
      resetRemindersOnChange(context, event, {
        plannedStartAt,
        registrationDeadline:
          parsed.data.registrationDeadline === undefined ? event.registrationDeadline : parsed.data.registrationDeadline
      });

      // Mehr Plätze (oder keine Grenze mehr): Nachrücker rücken auf. Weniger Plätze nehmen
      // niemandem eine Zusage weg.
      return promoteWaitlisted(context, event.id);
    })();
    const updated = getMainEvent(context, event.id)!;
    auditPromotions(actor, updated, promoted);
    notifyPromoted(context, updated, promoted);
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

    const limit = readSettings(context).maxRunningMainEvents;
    if (getRunningMainEvents(context).length >= limit) {
      response.status(409).json({ error: "zu_viele_laufende_events", limit });
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
      url: "/#main-events",
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
    const { archivedRounds, revokedGrants } = context.sqlite.transaction(() => {
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

      // Rechte, die nur für dieses Event vergeben waren, erlöschen mit dem Ende.
      const revokedGrants = revokeEventGrants(context, event.id, timestamp);

      return { archivedRounds: activeRounds.length, revokedGrants };
    })();

    const updated = getMainEvent(context, event.id)!;
    writeAuditLog(context, {
      actor,
      action: "main_event.end",
      entityType: "main_event",
      entityId: event.id,
      summary: `${actor.username} hat das Event ${event.name} beendet.`,
      metadata: { archivedRounds, revokedGrants }
    });
    broadcastEventsChanged("main_event_ended");
    void sendPushToMainEventParticipants(context, event.id, {
      title: "Event beendet",
      body: `${event.name} ist vorbei. Danke fürs Mitspielen!`,
      url: "/#main-events",
      vibrate: [120]
    });
    response.json({ mainEvent: serializeMainEvent(context, updated, actor), archivedRounds });
  });

  /** 0037: Gameserver, die das Event anbietet (leere Liste = alle). Event-Verwaltung. */
  router.put("/:id/servers", (request, response) => {
    const actor = requireUser(context, request)!;
    const event = getMainEvent(context, request.params.id);
    if (!event) {
      response.status(404).json({ error: "hauptevent_nicht_gefunden" });
      return;
    }
    const parsed = z.object({ bindingIds: z.array(z.string().min(1).max(64)).max(200) }).safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_server" });
      return;
    }
    if (parsed.data.bindingIds.some((id) => !getBinding(context, id))) {
      response.status(400).json({ error: "binding_nicht_gefunden" });
      return;
    }
    setEventServers(context, event.id, parsed.data.bindingIds);
    writeAuditLog(context, {
      actor,
      action: "main_event.servers",
      entityType: "main_event",
      entityId: event.id,
      summary: `${actor.username} hat die Gameserver von ${event.name} festgelegt.`,
      metadata: { bindingIds: parsed.data.bindingIds }
    });
    broadcastEventsChanged("main_event_updated");
    response.json({ mainEvent: serializeMainEvent(context, event, actor) });
  });

  /** Aktuelles Event des Benutzers setzen (null = alle Events); gilt auf allen Seiten und Geräten. */
  router.put("/current", (request, response) => {
    const actor = requireUser(context, request)!;
    const parsed = z.object({ mainEventId: z.string().min(1).max(64).nullable() }).safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiges_aktuelles_event" });
      return;
    }
    if (parsed.data.mainEventId !== null) {
      const event = getMainEvent(context, parsed.data.mainEventId);
      if (!event || !canSeeMainEvent(context, actor, event)) {
        response.status(404).json({ error: "hauptevent_nicht_gefunden" });
        return;
      }
      if (event.status === "ended") {
        response.status(409).json({ error: "hauptevent_beendet" });
        return;
      }
    }
    context.db
      .update(users)
      .set({ currentMainEventId: parsed.data.mainEventId, updatedAt: nowIso() })
      .where(eq(users.id, actor.id))
      .run();
    const updated = context.db.select().from(users).where(eq(users.id, actor.id)).get()!;
    response.json({ user: selfUser(context, updated) });
  });

  router.post("/:id/participation", (request, response) => {
    const actor = requireUser(context, request)!;
    const event = getMainEvent(context, request.params.id);
    const parsed = mainEventParticipationRequestSchema.safeParse(request.body);

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

    // Nach dem Anmeldeschluss sind nur noch Absagen möglich; wer schon angemeldet ist, bleibt es.
    const current = findParticipation(context, event.id, actor.id)?.status ?? null;
    const changesRegistration =
      parsed.data.status !== "declined" &&
      parsed.data.status !== current &&
      !(parsed.data.status === "joined" && current === "waitlisted");
    if (changesRegistration && isRegistrationClosed(event)) {
      response.status(409).json({ error: "anmeldeschluss_vorbei" });
      return;
    }

    const { previous, status, promoted } = applyParticipation(context, event, actor.id, parsed.data.status);
    const summaries: Record<MainEventParticipationStatus, string> = {
      joined: `${actor.username} ist beim Event ${event.name} dabei.`,
      interested: `${actor.username} ist am Event ${event.name} interessiert.`,
      waitlisted: `${actor.username} steht beim Event ${event.name} auf der Nachrückerliste.`,
      declined: `${actor.username} ist beim Event ${event.name} nicht dabei.`
    };
    tryWriteAuditLog(context, {
      actor,
      action: "main_event.participation",
      entityType: "main_event",
      entityId: event.id,
      summary: summaries[status],
      metadata: { participation: status, requestedParticipation: parsed.data.status, previousParticipation: previous }
    });
    auditPromotions(actor, event, promoted);
    notifyPromoted(context, event, promoted);
    broadcastEventsChanged("main_event_participation_updated");
    response.json({ mainEvent: serializeMainEvent(context, getMainEvent(context, event.id)!, actor) });
  });

  /** Anmeldeübersicht für Manager: wer hat zugesagt, wer ist interessiert, wer hat noch nicht geantwortet. */
  function participantOverview(event: MainEventRow) {
    const rows = context.db
      .select({
        userId: mainEventParticipants.userId,
        status: mainEventParticipants.status,
        updatedAt: mainEventParticipants.updatedAt,
        username: users.username,
        displayName: users.displayName
      })
      .from(mainEventParticipants)
      .innerJoin(users, eq(mainEventParticipants.userId, users.id))
      .where(and(eq(mainEventParticipants.mainEventId, event.id), isNull(users.deletedAt)))
      .all();
    const queue = waitlist(context, event.id);
    const statusOrderForList: Record<MainEventParticipationStatus, number> = {
      joined: 0,
      waitlisted: 1,
      interested: 2,
      declined: 3
    };
    const participants = rows
      .map((row) => ({
        ...row,
        waitlistPosition: row.status === "waitlisted" ? queue.indexOf(row.userId) + 1 : null
      }))
      .sort(
        (left, right) =>
          statusOrderForList[left.status] - statusOrderForList[right.status] ||
          (left.waitlistPosition ?? 0) - (right.waitlistPosition ?? 0) ||
          left.username.localeCompare(right.username)
      );

    // Wer das Event sehen kann und sich noch nicht gemeldet hat.
    const responded = new Set(rows.map((row) => row.userId));
    const audience =
      event.visibility === "private"
        ? context.db
            .select({ userId: users.id, username: users.username, displayName: users.displayName })
            .from(mainEventInvites)
            .innerJoin(users, eq(mainEventInvites.userId, users.id))
            .where(and(eq(mainEventInvites.mainEventId, event.id), isNull(users.deletedAt)))
            .all()
        : context.db
            .select({ userId: users.id, username: users.username, displayName: users.displayName })
            .from(users)
            .where(isNull(users.deletedAt))
            .all();
    const noResponse = audience
      .filter((user) => !responded.has(user.userId))
      .sort((left, right) => left.username.localeCompare(right.username));

    return { participants, noResponse };
  }

  function requireManagedEvent(request: Request, response: Response) {
    const actor = requireUser(context, request)!;
    if (!canManageMainEvents(context, actor, String(request.params.id))) {
      response.status(403).json({ error: "hauptevent_manager_erforderlich" });
      return null;
    }
    const event = getMainEvent(context, String(request.params.id));
    if (!event) {
      response.status(404).json({ error: "hauptevent_nicht_gefunden" });
      return null;
    }
    return event;
  }

  // Rundnachricht an Teilnehmer, gefiltert nach Status; Versand über den Verteiler (Kanalwahl je Person).
  router.post("/:id/broadcasts", (request, response) => {
    const actor = requireUser(context, request)!;
    const event = requireManagedEvent(request, response);
    if (!event) {
      return;
    }
    const parsed = broadcastSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_rundnachricht" });
      return;
    }
    const audience = new Set(parsed.data.audience);
    const { participants, noResponse } = participantOverview(event);
    const recipientIds = Array.from(
      new Set([
        ...participants.filter((row) => audience.has(row.status)).map((row) => row.userId),
        ...(audience.has("no_response") ? noResponse.map((row) => row.userId) : [])
      ])
    );
    if (recipientIds.length === 0) {
      response.status(409).json({ error: "rundnachricht_ohne_empfaenger" });
      return;
    }
    const id = randomUUID();
    const timestamp = nowIso();
    context.db
      .insert(mainEventBroadcasts)
      .values({
        id,
        mainEventId: event.id,
        authorUserId: actor.id,
        subject: parsed.data.subject,
        body: parsed.data.body,
        audience: JSON.stringify(Array.from(audience)),
        recipientCount: recipientIds.length,
        createdAt: timestamp
      })
      .run();
    tryWriteAuditLog(context, {
      actor,
      action: "main_event.broadcast",
      entityType: "main_event",
      entityId: event.id,
      summary: `${actor.username} hat eine Rundnachricht zum Event ${event.name} an ${recipientIds.length} Personen geschickt.`,
      metadata: { broadcastId: id, audience: Array.from(audience), recipients: recipientIds.length }
    });
    // Versand im Hintergrund: SMTP und Modulkanäle können dauern. Ergebnis steht danach im Verlauf.
    lastBroadcastDelivery = notifyUsers(context, recipientIds, {
      mainEventId: event.id,
      eventName: event.name,
      subject: parsed.data.subject,
      body: parsed.data.body,
      path: "#main-events"
    })
      .then((deliveries) => {
        const created = nowIso();
        for (const delivery of deliveries) {
          context.db
            .insert(mainEventBroadcastDeliveries)
            .values({ broadcastId: id, ...delivery, createdAt: created })
            .onConflictDoNothing()
            .run();
        }
      })
      .catch((error) => console.error("[Matchdesk] Broadcast delivery failed", error));
    response.status(202).json({ broadcast: serializeBroadcast(id) });
  });

  router.get("/:id/broadcasts", (request, response) => {
    const event = requireManagedEvent(request, response);
    if (!event) {
      return;
    }
    const rows = context.db
      .select({ id: mainEventBroadcasts.id })
      .from(mainEventBroadcasts)
      .where(eq(mainEventBroadcasts.mainEventId, event.id))
      .orderBy(desc(mainEventBroadcasts.createdAt))
      .limit(50)
      .all();
    response.json({ broadcasts: rows.map((row) => serializeBroadcast(row.id)) });
  });

  function serializeBroadcast(id: string) {
    const row = context.db.select().from(mainEventBroadcasts).where(eq(mainEventBroadcasts.id, id)).get()!;
    const author = row.authorUserId
      ? context.db.select({ username: users.username }).from(users).where(eq(users.id, row.authorUserId)).get()
      : undefined;
    const deliveries = context.db
      .select({ channelId: mainEventBroadcastDeliveries.channelId, status: mainEventBroadcastDeliveries.status })
      .from(mainEventBroadcastDeliveries)
      .where(eq(mainEventBroadcastDeliveries.broadcastId, id))
      .all();
    // Zusammenfassung je Kanal: wie viele erreicht, fehlgeschlagen; dazu ohne Kanal/abgemeldet.
    const summary: Record<string, { sent: number; failed: number }> = {};
    let skipped = 0;
    for (const delivery of deliveries) {
      if (delivery.status === "skipped") {
        skipped += 1;
        continue;
      }
      const entry = (summary[delivery.channelId] ??= { sent: 0, failed: 0 });
      entry[delivery.status] += 1;
    }
    return {
      id: row.id,
      subject: row.subject,
      body: row.body,
      audience: JSON.parse(row.audience) as string[],
      recipientCount: row.recipientCount,
      authorUsername: author?.username ?? null,
      createdAt: row.createdAt,
      delivered: deliveries.length > 0,
      channels: summary,
      skipped
    };
  }

  // Kalendereintrag zum Herunterladen (für alle, die das Event sehen).
  router.get("/:id/calendar.ics", (request, response) => {
    const viewer = requireUser(context, request)!;
    const event = getMainEvent(context, String(request.params.id));
    if (!event || !canSeeMainEvent(context, viewer, event)) {
      response.status(404).json({ error: "hauptevent_nicht_gefunden" });
      return;
    }
    if (!event.plannedStartAt) {
      response.status(409).json({ error: "hauptevent_ohne_termin" });
      return;
    }
    const fileName = `${event.name.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "event"}.ics`;
    response.setHeader("Content-Type", "text/calendar; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    response.send(calendarFor([event], event.name));
  });

  router.get("/:id/participants", (request, response) => {
    const event = requireManagedEvent(request, response);
    if (!event) {
      return;
    }
    response.json(participantOverview(event));
  });

  router.get("/:id/participants.csv", (request, response) => {
    const event = requireManagedEvent(request, response);
    if (!event) {
      return;
    }
    const { participants, noResponse } = participantOverview(event);
    const lines = [
      ["Benutzername", "Anzeigename", "Status", "Nachrücker-Platz", "Geändert"].map(csvCell).join(";"),
      ...participants.map((row) =>
        [row.username, row.displayName, row.status, row.waitlistPosition, row.updatedAt].map(csvCell).join(";")
      ),
      ...noResponse.map((row) => [row.username, row.displayName, "no_response", null, null].map(csvCell).join(";"))
    ];
    const fileName = `anmeldungen-${event.name.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "event"}.csv`;
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    // BOM, damit Excel Umlaute richtig liest.
    response.send(`\uFEFF${lines.join("\r\n")}\r\n`);
  });

  router.get("/invite-candidates", (request, response) => {
    const actor = requireUser(context, request)!;
    if (!canManageMainEvents(context, actor) && scopedEventIds(context, actor, "main_events.manage").length === 0) {
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
        url: "/#main-events",
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
      // Ohne Einladung keine Teilnahme mehr an einem privaten Event; ein frei gewordener Platz
      // geht an den ersten Nachrücker.
      let promoted: string[] = [];
      if (event.visibility === "private") {
        const wasJoined = findParticipation(context, event.id, request.params.userId)?.status === "joined";
        context.db
          .delete(mainEventParticipants)
          .where(
            and(
              eq(mainEventParticipants.mainEventId, event.id),
              eq(mainEventParticipants.userId, request.params.userId)
            )
          )
          .run();
        if (wasJoined) {
          promoted = promoteWaitlisted(context, event.id);
        }
      }
      return { changes: result.changes, promoted };
    })();

    if (removed.changes === 0) {
      response.status(404).json({ error: "einladung_nicht_gefunden" });
      return;
    }

    tryWriteAuditLog(context, {
      actor,
      action: "main_event.uninvite",
      entityType: "main_event",
      entityId: event.id,
      summary: `${actor.username} hat eine Einladung zum Event ${event.name} zurückgenommen.`,
      metadata: { userId: request.params.userId, promotedUserIds: removed.promoted }
    });
    auditPromotions(actor, event, removed.promoted);
    notifyPromoted(context, event, removed.promoted);
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
    // Einladungscodes des Events werden deaktiviert, sonst würden sie still zu allgemeinen Codes.
    context.sqlite.transaction(() => {
      context.db
        .update(inviteCodes)
        .set({ revokedAt: nowIso(), updatedAt: nowIso() })
        .where(and(eq(inviteCodes.mainEventId, event.id), isNull(inviteCodes.revokedAt)))
        .run();
      context.db.delete(mainEvents).where(eq(mainEvents.id, event.id)).run();
    })();
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
