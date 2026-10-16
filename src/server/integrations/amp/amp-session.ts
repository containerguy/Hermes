import fs from "node:fs";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { getAmpCaFile, getAmpCredentials } from "../../env";
import type { HermesSettings } from "../../settings";

/**
 * Eine AMP-Session pro Hermes-Prozess (Phase 15, D-03/D-04).
 *
 * - Login einmal mit `rememberMe: true`; die SESSIONID wird für alle Aufrufe wiederverwendet.
 * - Alle Aufrufe laufen seriell durch eine Warteschlange, damit das AMP-Login-Rate-Limit nie greift.
 * - Verliert AMP die Session, wird genau einmal neu angemeldet (zuerst mit dem rememberMe-Token,
 *   dann mit dem Passwort) und der Aufruf wiederholt.
 * - TLS wird gegen HERMES_AMP_CA_FILE verifiziert; es gibt bewusst keinen skipVerify-Pfad.
 */

const USER_AGENT = "Hermes-AMP-Integration/1.0";
const REQUEST_MS = 25_000;

type FetchLike = typeof undiciFetch;

export type AmpSession = { sessionId: string; obtainedAt: number; baseUrl: string };

let fetchImpl: FetchLike = undiciFetch;
let session: AmpSession | null = null;
/** Instanz-ID -> Instanz-SESSIONID (siehe ampInstanceCall). */
const instanceSessions = new Map<string, string>();
let loginInFlight: Promise<AmpSession> | null = null;
let rememberToken: string | null | undefined; // undefined = noch nicht von Platte gelesen
let queue: Promise<unknown> = Promise.resolve();
let dispatcherCache: { caFile: string; dispatcher: Dispatcher } | null = null;

export function normalizeAmpBaseUrl(raw: string): string {
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

/** Nur für Tests: Fetch austauschen und den gesamten Modulzustand zurücksetzen. */
export function setAmpFetchForTests(fn: FetchLike | null) {
  fetchImpl = fn ?? undiciFetch;
  resetAmpSession();
  rememberToken = undefined;
  dispatcherCache = null;
}

export function resetAmpSession() {
  session = null;
  loginInFlight = null;
  // Instanz-Sitzungen hängen am Controller-Login; nach dessen Verlust neu anmelden.
  instanceSessions.clear();
}

export function unwrapAmpData(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "result" in raw) {
    return (raw as { result: unknown }).result;
  }
  return raw;
}

function isAmpApiError(value: unknown): value is { Title?: string; Message?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    ("Title" in value || "Message" in value || "StackTrace" in value)
  );
}

function isSessionLost(status: number, parsed: unknown): boolean {
  if (status === 401 || status === 403) {
    return true;
  }
  if (!isAmpApiError(parsed)) {
    return false;
  }
  const text = `${parsed.Title ?? ""} ${parsed.Message ?? ""}`;
  return /Session\.Exists|Unauthorized|not logged in|session/i.test(text);
}

function getDispatcher(): Dispatcher | undefined {
  const caFile = getAmpCaFile();
  if (!caFile) {
    return undefined;
  }
  if (dispatcherCache?.caFile === caFile) {
    return dispatcherCache.dispatcher;
  }
  let ca: string;
  try {
    ca = fs.readFileSync(caFile, "utf8");
  } catch {
    throw new Error("amp_ca_ungueltig");
  }
  const dispatcher = new Agent({ connect: { ca } });
  dispatcherCache = { caFile, dispatcher };
  return dispatcher;
}

function readRememberToken(file: string | undefined): string | null {
  if (rememberToken !== undefined) {
    return rememberToken;
  }
  if (!file) {
    rememberToken = null;
    return null;
  }
  try {
    rememberToken = fs.readFileSync(file, "utf8").trim() || null;
  } catch {
    rememberToken = null;
  }
  return rememberToken;
}

function storeRememberToken(file: string | undefined, token: string | null) {
  rememberToken = token;
  if (!file || !token) {
    return;
  }
  try {
    fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  } catch (error) {
    console.warn("[Hermes] AMP rememberMe-Token konnte nicht gespeichert werden:", error);
  }
}

async function rawPost(
  baseUrl: string,
  endpoint: string,
  body: Record<string, unknown>
): Promise<{ status: number; parsed: unknown }> {
  const response = await fetchImpl(`${baseUrl}API/${endpoint}`, {
    method: "POST",
    dispatcher: getDispatcher(),
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_MS)
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("amp_antwort_unlesbar");
    }
  }
  return { status: response.status, parsed };
}

type LoginResponse = {
  success?: boolean;
  sessionID?: string;
  rememberMeToken?: string;
  resultReason?: string;
};

async function loginOnce(baseUrl: string, username: string, secret: string): Promise<LoginResponse> {
  const { status, parsed } = await rawPost(baseUrl, "Core/Login", {
    username,
    password: secret,
    token: "",
    rememberMe: true
  });
  if (status >= 400) {
    throw new Error("amp_http_fehler");
  }
  if (isAmpApiError(parsed)) {
    throw new Error("amp_auth_fehlgeschlagen");
  }
  return (parsed ?? {}) as LoginResponse;
}

async function performLogin(settings: HermesSettings): Promise<AmpSession> {
  const creds = getAmpCredentials();
  if (!creds) {
    throw new Error("amp_zugang_erforderlich");
  }
  const baseUrl = normalizeAmpBaseUrl(settings.ampBaseUrl);

  let login: LoginResponse | null = null;
  const remembered = readRememberToken(creds.rememberTokenFile);
  if (remembered) {
    try {
      const attempt = await loginOnce(baseUrl, creds.username, remembered);
      if (attempt.success && attempt.sessionID) {
        login = attempt;
      }
    } catch {
      login = null;
    }
  }
  if (!login) {
    login = await loginOnce(baseUrl, creds.username, creds.password);
  }
  if (!login.success || !login.sessionID) {
    storeRememberToken(creds.rememberTokenFile, null);
    throw new Error("amp_auth_fehlgeschlagen");
  }
  storeRememberToken(creds.rememberTokenFile, login.rememberMeToken ?? null);
  return { sessionId: login.sessionID, obtainedAt: Date.now(), baseUrl };
}

export function getAmpSession(settings: HermesSettings): Promise<AmpSession> {
  if (session) {
    return Promise.resolve(session);
  }
  if (!loginInFlight) {
    loginInFlight = performLogin(settings)
      .then((next) => {
        session = next;
        return next;
      })
      .finally(() => {
        loginInFlight = null;
      });
  }
  return loginInFlight;
}

async function callWithSession(
  settings: HermesSettings,
  method: string,
  body: Record<string, unknown>,
  allowRetry: boolean
): Promise<unknown> {
  const current = await getAmpSession(settings);
  const { status, parsed } = await rawPost(current.baseUrl, method, {
    ...body,
    SESSIONID: current.sessionId
  });

  if (isSessionLost(status, parsed)) {
    resetAmpSession();
    if (allowRetry) {
      return callWithSession(settings, method, body, false);
    }
    throw new Error("amp_auth_fehlgeschlagen");
  }
  if (status >= 400) {
    throw new Error("amp_http_fehler");
  }
  if (isAmpApiError(parsed)) {
    const message = [parsed.Title, parsed.Message].filter(Boolean).join(": ");
    throw new Error(message || "amp_api_fehler");
  }
  return parsed;
}

/**
 * Serialisierter AMP-Aufruf. Modul-Gate (`ampIntegrationEnabled`) prüft der Aufrufer.
 * Liefert die rohe JSON-Antwort; `unwrapAmpData()` holt bei Bedarf `result` heraus.
 */
export function ampCall<T = unknown>(
  settings: HermesSettings,
  method: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const run = queue.then(() => callWithSession(settings, method, body, true)) as Promise<T>;
  queue = run.catch(() => undefined);
  return run;
}

/* ---------- Instanz-Sitzungen ----------
 * Die Controller-Session gilt NICHT auf den Instanzen: Aufrufe über `ADSModule/Servers/{id}/API/…`
 * scheitern sonst mit "requires the Session.Exists permission". Jede Instanz braucht einen eigenen
 * Login über denselben Proxy (verifiziert 2026-10-16 gegen amp-ctl, alle Targets).
 */
function instancePath(instanceId: string, method: string) {
  return `ADSModule/Servers/${encodeURIComponent(instanceId)}/API/${method}`;
}

async function instanceLogin(settings: HermesSettings, instanceId: string): Promise<string> {
  const creds = getAmpCredentials();
  if (!creds) {
    throw new Error("amp_zugang_erforderlich");
  }
  const raw = (await callWithSession(
    settings,
    instancePath(instanceId, "Core/Login"),
    { username: creds.username, password: creds.password, token: "", rememberMe: false },
    true
  )) as LoginResponse | null;
  if (!raw?.success || !raw.sessionID) {
    throw new Error("amp_auth_fehlgeschlagen");
  }
  instanceSessions.set(instanceId, raw.sessionID);
  return raw.sessionID;
}

async function callInstance(
  settings: HermesSettings,
  instanceId: string,
  method: string,
  body: Record<string, unknown>,
  allowRetry: boolean
): Promise<unknown> {
  const current = await getAmpSession(settings);
  const sessionId = instanceSessions.get(instanceId) ?? (await instanceLogin(settings, instanceId));
  const { status, parsed } = await rawPost(current.baseUrl, instancePath(instanceId, method), {
    ...body,
    SESSIONID: sessionId
  });

  if (isSessionLost(status, parsed)) {
    instanceSessions.delete(instanceId);
    if (allowRetry) {
      return callInstance(settings, instanceId, method, body, false);
    }
    throw new Error("amp_auth_fehlgeschlagen");
  }
  if (status >= 400) {
    throw new Error("amp_http_fehler");
  }
  if (isAmpApiError(parsed)) {
    const title = parsed.Title ?? "";
    if (/Instance Unavailable/i.test(title)) {
      // Instanz (AMP-Prozess) läuft nicht — Sitzung verwerfen, sie gilt nach dem Start nicht mehr
      instanceSessions.delete(instanceId);
      throw new Error("amp_instanz_nicht_verfuegbar");
    }
    const message = [parsed.Title, parsed.Message].filter(Boolean).join(": ");
    throw new Error(message || "amp_api_fehler");
  }
  return parsed;
}

/** Serialisierter Aufruf einer Methode auf einer Instanz (eigene Instanz-Session, Re-Login bei Ablauf). */
export function ampInstanceCall<T = unknown>(
  settings: HermesSettings,
  instanceId: string,
  method: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const run = queue.then(() => callInstance(settings, instanceId, method, body, true)) as Promise<T>;
  queue = run.catch(() => undefined);
  return run;
}
