import type { Request, Router } from "express";
import type { DatabaseContext } from "../db/client";
import { readEnv } from "../env";
import { tryWriteAuditLog } from "../audit-log";
import { publicUser, requireUser } from "../auth/current-user";
import { requireCsrf } from "../auth/csrf";
import { enforceApiTokenWriteAccess } from "../auth/matchdesk-auth";
import { sendPushToUserIds, type PushPayload } from "../push/push-service";
import { broadcastModuleEvent } from "../realtime/event-bus";
import { coreEventNames, onCoreEvent, type CoreEventMap, type CoreEventName } from "./core-events";
import type { ModuleManifest } from "./manifest";
import { can, type CanOptions, type PermissionActor } from "./permissions";

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
  currentUser: (request: Request) => ReturnType<typeof publicUser> | undefined;
  /** Prüft CSRF und Schreibrecht des API-Tokens; antwortet selbst mit 401/403 und gibt dann false zurück. */
  requireWrite: (request: Request, response: import("express").Response) => boolean;
  can: (user: PermissionActor, key: string, options?: CanOptions) => boolean;
  settings: { get: () => Record<string, unknown> };
  /** Liest ein im Manifest unter `secrets` genanntes Geheimnis (MATCHDESK_<NAME>). */
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
  push: { toUsers: (userIds: string[], payload: PushPayload) => Promise<void> };
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
    can: (user, key, options) => can(context, user, key, options),
    settings: { get: input.getSettings },
    env: (name) => {
      if (!manifest.secrets.includes(name)) {
        throw new Error(`${prefix} Geheimnis ${name} ist nicht im Manifest angemeldet.`);
      }
      return readEnv(name);
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
    push: { toUsers: (userIds, payload) => sendPushToUserIds(context, userIds, payload) },
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
