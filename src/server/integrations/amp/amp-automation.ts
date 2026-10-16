import { and, inArray, isNull } from "drizzle-orm";
import { writeAuditLog } from "../../audit-log";
import type { DatabaseContext } from "../../db/client";
import { gameEvents } from "../../db/schema";
import { getBinding } from "../../domain/gameservers/bindings";
import { sendPushToEventParticipants } from "../../push/push-service";
import { readSettings } from "../../settings";
import { runControlAction } from "./amp-control";
import { getAllServerStatus, getServerStatus, pollNow, type ServerStatus } from "./amp-status";

/**
 * Automatik (Phase 15-04, D-15/D-16): Auto-Start bei `ready`, Auto-Stop nach Leerlauf und
 * Push „Server läuft". `runAutomationTick` ist rein — alle Seiteneffekte laufen über `deps`,
 * damit Tests ohne AMP, Datenbank und Uhr auskommen (gleiche Bauweise wie `deriveEventStatus`).
 */

export type AutomationEvent = {
  id: string;
  status: "open" | "ready" | "running";
  serverBindingId: string | null;
  gameTitle: string;
};

export type AutomationDeps = {
  now(): Date;
  listActiveEvents(): AutomationEvent[];
  getStatus(bindingId: string): ServerStatus | null;
  listStatuses(): ServerStatus[];
  start(bindingId: string): Promise<void>;
  stop(bindingId: string): Promise<void>;
  pushRunning(eventId: string, gameTitle: string): Promise<void>;
  settings: { ampAutoStartOnReady: boolean; ampAutoStopIdleMinutes: number };
  logError?(message: string, error: unknown): void;
};

export type AutomationState = {
  /** Erster Tick nach Prozessstart ist gelaufen. */
  initialized: boolean;
  /** Events, für die über den Auto-Start entschieden wurde (höchstens einmal pro Event). */
  startHandled: Record<string, true>;
  /** Events, deren Push „Server läuft" erledigt ist (gesendet oder bewusst ausgelassen). */
  pushHandled: Record<string, true>;
  /**
   * Events, die beim Prozessstart schon aktiv waren und noch keinen bekannten Serverzustand hatten.
   * Ihr erster bekannter Zustand ist die Basis: läuft der Server schon, gibt es keinen Push.
   */
  pushBaseline: Record<string, true>;
  /** Beginn der Leerlaufphase je Bindung (ms seit Epoch). */
  idleSince: Record<string, number>;
};

export function createAutomationState(): AutomationState {
  return { initialized: false, startHandled: {}, pushHandled: {}, pushBaseline: {}, idleSince: {} };
}

/** Zwischenzustände: kein Auto-Start, solange AMP gerade etwas tut. */
const TRANSITIONAL_STATES = new Set([
  "PreStart",
  "Configuring",
  "Starting",
  "Restarting",
  "Stopping",
  "Waiting",
  "Installing",
  "Updating",
  "AwaitingUserInput",
  "Maintenance"
]);

function isKnown(status: ServerStatus | null): status is ServerStatus {
  return Boolean(status) && !status!.error;
}

export async function runAutomationTick(deps: AutomationDeps, previous: AutomationState): Promise<AutomationState> {
  const state: AutomationState = {
    initialized: previous.initialized,
    startHandled: { ...previous.startHandled },
    pushHandled: { ...previous.pushHandled },
    pushBaseline: { ...previous.pushBaseline },
    idleSince: { ...previous.idleSince }
  };
  const logError = deps.logError ?? ((message, error) => console.error(message, error));
  const events = deps.listActiveEvents();
  const activeIds = new Set(events.map((event) => event.id));

  // Erster Tick nach (Neu-)Start: nichts auslösen, nur den aktuellen Stand übernehmen. Sonst gingen bei
  // jedem Deploy Pushes raus, und ein bewusst gestoppter Server eines bereiten Events würde neu gestartet.
  if (!state.initialized) {
    for (const event of events) {
      state.pushBaseline[event.id] = true;
      if (event.status === "ready" || event.status === "running") {
        state.startHandled[event.id] = true;
      }
    }
    state.initialized = true;
  }

  // Zustand für Events aufräumen, die nicht mehr aktiv sind (archiviert, storniert, gelöscht).
  for (const record of [state.startHandled, state.pushHandled, state.pushBaseline]) {
    for (const id of Object.keys(record)) {
      if (!activeIds.has(id)) delete record[id];
    }
  }

  const startedBindings = new Set<string>();
  const eventsByBinding = new Map<string, AutomationEvent[]>();
  for (const event of events) {
    if (!event.serverBindingId) continue;
    const list = eventsByBinding.get(event.serverBindingId) ?? [];
    list.push(event);
    eventsByBinding.set(event.serverBindingId, list);
  }

  for (const event of events) {
    const bindingId = event.serverBindingId;
    if (!bindingId) continue;
    const status = deps.getStatus(bindingId);
    if (!isKnown(status)) continue;

    // Push „Server läuft" (D-16): einmal pro Event, sobald der Server beitretbar ist (inkl. Sleeping).
    if (state.pushBaseline[event.id]) {
      delete state.pushBaseline[event.id];
      if (status.running) state.pushHandled[event.id] = true;
    } else if (status.running && !state.pushHandled[event.id]) {
      state.pushHandled[event.id] = true;
      try {
        await deps.pushRunning(event.id, event.gameTitle);
      } catch (error) {
        logError(`[Hermes] AMP-Automatik: Push für Event ${event.id} fehlgeschlagen`, error);
      }
    }

    // Auto-Start (D-15): höchstens einmal pro Event, damit ein Manager einen Server bewusst stoppen kann.
    if (!deps.settings.ampAutoStartOnReady) continue;
    if (event.status !== "ready" && event.status !== "running") continue;
    if (state.startHandled[event.id]) continue;
    if (status.running) {
      // Läuft schon (auch Ruhemodus) — erledigt, ohne Start.
      state.startHandled[event.id] = true;
      continue;
    }
    if (TRANSITIONAL_STATES.has(status.appState)) continue;

    // Alle bereiten Events dieser Bindung gelten als bedient, damit ein späteres Stoppen respektiert wird.
    for (const sibling of eventsByBinding.get(bindingId) ?? []) {
      if (sibling.status === "ready" || sibling.status === "running") state.startHandled[sibling.id] = true;
    }
    if (startedBindings.has(bindingId)) continue;
    startedBindings.add(bindingId);
    try {
      await deps.start(bindingId);
    } catch (error) {
      logError(`[Hermes] AMP-Automatik: Start von ${status.ampInstanceName} fehlgeschlagen`, error);
    }
  }

  // Auto-Stop (D-15): kein aktives Event auf der Bindung und die ganze Leerlaufzeit über 0 Spieler.
  const idleMinutes = deps.settings.ampAutoStopIdleMinutes;
  const nowMs = deps.now().getTime();
  const statuses = deps.listStatuses();
  const knownBindings = new Set(statuses.map((status) => status.bindingId));
  for (const id of Object.keys(state.idleSince)) {
    if (!knownBindings.has(id)) delete state.idleSince[id];
  }

  for (const status of statuses) {
    const bindingId = status.bindingId;
    const idle =
      idleMinutes > 0 &&
      !eventsByBinding.has(bindingId) &&
      !startedBindings.has(bindingId) &&
      !status.error &&
      status.running &&
      // players === null (Metrik fehlt) zählt nicht als leer
      status.players === 0;
    if (!idle) {
      delete state.idleSince[bindingId];
      continue;
    }
    const since = state.idleSince[bindingId] ?? nowMs;
    state.idleSince[bindingId] = since;
    if (nowMs - since < idleMinutes * 60_000) continue;

    delete state.idleSince[bindingId];
    try {
      await deps.stop(bindingId);
    } catch (error) {
      logError(`[Hermes] AMP-Automatik: Stopp von ${status.ampInstanceName} fehlgeschlagen`, error);
    }
  }

  return state;
}

/* ---------- Laufzeit: Deps aus Datenbank, Statusdienst und AMP ---------- */

const DEFAULT_INTERVAL_MS = 30_000;

let timer: NodeJS.Timeout | null = null;
let running: Promise<void> | null = null;
let automationState = createAutomationState();
let activeContext: DatabaseContext | null = null;

function listActiveEvents(context: DatabaseContext): AutomationEvent[] {
  return context.db
    .select({
      id: gameEvents.id,
      status: gameEvents.status,
      serverBindingId: gameEvents.serverBindingId,
      gameTitle: gameEvents.gameTitle
    })
    .from(gameEvents)
    .where(and(inArray(gameEvents.status, ["open", "ready", "running"]), isNull(gameEvents.deletedAt)))
    .all() as AutomationEvent[];
}

async function runAutomaticAction(context: DatabaseContext, bindingId: string, action: "start" | "stop") {
  const settings = readSettings(context);
  const binding = getBinding(context, bindingId);
  if (!settings.ampIntegrationEnabled || !binding || !binding.enabled) {
    return;
  }
  await runControlAction(settings, binding, action);
  writeAuditLog(context, {
    actor: undefined,
    action: `amp.auto_${action}`,
    entityType: "game_server_binding",
    entityId: binding.id,
    summary:
      action === "start"
        ? `Automatik: ${binding.ampInstanceName} (${binding.displayTitle}) gestartet, Event ist bereit.`
        : `Automatik: ${binding.ampInstanceName} (${binding.displayTitle}) nach Leerlauf gestoppt.`,
    metadata: { ampInstanceName: binding.ampInstanceName, action }
  });
  void pollNow(context);
}

export function buildAutomationDeps(context: DatabaseContext): AutomationDeps {
  const settings = readSettings(context);
  return {
    now: () => new Date(),
    listActiveEvents: () => (settings.ampIntegrationEnabled ? listActiveEvents(context) : []),
    getStatus: getServerStatus,
    listStatuses: () => (settings.ampIntegrationEnabled ? getAllServerStatus() : []),
    start: (bindingId) => runAutomaticAction(context, bindingId, "start"),
    stop: (bindingId) => runAutomaticAction(context, bindingId, "stop"),
    pushRunning: (eventId, gameTitle) =>
      // Keine Serverdaten im Payload; Adresse und Verbinden-Knopf holt der Client nach dem Login.
      sendPushToEventParticipants(context, eventId, {
        title: `Server für ${gameTitle} läuft`,
        body: "Du bist dabei – jetzt verbinden.",
        url: "/#events"
      }),
    settings: {
      ampAutoStartOnReady: settings.ampAutoStartOnReady,
      ampAutoStopIdleMinutes: settings.ampAutoStopIdleMinutes
    }
  };
}

/** Ein Durchlauf gegen die echte Umgebung; überlappende Läufe werden zusammengelegt. */
export function runAutomationNow(context?: DatabaseContext): Promise<void> {
  const ctx = context ?? activeContext;
  if (!ctx) {
    return Promise.resolve();
  }
  if (!running) {
    running = (async () => {
      try {
        automationState = await runAutomationTick(buildAutomationDeps(ctx), automationState);
      } catch (error) {
        console.error("[Hermes] AMP-Automatik: Tick fehlgeschlagen", error);
      }
    })().finally(() => {
      running = null;
    });
  }
  return running;
}

export function startAmpAutomation(context: DatabaseContext, opts?: { intervalMs?: number }) {
  stopAmpAutomation();
  automationState = createAutomationState();
  activeContext = context;
  timer = setInterval(() => {
    void runAutomationNow(context);
  }, opts?.intervalMs ?? DEFAULT_INTERVAL_MS);
  timer.unref?.();
}

export function stopAmpAutomation() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  activeContext = null;
}
