import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { requireUser } from "../auth/current-user";
import { requireCsrf } from "../auth/csrf";
import { enforceApiTokenWriteAccess } from "../auth/matchdesk-auth";
import { tryWriteAuditLog, writeAuditLog } from "../audit-log";
import type { DatabaseContext } from "../db/client";
import { gameEvents, inviteCodes, mainEventInvites, mainEventParticipants, mainEvents, users } from "../db/schema";
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
  return context.sqlite.transaction(() => {
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
    interestedCount: countByStatus(context, event.id, "interested"),
    waitlistCount: countByStatus(context, event.id, "waitlisted"),
    maxParticipants: event.maxParticipants,
    registrationDeadline: event.registrationDeadline,
    registrationClosed: isRegistrationClosed(event),
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
          plannedStartAt,
          plannedEndAt,
          maxParticipants:
            parsed.data.maxParticipants === undefined ? event.maxParticipants : parsed.data.maxParticipants,
          registrationDeadline:
            parsed.data.registrationDeadline === undefined
              ? event.registrationDeadline
              : parsed.data.registrationDeadline,
          updatedAt: nowIso()
        })
        .where(eq(mainEvents.id, event.id))
        .run();

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
      url: "/#main-events",
      vibrate: [120]
    });
    response.json({ mainEvent: serializeMainEvent(context, updated, actor), archivedRounds });
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
    if (!canManageMainEvents(actor)) {
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
