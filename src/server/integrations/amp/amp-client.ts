import type { HermesSettings } from "../../settings";
import { ampCall, unwrapAmpData } from "./amp-session";

export type HermesAmpInstanceRow = {
  id: string;
  friendlyName: string;
  instanceName: string;
  module: string;
  /** Anzeigename der Vorlage, z. B. "Counter-Strike 1.6" (GenericModule) — leer bei Minecraft. */
  moduleDisplayName: string;
  targetName: string;
  /** DNS-Name/IP des Targets aus dessen URL, z. B. cs2.lanparty.familie-keller.info. */
  targetHost: string;
  /** Spielport aus dem ersten Nicht-SFTP-Endpunkt, sonst null. */
  gamePort: number | null;
  running: boolean;
  serverHost: string;
  connectionInfo: string;
};

function hostFromUrl(raw: string): string {
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).hostname;
  } catch {
    return raw.split(":")[0] ?? "";
  }
}

/** Spielport aus `ApplicationEndpoints`: bevorzugt "… Address", nie den SFTP-Server. */
export function pickGamePort(endpoints: Record<string, unknown>[]): number | null {
  const candidates = endpoints
    .filter((ep) => !/sftp/i.test(pickString(ep, ["DisplayName", "Description", "Name"])))
    .map((ep) => {
      const endpoint = pickString(ep, ["Endpoint", "endpoint"]);
      const m = /:(\d{2,5})$/.exec(endpoint);
      const port = m ? Number(m[1]) : typeof ep.Port === "number" ? ep.Port : NaN;
      return { port, name: pickString(ep, ["DisplayName", "Description", "Name"]) };
    })
    .filter((c) => Number.isInteger(c.port) && c.port > 0 && c.port < 65536);
  const preferred = candidates.find((c) => /address/i.test(c.name)) ?? candidates[0];
  return preferred ? preferred.port : null;
}

function asRecordArray(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null);
  }
  if (raw && typeof raw === "object") {
    return Object.values(raw as object).filter(
      (x): x is Record<string, unknown> => typeof x === "object" && x !== null
    );
  }
  return [];
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return "";
}

function pickInstanceId(row: Record<string, unknown>): string {
  return pickString(row, ["InstanceID", "InstanceId", "ID", "Id", "id"]);
}

function pickFriendlyName(row: Record<string, unknown>): string {
  return pickString(row, ["FriendlyName", "friendlyName", "InstanceName", "instanceName", "Name"]);
}

function pickModule(row: Record<string, unknown>): string {
  return pickString(row, ["Module", "module", "ApplicationName", "applicationName"]);
}

function formatEndpointLine(ep: Record<string, unknown>): string {
  const host = pickString(ep, ["Host", "host", "IP", "ip", "Address", "address"]);
  const port = ep.Port ?? ep.port;
  const desc = pickString(ep, ["Description", "description", "Name", "name", "Protocol", "protocol"]);
  const portPart = typeof port === "number" && Number.isFinite(port) ? `:${port}` : "";
  const addr = host ? `${host}${portPart}` : typeof port === "number" ? `:${port}` : "";
  if (addr && desc) {
    return `${desc}: ${addr}`;
  }
  if (addr) {
    return addr;
  }
  return desc;
}

/**
 * `ADSModule/GetInstances` liefert auf einem Controller (und auch auf einem Standalone-ADS) eine
 * Liste von Targets, deren Instanzen unter `AvailableInstances` liegen. Hier wird das flachgezogen;
 * ADS-Instanzen selbst (Module "ADS") werden ausgelassen.
 */
export function flattenAmpInstances(
  raw: unknown
): Array<{ row: Record<string, unknown>; targetName: string; targetHost: string }> {
  const out: Array<{ row: Record<string, unknown>; targetName: string; targetHost: string }> = [];
  for (const target of asRecordArray(unwrapAmpData(raw))) {
    const nested = target.AvailableInstances ?? target.availableInstances;
    if (nested !== undefined) {
      // FriendlyName enthält bei manchen Targets den Panel-Port ("retro.lan:8080") — nur der Name zählt.
      const targetName =
        pickString(target, ["FriendlyName", "friendlyName", "Name"]).replace(/:\d+$/, "") || "Local";
      const targetHost = hostFromUrl(pickString(target, ["URL", "Url", "url"]) || targetName);
      for (const row of asRecordArray(nested)) {
        if (pickModule(row) !== "ADS") {
          out.push({ row, targetName, targetHost });
        }
      }
    } else if (pickInstanceId(target)) {
      if (pickModule(target) !== "ADS") {
        out.push({ row: target, targetName: "", targetHost: "" });
      }
    }
  }
  return out;
}

export async function fetchAmpInstances(settings: HermesSettings): Promise<HermesAmpInstanceRow[]> {
  if (!settings.ampIntegrationEnabled) {
    throw new Error("amp_deaktiviert");
  }

  const instances = flattenAmpInstances(await ampCall(settings, "ADSModule/GetInstances"));
  const rows: HermesAmpInstanceRow[] = [];

  for (const { row: inst, targetName, targetHost } of instances) {
    const id = pickInstanceId(inst);
    const friendlyName = pickFriendlyName(inst) || id || "Instance";
    const instanceName = pickString(inst, ["InstanceName", "instanceName"]) || friendlyName;
    const moduleName = pickModule(inst);
    const moduleDisplayName = pickString(inst, ["ModuleDisplayName", "moduleDisplayName"]);
    const running = inst.Running === true || inst.running === true;

    let endpoints: Record<string, unknown>[] = [];
    const inline = inst.ApplicationEndpoints ?? inst.applicationEndpoints;
    if (inline !== undefined) {
      endpoints = asRecordArray(inline);
    } else if (id) {
      try {
        endpoints = asRecordArray(
          unwrapAmpData(
            await ampCall(settings, "ADSModule/GetApplicationEndpoints", { instanceId: id })
          )
        );
      } catch {
        endpoints = [];
      }
    }

    const lines = endpoints.map((ep) => formatEndpointLine(ep)).filter(Boolean);
    const hostPorts = endpoints
      .map((ep) => {
        const host = pickString(ep, ["Host", "host", "IP", "ip", "Address", "address"]);
        const port = ep.Port ?? ep.port;
        if (host && typeof port === "number" && Number.isFinite(port)) {
          return `${host}:${port}`;
        }
        return host;
      })
      .filter(Boolean);

    const serverHost = hostPorts.length > 0 ? hostPorts.join(", ") : "";
    const connectionInfo =
      lines.length > 0 ? lines.join("\n") : serverHost ? `Endpoints: ${serverHost}` : "";

    rows.push({
      id: id || friendlyName,
      friendlyName,
      instanceName,
      module: moduleName,
      moduleDisplayName,
      targetName,
      targetHost,
      gamePort: pickGamePort(endpoints),
      running,
      serverHost,
      connectionInfo
    });
  }

  rows.sort((a, b) => a.friendlyName.localeCompare(b.friendlyName, "de"));
  return rows;
}
