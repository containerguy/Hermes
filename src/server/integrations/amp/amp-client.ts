import { Agent, fetch as undiciFetch } from "undici";
import type { HermesSettings } from "../../settings";

const USER_AGENT = "Hermes-AMP-Integration/1.0";
const REQUEST_MS = 25_000;

export type HermesAmpInstanceRow = {
  id: string;
  friendlyName: string;
  module: string;
  serverHost: string;
  connectionInfo: string;
};

function normalizeAmpBaseUrl(raw: string): string {
  let candidate = raw.trim();
  if (!candidate) {
    throw new Error("amp_base_leer");
  }
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `http://${candidate}`;
  }
  const parsed = new URL(candidate);
  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname.toLowerCase().endsWith("/api")) {
    pathname = pathname.slice(0, -4) || "";
  }
  const hostBase = `${parsed.protocol}//${parsed.host}`;
  if (!pathname || pathname === "/") {
    return `${hostBase}/`;
  }
  return `${hostBase}${pathname}/`;
}

function isAmpApiError(value: unknown): value is { Title?: string; Message?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    ("Title" in value || "Message" in value || "StackTrace" in value)
  );
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

function unwrapAmpData(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "result" in raw) {
    return (raw as { result: unknown }).result;
  }
  return raw;
}

async function ampPostJson(
  baseUrl: string,
  endpoint: string,
  body: Record<string, unknown>,
  sessionId: string,
  skipTlsVerify: boolean
): Promise<unknown> {
  const url = `${baseUrl}API/${endpoint}`;
  const dispatcher =
    skipTlsVerify && url.startsWith("https:")
      ? new Agent({ connect: { rejectUnauthorized: false } })
      : undefined;

  const response = await undiciFetch(url, {
    method: "POST",
    dispatcher,
    headers: {
      "Content-Type": "application/json",
      Accept: "text/javascript",
      "User-Agent": USER_AGENT
    },
    body: JSON.stringify({ ...body, SESSIONID: sessionId }),
    signal: AbortSignal.timeout(REQUEST_MS)
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("amp_antwort_unlesbar");
  }

  if (!response.ok) {
    throw new Error("amp_http_fehler");
  }

  if (isAmpApiError(parsed)) {
    const msg = [parsed.Title, parsed.Message].filter(Boolean).join(": ");
    throw new Error(msg || "amp_api_fehler");
  }

  return parsed;
}

export async function fetchAmpInstances(settings: HermesSettings): Promise<HermesAmpInstanceRow[]> {
  if (!settings.ampIntegrationEnabled) {
    throw new Error("amp_deaktiviert");
  }
  const baseUrl = normalizeAmpBaseUrl(settings.ampBaseUrl);
  const skipTls = settings.ampTlsSkipVerify;
  const username = settings.ampUsername.trim();
  const password = settings.ampPassword;
  if (!username || !password) {
    throw new Error("amp_nicht_konfiguriert");
  }

  const loginRaw = await ampPostJson(
    baseUrl,
    "Core/Login",
    {
      username,
      password,
      token: "",
      rememberMe: false
    },
    "",
    skipTls
  );

  const login = loginRaw as { success?: boolean; sessionID?: string };
  if (!login?.success || !login.sessionID) {
    throw new Error("amp_auth_fehlgeschlagen");
  }

  const sessionId = login.sessionID;
  const instancesRaw = unwrapAmpData(
    await ampPostJson(baseUrl, "ADSModule/GetInstances", {}, sessionId, skipTls)
  );
  const instanceRows = asRecordArray(instancesRaw);

  const rows: HermesAmpInstanceRow[] = [];

  for (const inst of instanceRows) {
    const id = pickInstanceId(inst);
    const friendlyName = pickFriendlyName(inst) || id || "Instance";
    const moduleName = pickModule(inst);

    let endpoints: Record<string, unknown>[] = [];
    if (id) {
      try {
        const epRaw = unwrapAmpData(
          await ampPostJson(
            baseUrl,
            "ADSModule/GetApplicationEndpoints",
            { instanceId: id },
            sessionId,
            skipTls
          )
        );
        endpoints = asRecordArray(epRaw);
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
        if (host) {
          return host;
        }
        return "";
      })
      .filter(Boolean);

    const serverHost = hostPorts.length > 0 ? hostPorts.join(", ") : "";
    const connectionInfo =
      lines.length > 0 ? lines.join("\n") : serverHost ? `Endpoints: ${serverHost}` : "";

    rows.push({
      id: id || friendlyName,
      friendlyName,
      module: moduleName,
      serverHost,
      connectionInfo
    });
  }

  rows.sort((a, b) => a.friendlyName.localeCompare(b.friendlyName, "de"));
  return rows;
}
