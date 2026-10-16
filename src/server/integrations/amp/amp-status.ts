import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import type { DatabaseContext } from "../../db/client";
import { listBindings, type GameServerBinding } from "../../domain/gameservers/bindings";
import { broadcastServersChanged } from "../../realtime/event-bus";
import { readSettings } from "../../settings";
import { flattenAmpInstances } from "./amp-client";
import { ampCall } from "./amp-session";

/**
 * Statusdienst (Phase 15, D-08): pollt `ADSModule/GetInstances`, hält pro gebundener Instanz den
 * Zustand im Speicher und verteilt Änderungen als SSE-Ereignis `servers_changed`.
 * Läuft nur, wenn das Modul aktiv ist und mindestens eine aktive Bindung existiert.
 */

export type ServerStatus = {
  bindingId: string;
  ampInstanceId: string;
  ampInstanceName: string;
  /** AMP-Instanz (Prozess/Container) läuft. */
  instanceRunning: boolean;
  /** Spieler können sich verbinden (AppState Ready oder Ruhemodus/Sleeping). */
  running: boolean;
  appState: string;
  /** Spiel laut AMP (ModuleDisplayName, sonst Modulname) — wählt in der UI die Befehlsvorlagen. */
  game: string | null;
  players: number | null;
  maxPlayers: number | null;
  host: string;
  /**
   * IPv4 des Hosts, serverseitig aufgelöst. `steam://connect/` akzeptiert nur IP-Adressen
   * (mit DNS-Namen verwirft Steam den Link ohne Meldung) — getestet 2026-10-16.
   */
  connectIp: string | null;
  port: number;
  connectScheme: GameServerBinding["connectScheme"];
  updatedAt: string;
  error: string | null;
};

const DNS_TTL_MS = 5 * 60 * 1000;
const dnsCache = new Map<string, { ip: string | null; at: number }>();

/** Löst die Hosts der Bindungen zu IPv4 auf (5 min Cache, IP-Literale direkt, Fehler = null). */
export async function resolveBindingHosts(bindings: GameServerBinding[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const now = Date.now();
  await Promise.all(
    [...new Set(bindings.map((b) => b.host))].map(async (host) => {
      if (isIP(host) === 4) {
        out.set(host, host);
        return;
      }
      const cached = dnsCache.get(host);
      if (cached && now - cached.at < DNS_TTL_MS) {
        out.set(host, cached.ip);
        return;
      }
      let ip: string | null = null;
      try {
        ip = (await dns.lookup(host, { family: 4 })).address;
      } catch {
        ip = null;
      }
      dnsCache.set(host, { ip, at: now });
      out.set(host, ip);
    })
  );
  return out;
}

/** AMP ApplicationState (numerisch in GetInstances) -> Name. */
const APP_STATE_NAMES: Record<number, string> = {
  [-1]: "Undefined",
  0: "Stopped",
  5: "PreStart",
  7: "Configuring",
  10: "Starting",
  20: "Ready",
  30: "Restarting",
  40: "Stopping",
  45: "PreparingForSleep",
  50: "Sleeping",
  60: "Waiting",
  70: "Installing",
  75: "Updating",
  80: "AwaitingUserInput",
  100: "Failed",
  200: "Suspended",
  250: "Maintenance",
  999: "Indeterminate"
};

export function appStateName(raw: unknown): string {
  if (typeof raw === "number") {
    return APP_STATE_NAMES[raw] ?? `State${raw}`;
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  return "Undefined";
}

const DEFAULT_INTERVAL_MS = 15_000;

/** Zustände, in denen Spieler sich verbinden können (Ready oder Ruhemodus). */
const JOINABLE_STATES = new Set(["Ready", "PreparingForSleep", "Sleeping"]);

const cache = new Map<string, ServerStatus>();
let timer: ReturnType<typeof setInterval> | null = null;
let polling: Promise<void> | null = null;
let lastErrorLogged: string | null = null;
let activeContext: DatabaseContext | null = null;

function nowIso() {
  return new Date().toISOString();
}

function readPlayers(row: Record<string, unknown>): { players: number | null; maxPlayers: number | null } {
  const metrics = row.Metrics ?? row.metrics;
  if (!metrics || typeof metrics !== "object") {
    return { players: null, maxPlayers: null };
  }
  const active = (metrics as Record<string, unknown>)["Active Users"];
  if (!active || typeof active !== "object") {
    return { players: null, maxPlayers: null };
  }
  const raw = (active as Record<string, unknown>).RawValue;
  const max = (active as Record<string, unknown>).MaxValue;
  return {
    players: typeof raw === "number" ? raw : null,
    maxPlayers: typeof max === "number" && max > 0 ? max : null
  };
}

function readGame(row: Record<string, unknown>): string | null {
  for (const key of ["ModuleDisplayName", "Module"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function statusEquals(a: ServerStatus | undefined, b: ServerStatus): boolean {
  if (!a) return false;
  return (
    a.instanceRunning === b.instanceRunning &&
    a.running === b.running &&
    a.appState === b.appState &&
    a.game === b.game &&
    a.players === b.players &&
    a.maxPlayers === b.maxPlayers &&
    a.error === b.error &&
    a.host === b.host &&
    a.connectIp === b.connectIp &&
    a.port === b.port
  );
}

function baseStatus(
  binding: GameServerBinding,
  ips: Map<string, string | null>
): Omit<ServerStatus, "instanceRunning" | "running" | "appState" | "game" | "players" | "maxPlayers" | "updatedAt" | "error"> {
  return {
    bindingId: binding.id,
    ampInstanceId: binding.ampInstanceId,
    ampInstanceName: binding.ampInstanceName,
    host: binding.host,
    connectIp: ips.get(binding.host) ?? (isIP(binding.host) === 4 ? binding.host : null),
    port: binding.port,
    connectScheme: binding.connectScheme
  };
}

/**
 * Ein Poll-Durchlauf. Reine Funktion über `raw` (GetInstances-Antwort) + Bindungen, damit Tests
 * ohne Netz laufen. Gibt zurück, ob sich etwas geändert hat.
 */
export function applyInstancesSnapshot(
  raw: unknown,
  bindings: GameServerBinding[],
  error: string | null = null,
  ips: Map<string, string | null> = new Map()
): boolean {
  const byId = new Map<string, Record<string, unknown>>();
  if (!error) {
    for (const { row } of flattenAmpInstances(raw)) {
      const id = String(row.InstanceID ?? row.InstanceId ?? row.id ?? "");
      if (id) byId.set(id, row);
    }
  }

  let changed = false;
  const seen = new Set<string>();
  const timestamp = nowIso();

  for (const binding of bindings) {
    seen.add(binding.id);
    const previous = cache.get(binding.id);
    let next: ServerStatus;

    if (error) {
      next = {
        ...baseStatus(binding, ips),
        instanceRunning: previous?.instanceRunning ?? false,
        running: previous?.running ?? false,
        appState: previous?.appState ?? "Undefined",
        game: previous?.game ?? null,
        players: previous?.players ?? null,
        maxPlayers: previous?.maxPlayers ?? null,
        updatedAt: previous?.updatedAt ?? timestamp,
        error
      };
    } else {
      const row = byId.get(binding.ampInstanceId);
      if (!row) {
        next = {
          ...baseStatus(binding, ips),
          instanceRunning: false,
          running: false,
          appState: "Undefined",
          game: null,
          players: null,
          maxPlayers: null,
          updatedAt: timestamp,
          error: "amp_instanz_unbekannt"
        };
      } else {
        const appState = appStateName(row.AppState ?? row.appState);
        next = {
          ...baseStatus(binding, ips),
          instanceRunning: row.Running === true || row.running === true,
          // Ruhemodus (Universal Sleep): Server wacht beim ersten Verbindungsversuch auf -> beitretbar
          running: JOINABLE_STATES.has(appState),
          appState,
          game: readGame(row),
          ...readPlayers(row),
          updatedAt: timestamp,
          error: null
        };
      }
    }

    if (!statusEquals(previous, next)) {
      changed = true;
      cache.set(binding.id, next);
    } else if (previous) {
      // Zeitstempel aktualisieren, ohne Broadcast auszulösen
      cache.set(binding.id, { ...previous, updatedAt: timestamp });
    }
  }

  for (const key of [...cache.keys()]) {
    if (!seen.has(key)) {
      cache.delete(key);
      changed = true;
    }
  }

  return changed;
}

async function pollOnce(context: DatabaseContext): Promise<void> {
  const settings = readSettings(context);
  const bindings = settings.ampIntegrationEnabled ? listBindings(context, { enabledOnly: true }) : [];

  if (bindings.length === 0) {
    if (cache.size > 0) {
      cache.clear();
      broadcastServersChanged(getAllServerStatus());
    }
    return;
  }

  const ips = await resolveBindingHosts(bindings);
  let changed: boolean;
  try {
    const raw = await ampCall(settings, "ADSModule/GetInstances");
    changed = applyInstancesSnapshot(raw, bindings, null, ips);
    if (lastErrorLogged) {
      console.info("[Hermes] AMP-Status wieder erreichbar");
      lastErrorLogged = null;
    }
  } catch (caught) {
    const code = caught instanceof Error ? caught.message : "amp_anfrage_fehlgeschlagen";
    if (lastErrorLogged !== code) {
      console.warn("[Hermes] AMP-Status-Poll fehlgeschlagen:", code);
      lastErrorLogged = code;
    }
    changed = applyInstancesSnapshot(null, bindings, code, ips);
  }

  if (changed) {
    broadcastServersChanged(getAllServerStatus());
  }
}

/** Sofortiger Poll (z. B. nach einer Steueraktion); überlappende Läufe werden zusammengelegt. */
export function pollNow(context?: DatabaseContext): Promise<void> {
  const ctx = context ?? activeContext;
  if (!ctx) {
    return Promise.resolve();
  }
  if (!polling) {
    polling = pollOnce(ctx).finally(() => {
      polling = null;
    });
  }
  return polling;
}

export function startAmpStatusService(context: DatabaseContext, opts?: { intervalMs?: number }) {
  stopAmpStatusService();
  activeContext = context;
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  timer = setInterval(() => {
    void pollNow(context);
  }, intervalMs);
  timer.unref?.();
  void pollNow(context);
}

export function stopAmpStatusService() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  activeContext = null;
}

/** Nur für Tests. */
export function resetAmpStatusForTests() {
  stopAmpStatusService();
  cache.clear();
  dnsCache.clear();
  polling = null;
  lastErrorLogged = null;
}

export function getServerStatus(bindingId: string): ServerStatus | null {
  return cache.get(bindingId) ?? null;
}

export function getAllServerStatus(): ServerStatus[] {
  return [...cache.values()].sort((a, b) => a.ampInstanceName.localeCompare(b.ampInstanceName, "de"));
}
