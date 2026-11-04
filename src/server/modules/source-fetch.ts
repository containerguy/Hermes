import { createHash } from "node:crypto";
import { readEnv } from "../env";

/**
 * Herunterladen von Index-Dateien und Paketen einer Modul-Quelle, nur per HTTPS und ohne git.
 */

export type ModuleFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export class SourceFetchError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "SourceFetchError";
  }
}

export const INDEX_FILE = "matchdesk-source.json";
export const MAX_INDEX_BYTES = 1024 * 1024;
export const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;
/** Nur Variablen mit diesem Präfix dürfen als Token einer Quelle dienen. */
export const SOURCE_TOKEN_ENV_PREFIX = "MATCHDESK_SOURCE_TOKEN_";

function allowInsecureHttp() {
  return readEnv("MODULES_ALLOW_HTTP") === "true";
}

export function assertFetchableUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SourceFetchError(`Ungültige Adresse: ${raw}`, "quelle_url_ungueltig");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && allowInsecureHttp())) {
    throw new SourceFetchError("Quellen und Pakete werden nur per HTTPS geladen.", "quelle_nur_https");
  }
  if (url.username || url.password) {
    throw new SourceFetchError("Zugangsdaten gehören nicht in die Adresse.", "quelle_url_ungueltig");
  }
  return url;
}

/**
 * Adresse der Index-Datei: Bei GitHub-Repos die Rohdatei auf dem Zweig, sonst direkt die
 * angegebene .json-Datei oder `<url>/matchdesk-source.json`.
 */
export function resolveIndexUrl(sourceUrl: string, ref: string) {
  const url = assertFetchableUrl(sourceUrl);
  if (url.hostname === "github.com") {
    const [owner, repo] = url.pathname.replace(/^\/+/, "").replace(/\.git$/, "").split("/");
    if (!owner || !repo) {
      throw new SourceFetchError("GitHub-Adresse muss auf ein Repo zeigen.", "quelle_url_ungueltig");
    }
    return `https://raw.githubusercontent.com/${owner}/${repo.replace(/\.git$/, "")}/${encodeURIComponent(ref)}/${INDEX_FILE}`;
  }
  if (url.pathname.endsWith(".json")) {
    return url.toString();
  }
  return new URL(INDEX_FILE, url.toString().endsWith("/") ? url : `${url.toString()}/`).toString();
}

export function resolvePackageUrl(indexUrl: string, packageUrl: string) {
  return assertFetchableUrl(new URL(packageUrl, indexUrl).toString()).toString();
}

/** Token nur an den Host der Quelle (bzw. die GitHub-Hosts bei GitHub-Quellen) schicken. */
function tokenHosts(sourceUrl: string) {
  const host = new URL(sourceUrl).hostname;
  if (host === "github.com") {
    return new Set(["github.com", "raw.githubusercontent.com", "api.github.com", "objects.githubusercontent.com"]);
  }
  return new Set([host]);
}

export function validateTokenEnvName(name: string | null | undefined) {
  if (!name) return null;
  if (!name.startsWith(SOURCE_TOKEN_ENV_PREFIX) || !/^[A-Z0-9_]+$/.test(name)) {
    throw new SourceFetchError(
      `Token-Variable muss mit ${SOURCE_TOKEN_ENV_PREFIX} beginnen (nur A–Z, 0–9, _).`,
      "quelle_token_name_ungueltig"
    );
  }
  return name;
}

export function authHeaders(source: { url: string; tokenEnv: string | null }, targetUrl: string): Record<string, string> {
  if (!source.tokenEnv) return {};
  const token = process.env[source.tokenEnv]?.trim();
  if (!token) return {};
  if (!tokenHosts(source.url).has(new URL(targetUrl).hostname)) return {};
  return { Authorization: `Bearer ${token}` };
}

export async function fetchLimited(
  fetchImpl: ModuleFetch,
  url: string,
  maxBytes: number,
  headers: Record<string, string> = {}
): Promise<Buffer> {
  let response: Awaited<ReturnType<ModuleFetch>>;
  try {
    response = await fetchImpl(url, { headers });
  } catch (error) {
    throw new SourceFetchError(
      `Download fehlgeschlagen (${error instanceof Error ? error.message : "Netzwerkfehler"})`,
      "quelle_nicht_erreichbar"
    );
  }
  if (!response.ok) {
    throw new SourceFetchError(`Download fehlgeschlagen (HTTP ${response.status})`, "quelle_nicht_erreichbar");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new SourceFetchError("Download ist zu groß.", "paket_zu_gross");
  }
  return buffer;
}

export function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export const defaultModuleFetch: ModuleFetch = (url, init) =>
  fetch(url, { headers: init?.headers, redirect: "follow" }) as ReturnType<ModuleFetch>;
