import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { tryWriteAuditLog } from "../audit-log";
import { buildCalendar, type CalendarEvent } from "../calendar/ics";
import type { DatabaseContext } from "../db/client";
import {
  calendarFeedTokens,
  mainEventInvites,
  mainEventParticipants,
  mainEventRemindersSent,
  mainEvents,
  users
} from "../db/schema";
import { readEnv } from "../env";
import { resolvePublicUrl } from "../mail/mailer";
import { notifyUsers, type EventInfoMessage } from "./dispatcher";

/*
 * Geplante Erinnerungen und Kalender:
 * - 7 Tage und 1 Tag vor dem geplanten Start an alle, die zugesagt haben,
 * - einen Tag vor dem Anmeldeschluss an Interessierte und alle, die noch nicht geantwortet haben,
 * - Zusage-Mail mit Kalendereintrag (.ics), Download und abonnierbarer Kalender-Link.
 * Jede Erinnerung geht pro Event höchstens einmal raus; ändert sich der Termin, wieder.
 */

type MainEventRow = typeof mainEvents.$inferSelect;
type ReminderKind = (typeof mainEventRemindersSent.$inferSelect)["kind"];

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function timeZone() {
  return readEnv("TIMEZONE")?.trim() || "Europe/Berlin";
}

export function formatEventDate(iso: string, locale: "de" | "en") {
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "de-DE", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: timeZone()
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString();
  }
}

function uidDomain() {
  const publicUrl = resolvePublicUrl();
  if (publicUrl) {
    try {
      return new URL(publicUrl).host;
    } catch {
      // weiter unten
    }
  }
  return "matchdesk.local";
}

export function calendarEventOf(event: MainEventRow): CalendarEvent | null {
  if (!event.plannedStartAt) {
    return null;
  }
  const publicUrl = resolvePublicUrl();
  return {
    id: event.id,
    name: event.name,
    description: event.description,
    startsAt: event.plannedStartAt,
    endsAt: event.plannedEndAt,
    url: publicUrl ? `${publicUrl}/#main-events` : null,
    updatedAt: event.updatedAt
  };
}

export function calendarFor(events: MainEventRow[], calendarName: string) {
  return buildCalendar(
    events.map(calendarEventOf).filter((entry): entry is CalendarEvent => entry !== null),
    { calendarName, uidDomain: uidDomain() }
  );
}

function icsAttachment(event: MainEventRow) {
  if (!event.plannedStartAt) {
    return undefined;
  }
  return [
    {
      filename: `${event.name.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "event"}.ics`,
      content: calendarFor([event], event.name),
      contentType: "text/calendar; charset=utf-8; method=PUBLISH"
    }
  ];
}

/** Zusage bestätigen: nur per Mail, mit Kalendereintrag, sofern ein Termin geplant ist. */
export function sendJoinConfirmation(context: DatabaseContext, event: MainEventRow, userIds: string[]) {
  if (userIds.length === 0 || event.status === "ended") {
    return;
  }
  const dateDe = event.plannedStartAt ? formatEventDate(event.plannedStartAt, "de") : null;
  const dateEn = event.plannedStartAt ? formatEventDate(event.plannedStartAt, "en") : null;
  const message: EventInfoMessage = {
    mainEventId: event.id,
    eventName: event.name,
    subject: `Du bist dabei: ${event.name}`,
    body: [
      `deine Zusage für ${event.name} ist eingetragen.`,
      dateDe ? `Geplanter Start: ${dateDe}.` : "Der Termin steht noch nicht fest.",
      event.description ?? ""
    ]
      .filter(Boolean)
      .join("\n\n"),
    path: "#main-events",
    mailAttachments: icsAttachment(event),
    mailFooterNote: event.plannedStartAt ? "Im Anhang findest du den Termin für deinen Kalender." : null,
    en: {
      subject: `You're in: ${event.name}`,
      body: [
        `your registration for ${event.name} is confirmed.`,
        dateEn ? `Planned start: ${dateEn}.` : "The date is not fixed yet.",
        event.description ?? ""
      ]
        .filter(Boolean)
        .join("\n\n"),
      mailFooterNote: event.plannedStartAt ? "The attachment adds the event to your calendar." : null
    }
  };
  lastReminderRun = notifyUsers(context, userIds, message, { onlyChannels: ["mail"] })
    .then(() => undefined)
    .catch((error) => console.error("[Matchdesk] Join confirmation failed", error));
}

/** Für Tests: letzten Versand abwarten. */
export let lastReminderRun: Promise<void> = Promise.resolve();

export function resetRemindersOnChange(
  context: DatabaseContext,
  previous: MainEventRow,
  next: { plannedStartAt: string | null; registrationDeadline: string | null }
) {
  const kinds: ReminderKind[] = [];
  if (previous.plannedStartAt !== next.plannedStartAt) {
    kinds.push("start_7d", "start_1d");
  }
  if (previous.registrationDeadline !== next.registrationDeadline) {
    kinds.push("deadline_1d");
  }
  if (kinds.length > 0) {
    context.db
      .delete(mainEventRemindersSent)
      .where(and(eq(mainEventRemindersSent.mainEventId, previous.id), inArray(mainEventRemindersSent.kind, kinds)))
      .run();
  }
}

function participantIds(context: DatabaseContext, eventId: string, statuses: string[]) {
  return context.db
    .select({ userId: mainEventParticipants.userId })
    .from(mainEventParticipants)
    .where(
      and(
        eq(mainEventParticipants.mainEventId, eventId),
        inArray(mainEventParticipants.status, statuses as Array<"joined" | "interested" | "waitlisted" | "declined">)
      )
    )
    .all()
    .map((row) => row.userId);
}

/** Wer das Event sehen kann und noch nicht geantwortet hat. */
function noResponseIds(context: DatabaseContext, event: MainEventRow) {
  const responded = new Set(
    context.db
      .select({ userId: mainEventParticipants.userId })
      .from(mainEventParticipants)
      .where(eq(mainEventParticipants.mainEventId, event.id))
      .all()
      .map((row) => row.userId)
  );
  const audience =
    event.visibility === "private"
      ? context.db
          .select({ id: mainEventInvites.userId })
          .from(mainEventInvites)
          .where(eq(mainEventInvites.mainEventId, event.id))
          .all()
      : context.db.select({ id: users.id }).from(users).where(isNull(users.deletedAt)).all();
  return audience.map((row) => row.id).filter((id) => !responded.has(id));
}

type DueReminder = { kind: ReminderKind; recipients: string[]; message: EventInfoMessage };

function dueReminders(context: DatabaseContext, event: MainEventRow, now: number): DueReminder[] {
  const due: DueReminder[] = [];
  const created = new Date(event.createdAt).getTime();
  const base = { mainEventId: event.id, eventName: event.name, path: "#main-events" };

  if (event.plannedStartAt) {
    const start = new Date(event.plannedStartAt).getTime();
    const remaining = start - now;
    const dateDe = formatEventDate(event.plannedStartAt, "de");
    const dateEn = formatEventDate(event.plannedStartAt, "en");
    // Eine Woche vorher: nur wenn das Event nicht erst in dieser Woche angelegt wurde.
    if (remaining > DAY_MS && remaining <= 7 * DAY_MS && created < start - 6 * DAY_MS) {
      due.push({
        kind: "start_7d",
        recipients: participantIds(context, event.id, ["joined"]),
        message: {
          ...base,
          subject: "In einer Woche geht es los",
          body: `${event.name} beginnt am ${dateDe}. Du hast zugesagt. Falls du doch nicht kannst, sag bitte rechtzeitig ab, damit jemand nachrücken kann.`,
          mailAttachments: icsAttachment(event),
          en: {
            subject: "One week to go",
            body: `${event.name} starts on ${dateEn}. You are registered. If you can no longer make it, please cancel in time so someone else can take your spot.`
          }
        }
      });
    }
    if (remaining > 0 && remaining <= DAY_MS && created < start - 20 * HOUR_MS) {
      due.push({
        kind: "start_1d",
        recipients: participantIds(context, event.id, ["joined"]),
        message: {
          ...base,
          subject: "Morgen geht es los",
          body: `${event.name} beginnt am ${dateDe}. Bis morgen!`,
          en: { subject: "Tomorrow is the day", body: `${event.name} starts on ${dateEn}. See you tomorrow!` }
        }
      });
    }
  }

  if (event.registrationDeadline) {
    const deadline = new Date(event.registrationDeadline).getTime();
    const remaining = deadline - now;
    if (remaining > 0 && remaining <= DAY_MS && created < deadline - 20 * HOUR_MS) {
      const dateDe = formatEventDate(event.registrationDeadline, "de");
      const dateEn = formatEventDate(event.registrationDeadline, "en");
      due.push({
        kind: "deadline_1d",
        recipients: [...participantIds(context, event.id, ["interested"]), ...noResponseIds(context, event)],
        message: {
          ...base,
          subject: "Anmeldeschluss morgen",
          body: `Für ${event.name} endet die Anmeldung am ${dateDe}. Sag bitte zu oder ab, damit die Planung steht.`,
          en: {
            subject: "Registration closes tomorrow",
            body: `Registration for ${event.name} closes on ${dateEn}. Please confirm or decline so planning can go ahead.`
          }
        }
      });
    }
  }
  return due;
}

/** Fällige Erinnerungen verschicken. Läuft regelmäßig; jede Erinnerung höchstens einmal je Event. */
export async function runEventReminders(context: DatabaseContext, now: Date = new Date()) {
  const events = context.db
    .select()
    .from(mainEvents)
    .where(and(eq(mainEvents.status, "planned"), eq(mainEvents.remindersEnabled, true)))
    .all();
  const sent: Array<{ mainEventId: string; kind: ReminderKind; recipients: number }> = [];
  for (const event of events) {
    for (const reminder of dueReminders(context, event, now.getTime())) {
      // Erst reservieren, dann senden: so geht eine Erinnerung auch bei parallelen Läufen nur einmal raus.
      const claimed = context.db
        .insert(mainEventRemindersSent)
        .values({
          mainEventId: event.id,
          kind: reminder.kind,
          sentAt: now.toISOString(),
          recipientCount: reminder.recipients.length
        })
        .onConflictDoNothing()
        .run();
      if (claimed.changes === 0) {
        continue;
      }
      if (reminder.recipients.length > 0) {
        await notifyUsers(context, reminder.recipients, reminder.message);
      }
      sent.push({ mainEventId: event.id, kind: reminder.kind, recipients: reminder.recipients.length });
      tryWriteAuditLog(context, {
        actor: undefined,
        action: "main_event.reminder",
        entityType: "main_event",
        entityId: event.id,
        summary: `Erinnerung (${reminder.kind}) zum Event ${event.name} an ${reminder.recipients.length} Personen verschickt.`,
        metadata: { kind: reminder.kind, recipients: reminder.recipients.length }
      });
    }
  }
  return sent;
}

/** Persönlicher Kalender-Link-Token; bleibt gleich, bis er erneuert wird. */
export function calendarTokenFor(context: DatabaseContext, userId: string, renew = false) {
  if (renew) {
    context.db.delete(calendarFeedTokens).where(eq(calendarFeedTokens.userId, userId)).run();
  }
  const existing = context.db
    .select({ token: calendarFeedTokens.token })
    .from(calendarFeedTokens)
    .where(eq(calendarFeedTokens.userId, userId))
    .get();
  if (existing) {
    return existing.token;
  }
  const token = randomBytes(24).toString("base64url");
  context.db
    .insert(calendarFeedTokens)
    .values({ token, userId, createdAt: new Date().toISOString() })
    .onConflictDoNothing()
    .run();
  return (
    context.db
      .select({ token: calendarFeedTokens.token })
      .from(calendarFeedTokens)
      .where(eq(calendarFeedTokens.userId, userId))
      .get()?.token ?? token
  );
}

/** Kalender eines Benutzers: Events, bei denen er zugesagt hat, interessiert ist oder nachrückt. */
export function personalCalendar(context: DatabaseContext, token: string) {
  const owner = context.db
    .select({ userId: calendarFeedTokens.userId })
    .from(calendarFeedTokens)
    .innerJoin(users, eq(calendarFeedTokens.userId, users.id))
    .where(and(eq(calendarFeedTokens.token, token), isNull(users.deletedAt)))
    .get();
  if (!owner) {
    return null;
  }
  const events = context.db
    .select({ event: mainEvents })
    .from(mainEventParticipants)
    .innerJoin(mainEvents, eq(mainEventParticipants.mainEventId, mainEvents.id))
    .where(
      and(
        eq(mainEventParticipants.userId, owner.userId),
        inArray(mainEventParticipants.status, ["joined", "interested", "waitlisted"])
      )
    )
    .all()
    .map((row) => row.event);
  return calendarFor(events, "Matchdesk");
}
