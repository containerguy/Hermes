import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type Mail from "nodemailer/lib/mailer";
import type { DatabaseContext } from "../db/client";
import {
  notificationChannelPreferences,
  notificationUnsubscribeTokens,
  pushSubscriptions,
  users
} from "../db/schema";
import { sendEventInfoMail } from "../mail/mailer";
import { getVapidPublicKey, sendPushToUser } from "../push/push-service";

/*
 * Benachrichtigungs-Verteiler für Event-Infos (Rundnachrichten, Erinnerungen).
 * Ein Aufruf „benachrichtige diese Benutzer“; der Verteiler wählt pro Benutzer die Kanäle,
 * die er im Profil eingeschaltet hat. Mail und Push sind eingebaut, Module melden weitere
 * Kanäle mit `registerNotificationChannel` an (z. B. telegram, sms).
 */

export type NotificationUser = typeof users.$inferSelect;

export type EventInfoMessage = {
  mainEventId: string;
  eventName: string;
  subject: string;
  /** Klartext (Markdown erlaubt, wird nicht als HTML interpretiert). */
  body: string;
  /** Pfad in der App, z. B. `#main-events`. */
  path: string;
  /** Nur für Mail: Anhänge wie ein Kalendereintrag. */
  mailAttachments?: Mail.Attachment[];
  mailFooterNote?: string | null;
  /** Englische Fassung für Benutzer mit Sprache en (Erinnerungen); Rundnachrichten nutzen den Originaltext. */
  en?: { subject: string; body: string; mailFooterNote?: string | null };
};

/** Betreff und Text in der Sprache des Empfängers, soweit vorhanden. */
export function localizedMessage(message: EventInfoMessage, user: Pick<NotificationUser, "locale">) {
  if (user.locale === "en" && message.en) {
    return {
      subject: message.en.subject,
      body: message.en.body,
      mailFooterNote: message.en.mailFooterNote ?? message.mailFooterNote ?? null
    };
  }
  return { subject: message.subject, body: message.body, mailFooterNote: message.mailFooterNote ?? null };
}

export type ChannelContext = {
  /** Persönlicher Abmeldelink-Token des Empfängers (für eigene Abmeldelinks im Kanal). */
  unsubscribeToken: string;
};

export type NotificationChannel = {
  /** Kleinbuchstaben, z. B. `mail`, `push`, `telegram`. Modulkanäle tragen die Modul-ID. */
  id: string;
  label: { de: string; en: string };
  /** Modul, das den Kanal bereitstellt (null = Kern). */
  moduleId: string | null;
  /** Vorgabe, wenn der Benutzer nichts gewählt hat. Modulkanäle sind Opt-in. */
  defaultEnabled: boolean;
  /** Kann der Kanal diesen Benutzer überhaupt erreichen (Mailadresse, Push-Abo, verknüpftes Konto)? */
  isAvailable: (context: DatabaseContext, user: NotificationUser) => boolean;
  /** Was im Profil steht, wenn der Kanal den Benutzer noch nicht erreichen kann. */
  unavailableHint?: { de: string; en: string };
  send: (
    context: DatabaseContext,
    user: NotificationUser,
    message: EventInfoMessage,
    channelContext: ChannelContext
  ) => Promise<void>;
};

const mailChannel: NotificationChannel = {
  id: "mail",
  label: { de: "E-Mail", en: "Email" },
  moduleId: null,
  defaultEnabled: true,
  isAvailable: (_context, user) => Boolean(user.email),
  send: (context, user, message, channelContext) => {
    const text = localizedMessage(message, user);
    return sendEventInfoMail(context, {
      to: user.email,
      username: user.username,
      displayName: user.displayName,
      locale: user.locale,
      eventName: message.eventName,
      subject: text.subject,
      body: text.body,
      eventPath: message.path,
      unsubscribeToken: channelContext.unsubscribeToken,
      attachments: message.mailAttachments,
      footerNote: text.mailFooterNote
    });
  }
};

const PUSH_BODY_LIMIT = 180;

const pushChannel: NotificationChannel = {
  id: "push",
  label: { de: "Push auf deinen Geräten", en: "Push on your devices" },
  moduleId: null,
  defaultEnabled: true,
  isAvailable: (context, user) =>
    // Ohne VAPID-Schlüssel kann der Server keine Push-Nachrichten senden.
    Boolean(getVapidPublicKey()) &&
    user.notificationsEnabled &&
    Boolean(
      context.db
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, user.id), isNull(pushSubscriptions.revokedAt)))
        .get()
    ),
  unavailableHint: {
    de: "Erst Benachrichtigungen auf einem Gerät einschalten.",
    en: "Turn on notifications on a device first."
  },
  send: (context, user, message) => {
    const text = localizedMessage(message, user);
    const body = text.body.replace(/\s+/g, " ").trim();
    return sendPushToUser(context, user.id, {
      title: `${message.eventName}: ${text.subject}`.slice(0, 120),
      body: body.length > PUSH_BODY_LIMIT ? `${body.slice(0, PUSH_BODY_LIMIT - 1)}…` : body,
      url: `/${message.path.replace(/^\/+/, "")}`
    });
  }
};

const channels = new Map<string, NotificationChannel>([
  [mailChannel.id, mailChannel],
  [pushChannel.id, pushChannel]
]);

const CHANNEL_ID = /^[a-z][a-z0-9]{1,31}$/;

/** Kanal eines Moduls anmelden (beim Aktivieren). Ein bestehender Kanal mit gleicher ID wird ersetzt. */
export function registerNotificationChannel(channel: NotificationChannel) {
  if (!CHANNEL_ID.test(channel.id) || channel.id === "mail" || channel.id === "push") {
    throw new Error(`Ungültige Kanal-ID: ${channel.id}`);
  }
  if (!channel.moduleId) {
    throw new Error("Modulkanäle brauchen eine moduleId");
  }
  channels.set(channel.id, channel);
}

/** Kanal beim Deaktivieren/Deinstallieren abmelden. Gespeicherte Auswahl der Benutzer bleibt. */
export function unregisterNotificationChannel(channelId: string) {
  if (channelId === "mail" || channelId === "push") {
    return false;
  }
  return channels.delete(channelId);
}

export function listNotificationChannels() {
  return Array.from(channels.values());
}

function preferencesOf(context: DatabaseContext, userIds: string[]) {
  const map = new Map<string, Map<string, boolean>>();
  if (userIds.length === 0) {
    return map;
  }
  const rows = context.db
    .select()
    .from(notificationChannelPreferences)
    .where(inArray(notificationChannelPreferences.userId, userIds))
    .all();
  for (const row of rows) {
    const forUser = map.get(row.userId) ?? new Map<string, boolean>();
    forUser.set(row.channelId, row.enabled);
    map.set(row.userId, forUser);
  }
  return map;
}

/** Kanalwahl eines Benutzers für die Profilseite. */
export function channelChoicesFor(context: DatabaseContext, user: NotificationUser) {
  const prefs = preferencesOf(context, [user.id]).get(user.id);
  return listNotificationChannels().map((channel) => ({
    id: channel.id,
    label: channel.label,
    moduleId: channel.moduleId,
    enabled: prefs?.get(channel.id) ?? channel.defaultEnabled,
    available: channel.isAvailable(context, user),
    unavailableHint: channel.unavailableHint ?? null
  }));
}

export function setChannelPreference(context: DatabaseContext, userId: string, channelId: string, enabled: boolean) {
  if (!channels.has(channelId)) {
    return false;
  }
  const timestamp = new Date().toISOString();
  context.db
    .insert(notificationChannelPreferences)
    .values({ userId, channelId, enabled, updatedAt: timestamp })
    .onConflictDoUpdate({
      target: [notificationChannelPreferences.userId, notificationChannelPreferences.channelId],
      set: { enabled, updatedAt: timestamp }
    })
    .run();
  // Wer wieder einen Kanal einschaltet, bekommt wieder Event-Infos.
  if (enabled) {
    context.db.update(users).set({ eventInfoUnsubscribedAt: null }).where(eq(users.id, userId)).run();
  }
  return true;
}

/** Persönlicher Abmeldelink-Token; wird beim ersten Bedarf angelegt und bleibt gleich. */
export function unsubscribeTokenFor(context: DatabaseContext, userId: string) {
  const existing = context.db
    .select({ token: notificationUnsubscribeTokens.token })
    .from(notificationUnsubscribeTokens)
    .where(eq(notificationUnsubscribeTokens.userId, userId))
    .get();
  if (existing) {
    return existing.token;
  }
  const token = randomBytes(24).toString("base64url");
  context.db
    .insert(notificationUnsubscribeTokens)
    .values({ token, userId, createdAt: new Date().toISOString() })
    .onConflictDoNothing()
    .run();
  return (
    context.db
      .select({ token: notificationUnsubscribeTokens.token })
      .from(notificationUnsubscribeTokens)
      .where(eq(notificationUnsubscribeTokens.userId, userId))
      .get()?.token ?? token
  );
}

/** Abmeldelink einlösen: keine Event-Infos mehr über irgendeinen Kanal. */
export function unsubscribeByToken(context: DatabaseContext, token: string) {
  const row = context.db
    .select({ userId: notificationUnsubscribeTokens.userId })
    .from(notificationUnsubscribeTokens)
    .where(eq(notificationUnsubscribeTokens.token, token))
    .get();
  if (!row) {
    return null;
  }
  context.db
    .update(users)
    .set({ eventInfoUnsubscribedAt: new Date().toISOString() })
    .where(and(eq(users.id, row.userId), isNull(users.eventInfoUnsubscribedAt)))
    .run();
  return row.userId;
}

export type Delivery = {
  userId: string;
  channelId: string;
  status: "sent" | "failed" | "skipped";
  error: string | null;
};

/**
 * Event-Info an Benutzer verschicken. Pro Benutzer über alle eingeschalteten und erreichbaren
 * Kanäle. Abgemeldete und gelöschte Benutzer bekommen nichts. Fehler eines Kanals stoppen die
 * anderen nicht.
 */
export async function notifyUsers(
  context: DatabaseContext,
  userIds: string[],
  message: EventInfoMessage,
  options: { onlyChannels?: string[] } = {}
): Promise<Delivery[]> {
  const uniqueIds = Array.from(new Set(userIds));
  if (uniqueIds.length === 0) {
    return [];
  }
  const recipients = context.db.select().from(users).where(inArray(users.id, uniqueIds)).all();
  const prefs = preferencesOf(context, uniqueIds);
  const deliveries: Delivery[] = [];

  await Promise.all(
    recipients.map(async (user) => {
      if (user.deletedAt || user.eventInfoUnsubscribedAt) {
        deliveries.push({ userId: user.id, channelId: "*", status: "skipped", error: "abgemeldet" });
        return;
      }
      const chosen = listNotificationChannels().filter(
        (channel) =>
          (!options.onlyChannels || options.onlyChannels.includes(channel.id)) &&
          (prefs.get(user.id)?.get(channel.id) ?? channel.defaultEnabled) && channel.isAvailable(context, user)
      );
      if (chosen.length === 0) {
        deliveries.push({ userId: user.id, channelId: "*", status: "skipped", error: "kein_kanal" });
        return;
      }
      const channelContext = { unsubscribeToken: unsubscribeTokenFor(context, user.id) };
      for (const channel of chosen) {
        try {
          await channel.send(context, user, message, channelContext);
          deliveries.push({ userId: user.id, channelId: channel.id, status: "sent", error: null });
        } catch (error) {
          console.error(`[Matchdesk] Event info via ${channel.id} failed`, error);
          deliveries.push({
            userId: user.id,
            channelId: channel.id,
            status: "failed",
            error: error instanceof Error ? error.message.slice(0, 200) : "unbekannt"
          });
        }
      }
    })
  );
  return deliveries;
}
