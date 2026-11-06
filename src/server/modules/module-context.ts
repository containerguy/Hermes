import type { Request, Router } from "express";
import type { DatabaseContext } from "../db/client";
import { readEnv } from "../env";
import { tryWriteAuditLog } from "../audit-log";
import { currentMainEventIdOf, publicUser, requireUser } from "../auth/current-user";
import { mainEventParticipants, mainEvents, users } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { canSeeMainEvent } from "../http/main-event-routes";
import { scopedEventIds, type PermissionKey } from "../domain/permissions";
import { requireCsrf } from "../auth/csrf";
import { getRawBody } from "../http/raw-body";
import { enforceApiTokenWriteAccess } from "../auth/matchdesk-auth";
import {
  sendPushToEnabledUsers,
  sendPushToMainEventParticipants,
  sendPushToUserIds,
  type PushPayload
} from "../push/push-service";
import { broadcastModuleEvent } from "../realtime/event-bus";
import { resolvePublicUrl } from "../mail/mailer";
import {
  localizedMessage,
  registerNotificationChannel,
  unregisterNotificationChannel,
  type EventInfoMessage,
  type NotificationUser
} from "../notifications/dispatcher";
import { coreEventNames, onCoreEvent, type CoreEventMap, type CoreEventName } from "./core-events";
import type { ModuleManifest } from "./manifest";
import { can, type CanOptions, type PermissionActor } from "./permissions";

export type ModuleUser = ReturnType<typeof publicUser>;

/** Nachricht an einen Modulkanal, schon in der Sprache des Empfängers. */
export type ModuleNotification = {
  mainEventId: string;
  eventName: string;
  subject: string;
  /** Klartext (Markdown erlaubt). */
  body: string;
  /** Pfad in der App, z. B. `#main-events`. */
  path: string;
  /** Absoluter Link in die App, wenn MATCHDESK_PUBLIC_URL gesetzt ist. */
  url: string | null;
  /** Persönlicher Abmeldelink des Empfängers, wenn MATCHDESK_PUBLIC_URL gesetzt ist. */
  unsubscribeUrl: string | null;
};

export type ModuleNotificationChannel = {
  /** Kanal-ID: beginnt mit der Modul-ID, z. B. `sms` im Modul `sms` oder `telegrambot` im Modul `telegram`. */
  id: string;
  label: { de: string; en: string };
  /** Kann der Kanal diesen Benutzer erreichen (Telefonnummer, verknüpftes Konto)? */
  isAvailable: (user: ModuleUser) => boolean;
  /** Steht im Profil, solange der Kanal den Benutzer nicht erreichen kann. */
  unavailableHint?: { de: string; en: string };
  /** Wirft bei Fehlern; der Kern protokolliert die Zustellung als fehlgeschlagen. */
  send: (user: ModuleUser, message: ModuleNotification) => Promise<void>;
};

export function toModuleNotification(message: EventInfoMessage, user: NotificationUser, unsubscribeToken: string): ModuleNotification {
  const text = localizedMessage(message, user);
  const publicUrl = resolvePublicUrl();
  return {
    mainEventId: message.mainEventId,
    eventName: message.eventName,
    subject: text.subject,
    body: text.body,
    path: message.path,
    url: publicUrl ? `${publicUrl}/${message.path.replace(/^\/+/, "")}` : null,
    unsubscribeUrl: publicUrl ? `${publicUrl}/api/notifications/unsubscribe/${encodeURIComponent(unsubscribeToken)}` : null
  };
}

/** Sicht eines Moduls auf ein Event (main_events). */
export type ModuleMainEvent = {
  id: string;
  name: string;
  status: "planned" | "running" | "ended";
  visibility: "public" | "private";
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
};

export type ModuleParticipantStatus = "joined" | "interested" | "waitlisted" | "declined";

export type ModuleRuntimeHandles = {
  router: Router;
  cleanups: Array<() => unknown>;
  timers: Set<NodeJS.Timeout>;
};

/**
 * Alles, was ein Modul vom Kern bekommt. Module importieren nie Kern-Code, sondern nutzen nur
 * dieses Objekt. Schnittstellen-Version: MATCHDESK_MODULE_API (manifest.ts).
 */
export type ModuleContext = {
  id: string;
  version: string;
  matchdeskApi: number;
  /** Express-Router, eingehängt unter /api/m/<id>. */
  router: Router;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  /** Angemeldeter Benutzer der Anfrage (oder undefined). */
  currentUser: (request: Request) => ModuleUser | undefined;
  /** Prüft CSRF und Schreibrecht des API-Tokens; antwortet selbst mit 401/403 und gibt dann false zurück. */
  requireWrite: (request: Request, response: import("express").Response) => boolean;
  /**
   * Unveränderter JSON-Body der Anfrage (z. B. für Webhook-Signaturen). Gesetzt nur für Anfragen
   * unter /api/m/<id> mit JSON-Body; sonst undefined. Kerne bis einschließlich 0.21.0 haben die
   * Funktion nicht – Module prüfen deshalb `typeof ctx.rawBody === "function"`.
   */
  rawBody: (request: Request) => Buffer | undefined;
  can: (user: PermissionActor, key: string, options?: CanOptions) => boolean;
  /** Events, für die der Benutzer `key` nur per Event-Vergabe hat (ohne globale Vergabe). */
  scopedEventIds: (user: PermissionActor, key: string) => string[];
  settings: {
    get: () => Record<string, unknown>;
    /** Ändert einzelne Werte (geprüft gegen das Schema, im Audit-Log). Wirft bei ungültigen Werten. */
    set: (values: Record<string, unknown>, actor: { id: string; username: string; role: string }) => Record<string, unknown>;
  };
  /** Events des Kerns, nur lesend. */
  events: {
    get: (mainEventId: string) => ModuleMainEvent | null;
    /** Aktuelles Event des Benutzers (globaler Umschalter), null wenn keins oder beendet. */
    currentIdOf: (user: { id: string }) => string | null;
    /** Darf der Benutzer das Event sehen (öffentlich, eingeladen oder Event-Verwalter)? */
    canSee: (user: PermissionActor, mainEventId: string) => boolean;
    participantStatus: (mainEventId: string, userId: string) => ModuleParticipantStatus | null;
  };
  /** Liest ein im Manifest unter `secrets` genanntes Geheimnis (MATCHDESK_<NAME> oder im Admin eingetragen). */
  env: (name: string) => string | undefined;
  /** better-sqlite3-Verbindung. Module schreiben nur in eigene Tabellen (Präfix = Kennung). */
  db: DatabaseContext["sqlite"];
  audit: (input: {
    actor?: { id: string; username: string } | null;
    action: string;
    summary: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }) => void;
  push: {
    toUsers: (userIds: string[], payload: PushPayload) => Promise<void>;
    /** Alle Benutzer mit eingeschalteten Benachrichtigungen. */
    toAll: (payload: PushPayload) => Promise<void>;
    /** Teilnehmer („dabei“) eines Events. */
    toEventParticipants: (mainEventId: string, payload: PushPayload) => Promise<void>;
  };
  /**
   * Eigener Benachrichtigungskanal (Opt-in im Profil). Wird beim Ausschalten, Aktualisieren und
   * Herunterfahren automatisch abgemeldet; die gespeicherte Auswahl der Benutzer bleibt.
   */
  notifications: { registerChannel: (channel: ModuleNotificationChannel) => void };
  realtime: { broadcast: (event: string, data?: unknown) => void };
  http: { fetch: typeof fetch };
  schedule: (intervalMs: number, task: () => unknown) => () => void;
  on: <K extends CoreEventName>(name: K, handler: (payload: CoreEventMap[K]) => unknown) => void;
  /** Aufräumen beim Ausschalten, Aktualisieren und Herunterfahren. */
  onStop: (cleanup: () => unknown) => void;
};

export type ModuleServerEntry = {
  register: (ctx: ModuleContext) => unknown;
};

export function createModuleContext(input: {
  context: DatabaseContext;
  manifest: ModuleManifest;
  handles: ModuleRuntimeHandles;
  getSettings: () => Record<string, unknown>;
  /** Liest Zugangsdaten (Umgebung, sonst im Admin eingetragen); ohne nur aus der Umgebung. */
  readSecret?: (name: string) => string | undefined;
  setSettings?: (values: Record<string, unknown>, actor: { id: string; username: string; role: string }) => Record<string, unknown>;
}): ModuleContext {
  const { context, manifest, handles } = input;
  const id = manifest.id;
  const prefix = `[Matchdesk:${id}]`;
  return {
    id,
    version: manifest.version,
    matchdeskApi: manifest.matchdeskApi,
    router: handles.router,
    log: {
      info: (...args) => console.info(prefix, ...args),
      warn: (...args) => console.warn(prefix, ...args),
      error: (...args) => console.error(prefix, ...args)
    },
    currentUser: (request) => {
      const user = requireUser(context, request);
      return user ? publicUser(user) : undefined;
    },
    requireWrite: (request, response) => requireCsrf(context, request, response) && enforceApiTokenWriteAccess(request, response),
    rawBody: (request) => getRawBody(request),
    can: (user, key, options) => can(context, user, key, options),
    scopedEventIds: (user, key) => {
      if (!user || !key.startsWith(`${id}.`)) return [];
      const row = context.db.select().from(users).where(eq(users.id, user.id)).get();
      return row ? scopedEventIds(context, row, key as PermissionKey) : [];
    },
    settings: {
      get: input.getSettings,
      set: (values, actor) => {
        if (!input.setSettings) throw new Error(`${prefix} Einstellungen können hier nicht geändert werden.`);
        return input.setSettings(values, actor);
      }
    },
    events: {
      get: (mainEventId) => {
        const row = context.db.select().from(mainEvents).where(eq(mainEvents.id, mainEventId)).get();
        return row
          ? {
              id: row.id,
              name: row.name,
              status: row.status,
              visibility: row.visibility,
              plannedStartAt: row.plannedStartAt,
              plannedEndAt: row.plannedEndAt,
              startedAt: row.startedAt,
              endedAt: row.endedAt
            }
          : null;
      },
      currentIdOf: (user) => {
        const row = context.db.select({ currentMainEventId: users.currentMainEventId }).from(users).where(eq(users.id, user.id)).get();
        return row ? currentMainEventIdOf(context, row) : null;
      },
      canSee: (user, mainEventId) => {
        if (!user) return false;
        const viewer = context.db.select().from(users).where(eq(users.id, user.id)).get();
        const event = context.db.select().from(mainEvents).where(eq(mainEvents.id, mainEventId)).get();
        return Boolean(viewer && event && canSeeMainEvent(context, viewer, event));
      },
      participantStatus: (mainEventId, userId) =>
        context.db
          .select({ status: mainEventParticipants.status })
          .from(mainEventParticipants)
          .where(and(eq(mainEventParticipants.mainEventId, mainEventId), eq(mainEventParticipants.userId, userId)))
          .get()?.status ?? null
    },
    env: (name) => {
      if (!manifest.secrets.includes(name)) {
        throw new Error(`${prefix} Geheimnis ${name} ist nicht im Manifest angemeldet.`);
      }
      return input.readSecret ? input.readSecret(name) : readEnv(name);
    },
    db: context.sqlite,
    audit: (entry) =>
      tryWriteAuditLog(context, {
        actor: entry.actor ?? undefined,
        action: `${id}.${entry.action}`,
        entityType: `module:${id}`,
        entityId: entry.entityId ?? null,
        summary: entry.summary,
        metadata: entry.metadata
      }),
    push: {
      toUsers: (userIds, payload) => sendPushToUserIds(context, userIds, payload),
      toAll: (payload) => sendPushToEnabledUsers(context, payload),
      toEventParticipants: (mainEventId, payload) => sendPushToMainEventParticipants(context, mainEventId, payload)
    },
    notifications: {
      registerChannel: (channel) => {
        if (!channel.id.startsWith(id)) {
          throw new Error(`${prefix} Kanal-ID ${channel.id} muss mit der Modul-ID ${id} beginnen.`);
        }
        registerNotificationChannel({
          id: channel.id,
          label: channel.label,
          moduleId: id,
          defaultEnabled: false,
          unavailableHint: channel.unavailableHint,
          isAvailable: (_context, user) => {
            try {
              return channel.isAvailable(publicUser(user));
            } catch (error) {
              console.error(prefix, `Kanal ${channel.id}: isAvailable`, error);
              return false;
            }
          },
          send: (_context, user, message, channelContext) =>
            channel.send(publicUser(user), toModuleNotification(message, user, channelContext.unsubscribeToken))
        });
        handles.cleanups.push(() => unregisterNotificationChannel(channel.id));
      }
    },
    realtime: { broadcast: (event, data) => broadcastModuleEvent(id, event, data) },
    http: { fetch: (...args) => fetch(...args) },
    schedule: (intervalMs, task) => {
      const timer = setInterval(
        () => {
          try {
            const result = task();
            if (result && typeof (result as Promise<unknown>).catch === "function") {
              (result as Promise<unknown>).catch((error) => console.error(prefix, "Hintergrundaufgabe", error));
            }
          } catch (error) {
            console.error(prefix, "Hintergrundaufgabe", error);
          }
        },
        Math.max(1000, intervalMs)
      );
      timer.unref?.();
      handles.timers.add(timer);
      return () => {
        clearInterval(timer);
        handles.timers.delete(timer);
      };
    },
    on: (name, handler) => {
      if (!(coreEventNames as readonly string[]).includes(name)) {
        throw new Error(`${prefix} Unbekanntes Kern-Ereignis ${name}`);
      }
      handles.cleanups.push(onCoreEvent(name, handler));
    },
    onStop: (cleanup) => {
      handles.cleanups.push(cleanup);
    }
  };
}
