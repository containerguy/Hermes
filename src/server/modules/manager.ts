import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import type { DatabaseContext } from "../db/client";
import { getDatabasePath, readEnv } from "../env";
import { tryWriteAuditLog } from "../audit-log";
import { requireCsrf } from "../auth/csrf";
import { enforceApiTokenWriteAccess, resolveMatchdeskAuth } from "../auth/matchdesk-auth";
import type { UserRole } from "../domain/users";
import {
  compareVersions,
  localize,
  MATCHDESK_MODULE_API,
  moduleManifestSchema,
  sourceIndexSchema,
  type ModuleManifest,
  type SourceIndex
} from "./manifest";
import { appliedModuleMigrations, moduleMigrationFiles, runModuleMigrations, runModuleUninstall } from "./module-migrations";
import { can, registerModulePermissions, removeModulePermissions } from "./permissions";
import {
  assertFetchableUrl,
  authHeaders,
  defaultModuleFetch,
  fetchLimited,
  MAX_INDEX_BYTES,
  MAX_PACKAGE_BYTES,
  resolveIndexUrl,
  resolvePackageUrl,
  sha256,
  SourceFetchError,
  validateTokenEnvName,
  type ModuleFetch
} from "./source-fetch";
import { PackageFormatError, readTarGz, type TarEntry } from "./tar";
import { createModuleContext, type ModuleRuntimeHandles, type ModuleServerEntry } from "./module-context";

export class ModuleError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message?: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message ?? code);
    this.name = "ModuleError";
  }
}

export type ModuleActor = { id: string; username: string; role: UserRole };

export type ModuleSourceRow = {
  id: string;
  name: string;
  url: string;
  ref: string;
  trust: "official" | "third_party";
  tokenEnv: string | null;
  lastFetchedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ModuleState = "installed" | "enabled" | "disabled";

export type ModuleRow = {
  id: string;
  sourceId: string | null;
  version: string;
  sha256: string;
  packageUrl: string | null;
  previousVersion: string | null;
  state: ModuleState;
  manifest: ModuleManifest;
  lastError: string | null;
  installedAt: string;
  enabledAt: string | null;
  updatedAt: string;
};

type RawModuleRow = Omit<ModuleRow, "manifest" | "sourceId" | "packageUrl" | "previousVersion" | "lastError" | "installedAt" | "enabledAt" | "updatedAt"> & {
  source_id: string | null;
  package_url: string | null;
  previous_version: string | null;
  manifest_json: string;
  last_error: string | null;
  installed_at: string;
  enabled_at: string | null;
  updated_at: string;
};

type Runtime = ModuleRuntimeHandles & {
  id: string;
  version: string;
  manifest: ModuleManifest;
  directory: string;
};

type DownloadedPackage = {
  manifest: ModuleManifest;
  entries: TarEntry[];
  sha256: string;
  packageUrl: string;
};

export type ModuleManagerOptions = {
  modulesDir?: string;
  fetch?: ModuleFetch;
  /**
   * Fest im Kern hinterlegte Ausnahmen von der Präfix-Regel: Modul → fremde Tabellen, die seine
   * Migrationen ändern dürfen (z. B. AMP-Entkopplung von game_events). Niemals aus dem Manifest.
   */
  coreTableExceptions?: Record<string, readonly string[]>;
};

export const sourceInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().min(1).max(500),
  ref: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._/-]+$/).default("main"),
  trust: z.enum(["official", "third_party"]).default("third_party"),
  tokenEnv: z.string().trim().max(100).nullable().optional()
});

export const sourceUpdateSchema = sourceInputSchema.partial();

const PACKAGE_FILE = "package.tgz";

export function defaultModulesDir() {
  return readEnv("MODULES_DIR") ?? path.join(path.dirname(getDatabasePath()), "modules");
}

function nowIso() {
  return new Date().toISOString();
}

function mapSource(row: Record<string, unknown>): ModuleSourceRow {
  return {
    id: row.id as string,
    name: row.name as string,
    url: row.url as string,
    ref: row.ref as string,
    trust: row.trust as ModuleSourceRow["trust"],
    tokenEnv: (row.token_env as string | null) ?? null,
    lastFetchedAt: (row.last_fetched_at as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  };
}

function mapModule(row: RawModuleRow): ModuleRow {
  return {
    id: row.id,
    sourceId: row.source_id,
    version: row.version,
    sha256: row.sha256,
    packageUrl: row.package_url,
    previousVersion: row.previous_version,
    state: row.state,
    manifest: moduleManifestSchema.parse(JSON.parse(row.manifest_json)),
    lastError: row.last_error,
    installedAt: row.installed_at,
    enabledAt: row.enabled_at,
    updatedAt: row.updated_at
  };
}

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/** Einstellungs-Vorgaben aus dem JSON-Schema (`default` je Eigenschaft). */
export function settingsDefaults(manifest: ModuleManifest): Record<string, unknown> {
  const properties = (manifest.settings?.properties ?? {}) as Record<string, { default?: unknown }>;
  const result: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(properties)) {
    if (property && typeof property === "object" && "default" in property) {
      result[key] = property.default;
    }
  }
  return result;
}

function settingsValidator(manifest: ModuleManifest) {
  if (!manifest.settings) {
    return z.object({}).strict();
  }
  return z.fromJSONSchema(manifest.settings as Parameters<typeof z.fromJSONSchema>[0]);
}

const CONTENT_TYPES: Record<string, string> = {
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
};

export function createModuleManager(context: DatabaseContext, options: ModuleManagerOptions = {}) {
  const modulesDir = options.modulesDir ?? defaultModulesDir();
  const fetchImpl = options.fetch ?? defaultModuleFetch;
  const coreTableExceptions = options.coreTableExceptions ?? {};
  const runtimes = new Map<string, Runtime>();
  const runtimeErrors = new Map<string, string>();
  const indexCache = new Map<string, { index: SourceIndex; indexUrl: string; at: number }>();
  const previewCache = new Map<string, { pkg: DownloadedPackage; at: number }>();
  const sqlite = context.sqlite;
  const locks = new Map<string, Promise<unknown>>();

  /** Lebenszyklus-Schritte je Modul nacheinander ausführen (kein doppeltes Starten). */
  function withLock<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = locks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    locks.set(id, next);
    void next.finally(() => {
      if (locks.get(id) === next) locks.delete(id);
    }).catch(() => undefined);
    return next;
  }

  // ---------- Quellen ----------

  function listSources(): ModuleSourceRow[] {
    return (sqlite.prepare("SELECT * FROM module_sources ORDER BY trust = 'official' DESC, name").all() as Record<string, unknown>[]).map(
      mapSource
    );
  }

  function getSource(id: string) {
    const row = sqlite.prepare("SELECT * FROM module_sources WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapSource(row) : undefined;
  }

  function requireSource(id: string) {
    const source = getSource(id);
    if (!source) throw new ModuleError("quelle_nicht_gefunden", 404);
    return source;
  }

  function activeModulesOfSource(sourceId: string) {
    return (
      sqlite.prepare("SELECT id FROM modules WHERE source_id = ? AND state = 'enabled'").all(sourceId) as Array<{ id: string }>
    ).map((row) => row.id);
  }

  function checkSourceInput(input: { url: string; ref: string; tokenEnv?: string | null }) {
    try {
      resolveIndexUrl(input.url, input.ref);
      validateTokenEnvName(input.tokenEnv);
    } catch (error) {
      if (error instanceof SourceFetchError) throw new ModuleError(error.code, 400, error.message);
      throw error;
    }
  }

  function addSource(actor: ModuleActor, raw: unknown) {
    const input = sourceInputSchema.parse(raw);
    checkSourceInput(input);
    const id = randomUUID();
    const at = nowIso();
    try {
      sqlite
        .prepare(
          "INSERT INTO module_sources (id, name, url, ref, trust, token_env, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(id, input.name, input.url, input.ref, input.trust, input.tokenEnv || null, at, at);
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new ModuleError("quelle_existiert", 409);
      throw error;
    }
    audit(actor, "module.source_added", "module_source", id, `Modul-Quelle ${input.name} hinzugefügt`, {
      url: input.url,
      ref: input.ref,
      trust: input.trust
    });
    return requireSource(id);
  }

  function updateSource(actor: ModuleActor, id: string, raw: unknown) {
    const existing = requireSource(id);
    const active = activeModulesOfSource(id);
    if (active.length > 0) {
      throw new ModuleError("quelle_hat_aktive_module", 409, undefined, { modules: active });
    }
    const patch = sourceUpdateSchema.parse(raw);
    const next = {
      name: patch.name ?? existing.name,
      url: patch.url ?? existing.url,
      ref: patch.ref ?? existing.ref,
      trust: patch.trust ?? existing.trust,
      tokenEnv: patch.tokenEnv === undefined ? existing.tokenEnv : patch.tokenEnv || null
    };
    checkSourceInput(next);
    sqlite
      .prepare("UPDATE module_sources SET name = ?, url = ?, ref = ?, trust = ?, token_env = ?, last_error = NULL, updated_at = ? WHERE id = ?")
      .run(next.name, next.url, next.ref, next.trust, next.tokenEnv, nowIso(), id);
    indexCache.delete(id);
    audit(actor, "module.source_updated", "module_source", id, `Modul-Quelle ${next.name} geändert`, next);
    return requireSource(id);
  }

  function deleteSource(actor: ModuleActor, id: string) {
    const existing = requireSource(id);
    const active = activeModulesOfSource(id);
    if (active.length > 0) {
      throw new ModuleError("quelle_hat_aktive_module", 409, undefined, { modules: active });
    }
    sqlite.prepare("DELETE FROM module_sources WHERE id = ?").run(id);
    indexCache.delete(id);
    audit(actor, "module.source_deleted", "module_source", id, `Modul-Quelle ${existing.name} gelöscht`, { url: existing.url });
  }

  async function fetchSourceIndex(sourceId: string, { force = false } = {}) {
    const source = requireSource(sourceId);
    const cached = indexCache.get(sourceId);
    if (!force && cached && Date.now() - cached.at < 5 * 60 * 1000) {
      return { source, ...cached };
    }
    try {
      const indexUrl = resolveIndexUrl(source.url, source.ref);
      const buffer = await fetchLimited(fetchImpl, indexUrl, MAX_INDEX_BYTES, authHeaders(source, indexUrl));
      let parsed: unknown;
      try {
        parsed = JSON.parse(buffer.toString("utf8"));
      } catch {
        throw new ModuleError("quelle_index_ungueltig", 502, "Index-Datei ist kein gültiges JSON.");
      }
      const result = sourceIndexSchema.safeParse(parsed);
      if (!result.success) {
        throw new ModuleError("quelle_index_ungueltig", 502, result.error.issues.map((issue) => issue.message).join("; "));
      }
      const entry = { index: result.data, indexUrl, at: Date.now() };
      indexCache.set(sourceId, entry);
      sqlite.prepare("UPDATE module_sources SET last_fetched_at = ?, last_error = NULL WHERE id = ?").run(nowIso(), sourceId);
      return { source, ...entry };
    } catch (error) {
      sqlite.prepare("UPDATE module_sources SET last_error = ? WHERE id = ?").run(errorText(error), sourceId);
      if (error instanceof SourceFetchError) throw new ModuleError(error.code, 502, error.message);
      throw error;
    }
  }

  /** Module einer Quelle mit installiertem Stand und Update-Empfehlung. */
  async function listAvailable(sourceId: string, { force = false } = {}) {
    const { index } = await fetchSourceIndex(sourceId, { force });
    return index.modules.map((module) => {
      const installed = getModule(module.id);
      const compatible = module.versions
        .filter((version) => version.matchdeskApi === MATCHDESK_MODULE_API)
        .sort((a, b) => compareVersions(b.version, a.version));
      const latest = compatible[0] ?? null;
      return {
        id: module.id,
        name: module.name,
        description: module.description ?? null,
        versions: module.versions
          .map((version) => ({
            version: version.version,
            matchdeskApi: version.matchdeskApi,
            compatible: version.matchdeskApi === MATCHDESK_MODULE_API,
            publishedAt: version.publishedAt ?? null,
            changelog: version.changelog ?? null
          }))
          .sort((a, b) => compareVersions(b.version, a.version)),
        latestCompatible: latest?.version ?? null,
        installed: installed
          ? { version: installed.version, state: installed.state, fromThisSource: installed.sourceId === sourceId }
          : null,
        updateAvailable: Boolean(
          installed && installed.sourceId === sourceId && latest && compareVersions(latest.version, installed.version) > 0
        )
      };
    });
  }

  /** Update-Empfehlungen für alle installierten Module (Quellen, die nicht erreichbar sind, werden übersprungen). */
  async function checkUpdates({ force = false } = {}) {
    const result: Array<{ id: string; installed: string; latest: string; sourceId: string }> = [];
    const errors: Array<{ sourceId: string; error: string }> = [];
    const bySource = new Map<string, ModuleRow[]>();
    for (const module of listModules()) {
      if (!module.sourceId) continue;
      bySource.set(module.sourceId, [...(bySource.get(module.sourceId) ?? []), module]);
    }
    for (const [sourceId, modules] of bySource) {
      try {
        const available = await listAvailable(sourceId, { force });
        for (const module of modules) {
          const entry = available.find((candidate) => candidate.id === module.id);
          if (entry?.updateAvailable && entry.latestCompatible) {
            result.push({ id: module.id, installed: module.version, latest: entry.latestCompatible, sourceId });
          }
        }
      } catch (error) {
        errors.push({ sourceId, error: error instanceof ModuleError ? error.code : errorText(error) });
      }
    }
    return { updates: result, errors };
  }

  // ---------- Pakete ----------

  function parsePackage(entries: TarEntry[]): ModuleManifest {
    const manifestEntry = entries.find((entry) => entry.path === "manifest.json");
    if (!manifestEntry) throw new ModuleError("paket_ohne_manifest", 422, "Paket enthält keine manifest.json.");
    let raw: unknown;
    try {
      raw = JSON.parse(manifestEntry.data.toString("utf8"));
    } catch {
      throw new ModuleError("manifest_ungueltig", 422, "manifest.json ist kein gültiges JSON.");
    }
    const result = moduleManifestSchema.safeParse(raw);
    if (!result.success) {
      throw new ModuleError(
        "manifest_ungueltig",
        422,
        result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
      );
    }
    const manifest = result.data;
    if (manifest.matchdeskApi !== MATCHDESK_MODULE_API) {
      throw new ModuleError("modul_api_inkompatibel", 422, undefined, {
        required: manifest.matchdeskApi,
        supported: MATCHDESK_MODULE_API
      });
    }
    try {
      settingsValidator(manifest);
    } catch (error) {
      throw new ModuleError("manifest_ungueltig", 422, `settings: JSON-Schema wird nicht unterstützt (${errorText(error)})`);
    }
    const paths = new Set(entries.map((entry) => entry.path));
    for (const file of [manifest.server, manifest.client]) {
      if (file && !paths.has(file)) {
        throw new ModuleError("paket_unvollstaendig", 422, `Datei ${file} fehlt im Paket.`);
      }
    }
    return manifest;
  }

  async function downloadPackage(sourceId: string, moduleId: string, version?: string): Promise<DownloadedPackage> {
    const { source, index, indexUrl } = await fetchSourceIndex(sourceId);
    const module = index.modules.find((candidate) => candidate.id === moduleId);
    if (!module) throw new ModuleError("modul_nicht_in_quelle", 404);
    const candidates = module.versions
      .filter((candidate) => candidate.matchdeskApi === MATCHDESK_MODULE_API)
      .sort((a, b) => compareVersions(b.version, a.version));
    const entry = version ? module.versions.find((candidate) => candidate.version === version) : candidates[0];
    if (!entry) throw new ModuleError(version ? "version_nicht_gefunden" : "keine_passende_version", 404);
    if (entry.matchdeskApi !== MATCHDESK_MODULE_API) {
      throw new ModuleError("modul_api_inkompatibel", 422, undefined, {
        required: entry.matchdeskApi,
        supported: MATCHDESK_MODULE_API
      });
    }
    let packageUrl: string;
    try {
      packageUrl = resolvePackageUrl(indexUrl, entry.url);
    } catch (error) {
      if (error instanceof SourceFetchError) throw new ModuleError(error.code, 422, error.message);
      throw error;
    }
    const cached = previewCache.get(entry.sha256);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
      return cached.pkg;
    }
    let buffer: Buffer;
    try {
      buffer = await fetchLimited(fetchImpl, packageUrl, MAX_PACKAGE_BYTES, authHeaders(source, packageUrl));
    } catch (error) {
      if (error instanceof SourceFetchError) throw new ModuleError(error.code, 502, error.message);
      throw error;
    }
    const pkg = verifyPackage(buffer, entry.sha256, packageUrl);
    if (pkg.manifest.id !== moduleId || pkg.manifest.version !== entry.version) {
      throw new ModuleError("manifest_passt_nicht", 422, "Paket passt nicht zum Eintrag in der Quelle.", {
        expected: { id: moduleId, version: entry.version },
        found: { id: pkg.manifest.id, version: pkg.manifest.version }
      });
    }
    previewCache.set(entry.sha256, { pkg, at: Date.now() });
    return pkg;
  }

  function verifyPackage(buffer: Buffer, expectedSha: string, packageUrl: string): DownloadedPackage {
    const actual = sha256(buffer);
    if (actual !== expectedSha) {
      throw new ModuleError("paket_pruefsumme_falsch", 422, "Prüfsumme des Pakets stimmt nicht.", {
        expected: expectedSha,
        actual
      });
    }
    let entries: TarEntry[];
    try {
      entries = readTarGz(buffer);
    } catch (error) {
      if (error instanceof PackageFormatError) throw new ModuleError("paket_ungueltig", 422, error.message);
      throw error;
    }
    entries.push({ path: PACKAGE_FILE, data: buffer });
    return { manifest: parsePackage(entries), entries, sha256: actual, packageUrl };
  }

  function versionDirectory(id: string, version: string) {
    return path.join(modulesDir, id, version);
  }

  function writePackage(pkg: DownloadedPackage) {
    const target = versionDirectory(pkg.manifest.id, pkg.manifest.version);
    const staging = `${target}.tmp-${randomUUID()}`;
    fs.mkdirSync(staging, { recursive: true });
    try {
      for (const entry of pkg.entries) {
        const file = path.join(staging, entry.path);
        if (!file.startsWith(staging + path.sep)) {
          throw new ModuleError("paket_ungueltig", 422, `Pfad außerhalb des Pakets: ${entry.path}`);
        }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, entry.data);
      }
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(staging, target);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
    return target;
  }

  function readPackageFiles(id: string, version: string) {
    const directory = versionDirectory(id, version);
    const files = new Map<string, Buffer>();
    const walk = (dir: string, prefix: string) => {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isDirectory()) walk(path.join(dir, item.name), relative);
        else if (item.isFile() && relative !== PACKAGE_FILE) files.set(relative, fs.readFileSync(path.join(dir, item.name)));
      }
    };
    walk(directory, "");
    return files;
  }

  /** Fehlen die Dateien (z. B. neues Volume nach Restore), genau die gespeicherte Version neu laden. */
  async function ensureFiles(module: ModuleRow) {
    const directory = versionDirectory(module.id, module.version);
    if (fs.existsSync(path.join(directory, "manifest.json"))) return directory;
    const localPackage = path.join(directory, PACKAGE_FILE);
    let buffer: Buffer | undefined = fs.existsSync(localPackage) ? fs.readFileSync(localPackage) : undefined;
    if (!buffer) {
      if (!module.packageUrl) throw new ModuleError("modul_dateien_fehlen", 500, "Paketdateien fehlen und keine Download-Adresse bekannt.");
      const source = module.sourceId ? getSource(module.sourceId) : undefined;
      assertFetchableUrl(module.packageUrl);
      buffer = await fetchLimited(
        fetchImpl,
        module.packageUrl,
        MAX_PACKAGE_BYTES,
        source ? authHeaders(source, module.packageUrl) : {}
      );
    }
    const pkg = verifyPackage(buffer, module.sha256, module.packageUrl ?? "");
    if (pkg.manifest.id !== module.id || pkg.manifest.version !== module.version) {
      throw new ModuleError("manifest_passt_nicht", 422);
    }
    return writePackage(pkg);
  }

  function cleanupOldVersions(id: string, keep: string[]) {
    const directory = path.join(modulesDir, id);
    if (!fs.existsSync(directory)) return;
    for (const item of fs.readdirSync(directory)) {
      if (!keep.includes(item)) fs.rmSync(path.join(directory, item), { recursive: true, force: true });
    }
  }

  // ---------- Module ----------

  function listModules(): ModuleRow[] {
    return (sqlite.prepare("SELECT * FROM modules ORDER BY id").all() as RawModuleRow[]).map(mapModule);
  }

  function getModule(id: string): ModuleRow | undefined {
    const row = sqlite.prepare("SELECT * FROM modules WHERE id = ?").get(id) as RawModuleRow | undefined;
    return row ? mapModule(row) : undefined;
  }

  function requireModule(id: string) {
    const module = getModule(id);
    if (!module) throw new ModuleError("modul_nicht_gefunden", 404);
    return module;
  }

  function summarizeManifest(manifest: ModuleManifest, sourceTrust?: ModuleSourceRow["trust"]) {
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description ?? null,
      author: manifest.author ?? null,
      homepage: manifest.homepage ?? null,
      permissions: manifest.permissions,
      tables: manifest.tables,
      secrets: manifest.secrets,
      network: manifest.network,
      menu: manifest.menu.map((entry) => ({ path: entry.path, label: entry.label, permission: entry.permission ?? null })),
      hasServer: Boolean(manifest.server),
      hasClient: Boolean(manifest.client),
      trust: sourceTrust ?? null
    };
  }

  /**
   * Installieren in zwei Schritten: ohne `confirm` lädt und prüft Matchdesk das Paket und zeigt,
   * was es anfordert; mit `confirm: true` wird es abgelegt (noch nicht aktiv).
   */
  async function install(actor: ModuleActor, input: { sourceId: string; moduleId: string; version?: string; confirm?: boolean }) {
    const source = requireSource(input.sourceId);
    if (getModule(input.moduleId)) throw new ModuleError("modul_bereits_installiert", 409);
    const pkg = await downloadPackage(source.id, input.moduleId, input.version);
    const preview = summarizeManifest(pkg.manifest, source.trust);
    if (!input.confirm) {
      return { confirmed: false as const, preview, sha256: pkg.sha256 };
    }
    writePackage(pkg);
    const at = nowIso();
    sqlite
      .prepare(
        `INSERT INTO modules (id, source_id, version, sha256, package_url, previous_version, state, manifest_json, installed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, 'installed', ?, ?, ?)`
      )
      .run(pkg.manifest.id, source.id, pkg.manifest.version, pkg.sha256, pkg.packageUrl, JSON.stringify(pkg.manifest), at, at);
    audit(actor, "module.installed", "module", pkg.manifest.id, `Modul ${pkg.manifest.id} ${pkg.manifest.version} installiert`, {
      source: source.url,
      trust: source.trust,
      sha256: pkg.sha256,
      permissions: pkg.manifest.permissions.map((permission) => permission.key),
      secrets: pkg.manifest.secrets,
      network: pkg.manifest.network
    });
    return { confirmed: true as const, module: describeModule(requireModule(pkg.manifest.id)) };
  }

  function migrate(module: ModuleRow) {
    const files = readPackageFiles(module.id, module.version);
    return runModuleMigrations(sqlite, module.id, moduleMigrationFiles(files), coreTableExceptions[module.id] ?? []);
  }

  function ensureSettingsRow(module: ModuleRow) {
    const existing = sqlite.prepare("SELECT 1 FROM module_settings WHERE module_id = ?").get(module.id);
    if (existing) return;
    sqlite
      .prepare("INSERT INTO module_settings (module_id, value_json, updated_at) VALUES (?, ?, ?)")
      .run(module.id, JSON.stringify(settingsDefaults(module.manifest)), nowIso());
  }

  async function startRuntime(module: ModuleRow) {
    const directory = versionDirectory(module.id, module.version);
    const router = express.Router();
    const handles: ModuleRuntimeHandles = { router, cleanups: [], timers: new Set() };
    const runtime: Runtime = { ...handles, id: module.id, version: module.version, manifest: module.manifest, directory };
    if (module.manifest.server) {
      const file = path.join(directory, module.manifest.server);
      // Eigene Adresse pro Start: Node hält geladene Module im Cache.
      const url = `${pathToFileURL(file).href}?load=${Date.now()}-${randomUUID().slice(0, 8)}`;
      const entry = (await import(/* @vite-ignore */ url)) as ModuleServerEntry;
      if (typeof entry.register !== "function") {
        throw new ModuleError("modul_ohne_register", 422, `${module.manifest.server} exportiert keine Funktion register(ctx).`);
      }
      const ctx = createModuleContext({
        context,
        manifest: module.manifest,
        handles,
        getSettings: () => getSettings(module.id)
      });
      try {
        const cleanup = await entry.register(ctx);
        if (typeof cleanup === "function") handles.cleanups.push(cleanup as () => unknown);
      } catch (error) {
        await stopHandles(handles);
        throw error;
      }
    }
    runtimes.set(module.id, runtime);
    runtimeErrors.delete(module.id);
  }

  async function stopHandles(handles: ModuleRuntimeHandles) {
    for (const timer of handles.timers) clearInterval(timer);
    handles.timers.clear();
    for (const cleanup of handles.cleanups.splice(0).reverse()) {
      try {
        await cleanup();
      } catch (error) {
        console.error("[Matchdesk] Modul-Aufräumen fehlgeschlagen", error);
      }
    }
  }

  async function stopRuntime(id: string) {
    const runtime = runtimes.get(id);
    runtimes.delete(id);
    if (runtime) await stopHandles(runtime);
  }

  function setState(id: string, state: ModuleState, extra: { lastError?: string | null } = {}) {
    const at = nowIso();
    sqlite
      .prepare(
        `UPDATE modules SET state = ?, last_error = ?, updated_at = ?, enabled_at = CASE WHEN ? = 'enabled' THEN ? ELSE enabled_at END WHERE id = ?`
      )
      .run(state, extra.lastError ?? null, at, state, at, id);
  }

  async function activate(module: ModuleRow) {
    await ensureFiles(module);
    migrate(module);
    registerModulePermissions(context, module.id, module.manifest.permissions);
    ensureSettingsRow(module);
    await startRuntime(module);
  }

  async function enable(actor: ModuleActor, id: string) {
    const module = requireModule(id);
    if (module.state === "enabled" && runtimes.has(id)) return describeModule(module);
    try {
      await activate(module);
    } catch (error) {
      runtimeErrors.set(id, errorText(error));
      sqlite.prepare("UPDATE modules SET last_error = ?, updated_at = ? WHERE id = ?").run(errorText(error), nowIso(), id);
      throw error instanceof ModuleError ? error : new ModuleError("modul_start_fehlgeschlagen", 500, errorText(error));
    }
    setState(id, "enabled");
    audit(actor, "module.enabled", "module", id, `Modul ${id} eingeschaltet`, { version: module.version });
    return describeModule(requireModule(id));
  }

  async function disable(actor: ModuleActor, id: string) {
    const module = requireModule(id);
    await stopRuntime(id);
    runtimeErrors.delete(id);
    if (module.state === "enabled") {
      setState(id, "disabled");
      audit(actor, "module.disabled", "module", id, `Modul ${id} ausgeschaltet`, { version: module.version });
    }
    return describeModule(requireModule(id));
  }

  async function update(actor: ModuleActor, id: string, input: { version?: string; confirm?: boolean }) {
    const module = requireModule(id);
    if (!module.sourceId) throw new ModuleError("modul_verwaist", 409, "Die Quelle des Moduls wurde gelöscht.");
    const source = requireSource(module.sourceId);
    const pkg = await downloadPackage(source.id, id, input.version);
    if (pkg.manifest.version === module.version) throw new ModuleError("version_bereits_installiert", 409);
    const applied = appliedModuleMigrations(sqlite, id);
    const offered = new Set(moduleMigrationFiles(pkg.entries).map((migration) => migration.name));
    const unknown = applied.filter((name) => !offered.has(name));
    if (unknown.length > 0) {
      throw new ModuleError("modul_zurueckstufen_unmoeglich", 409, "Die Version kennt bereits angewendete Migrationen nicht.", {
        migrations: unknown
      });
    }
    const before = summarizeManifest(module.manifest, source.trust);
    const after = summarizeManifest(pkg.manifest, source.trust);
    const diff = {
      addedPermissions: after.permissions.filter((p) => !before.permissions.some((b) => b.key === p.key)).map((p) => p.key),
      removedPermissions: before.permissions.filter((p) => !after.permissions.some((a) => a.key === p.key)).map((p) => p.key),
      addedTables: after.tables.filter((table) => !before.tables.includes(table)),
      addedSecrets: after.secrets.filter((secret) => !before.secrets.includes(secret)),
      addedNetwork: after.network.filter((host) => !before.network.includes(host))
    };
    if (!input.confirm) {
      return { confirmed: false as const, from: module.version, to: pkg.manifest.version, preview: after, diff };
    }

    writePackage(pkg);
    const wasEnabled = module.state === "enabled";
    const next: ModuleRow = {
      ...module,
      version: pkg.manifest.version,
      sha256: pkg.sha256,
      packageUrl: pkg.packageUrl,
      manifest: pkg.manifest
    };
    if (wasEnabled) {
      await stopRuntime(id);
      try {
        await activate(next);
      } catch (error) {
        // Rückfall auf die bisherige Version; neue Migrationen bleiben angewendet.
        runtimeErrors.set(id, errorText(error));
        try {
          registerModulePermissions(context, id, module.manifest.permissions);
          await startRuntime(module);
        } catch (fallbackError) {
          runtimeErrors.set(id, errorText(fallbackError));
        }
        throw error instanceof ModuleError ? error : new ModuleError("modul_update_fehlgeschlagen", 500, errorText(error));
      }
    }
    sqlite
      .prepare(
        "UPDATE modules SET version = ?, sha256 = ?, package_url = ?, previous_version = ?, manifest_json = ?, last_error = NULL, updated_at = ? WHERE id = ?"
      )
      .run(next.version, next.sha256, next.packageUrl, module.version, JSON.stringify(next.manifest), nowIso(), id);
    cleanupOldVersions(id, [next.version, module.version]);
    audit(actor, "module.updated", "module", id, `Modul ${id} von ${module.version} auf ${next.version} aktualisiert`, {
      sha256: next.sha256,
      ...diff
    });
    return { confirmed: true as const, module: describeModule(requireModule(id)), diff };
  }

  function exportData(id: string) {
    const module = requireModule(id);
    const existing = new Set(
      (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name)
    );
    const tables: Record<string, unknown[]> = {};
    for (const table of module.manifest.tables) {
      if (!existing.has(table)) continue;
      tables[table] = sqlite.prepare(`SELECT * FROM "${table}"`).all();
    }
    return {
      module: id,
      version: module.version,
      exportedAt: nowIso(),
      settings: readStoredSettings(id),
      tables
    };
  }

  async function uninstall(actor: ModuleActor, id: string, input: { confirmId?: string }) {
    const module = requireModule(id);
    if (module.state === "enabled") throw new ModuleError("modul_aktiv", 409, "Erst ausschalten, dann deinstallieren.");
    if (input.confirmId !== id) throw new ModuleError("bestaetigung_falsch", 400, "Zur Bestätigung die Kennung eintippen.");
    await stopRuntime(id);
    let uninstallSql: string | undefined;
    try {
      const files = readPackageFiles(id, module.version);
      uninstallSql = files.get("uninstall.sql")?.toString("utf8");
    } catch {
      uninstallSql = undefined;
    }
    runModuleUninstall(sqlite, id, uninstallSql, module.manifest.tables);
    removeModulePermissions(context, id);
    sqlite.prepare("DELETE FROM modules WHERE id = ?").run(id);
    fs.rmSync(path.join(modulesDir, id), { recursive: true, force: true });
    runtimeErrors.delete(id);
    audit(actor, "module.uninstalled", "module", id, `Modul ${id} deinstalliert`, {
      version: module.version,
      tables: module.manifest.tables
    });
  }

  // ---------- Einstellungen ----------

  function readStoredSettings(id: string): Record<string, unknown> {
    const row = sqlite.prepare("SELECT value_json FROM module_settings WHERE module_id = ?").get(id) as { value_json: string } | undefined;
    if (!row) return {};
    try {
      return JSON.parse(row.value_json) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  function getSettings(id: string): Record<string, unknown> {
    const module = requireModule(id);
    const merged = { ...settingsDefaults(module.manifest), ...readStoredSettings(id) };
    const parsed = settingsValidator(module.manifest).safeParse(merged);
    return parsed.success ? (parsed.data as Record<string, unknown>) : settingsDefaults(module.manifest);
  }

  function putSettings(actor: ModuleActor, id: string, raw: unknown) {
    const module = requireModule(id);
    const merged = { ...settingsDefaults(module.manifest), ...(raw && typeof raw === "object" ? raw : {}) };
    const parsed = settingsValidator(module.manifest).safeParse(merged);
    if (!parsed.success) {
      throw new ModuleError(
        "einstellungen_ungueltig",
        400,
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
      );
    }
    sqlite
      .prepare(
        "INSERT INTO module_settings (module_id, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(module_id) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at"
      )
      .run(id, JSON.stringify(parsed.data), nowIso());
    audit(actor, "module.settings_updated", "module", id, `Einstellungen von Modul ${id} geändert`, {
      keys: Object.keys(parsed.data as object)
    });
    return getSettings(id);
  }

  // ---------- Laufzeit ----------

  async function init() {
    for (const module of listModules()) {
      if (module.state !== "enabled") continue;
      try {
        await activate(module);
      } catch (error) {
        runtimeErrors.set(module.id, errorText(error));
        sqlite.prepare("UPDATE modules SET last_error = ? WHERE id = ?").run(errorText(error), module.id);
        console.error(`[Matchdesk] Modul ${module.id} konnte nicht gestartet werden`, error);
      }
    }
  }

  async function close() {
    for (const id of [...runtimes.keys()]) await stopRuntime(id);
  }

  function describeModule(module: ModuleRow) {
    const source = module.sourceId ? getSource(module.sourceId) : undefined;
    return {
      id: module.id,
      name: module.manifest.name,
      version: module.version,
      previousVersion: module.previousVersion,
      state: module.state,
      running: runtimes.has(module.id),
      error: runtimeErrors.get(module.id) ?? module.lastError,
      orphaned: !module.sourceId,
      source: source ? { id: source.id, name: source.name, trust: source.trust } : null,
      sha256: module.sha256,
      installedAt: module.installedAt,
      enabledAt: module.enabledAt,
      updatedAt: module.updatedAt,
      manifest: summarizeManifest(module.manifest, source?.trust),
      settingsSchema: module.manifest.settings ?? null,
      adminPage: module.manifest.adminPage,
      clientUrl: clientUrl(module.id, module.version, module.manifest)
    };
  }

  function clientUrl(id: string, version: string, manifest: ModuleManifest) {
    return manifest.client ? `/modules/${id}/${version}/${manifest.client}` : null;
  }

  function readCatalog(runtime: Runtime, locale: string) {
    const file = path.join(runtime.directory, "i18n", `${locale}.json`);
    if (!fs.existsSync(file)) return undefined;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string")) as Record<string, string>;
    } catch {
      return undefined;
    }
  }

  /** Was der Client über die aktiven Module wissen muss, gefiltert nach den Rechten des Benutzers. */
  function publicModules(user: { id: string; role: UserRole; locale?: string | null } | undefined) {
    if (!user) return [];
    return [...runtimes.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((runtime) => {
        const manifest = runtime.manifest;
        const permissions = manifest.permissions.map((permission) => permission.key).filter((key) => can(context, user, key));
        return {
          id: runtime.id,
          version: runtime.version,
          name: localize(manifest.name, user.locale ?? undefined),
          clientUrl: clientUrl(runtime.id, runtime.version, manifest),
          adminPage: manifest.adminPage,
          permissions,
          menu: manifest.menu
            .filter((entry) => !entry.permission || permissions.includes(entry.permission))
            .map((entry) => ({
              path: entry.path,
              label: localize(entry.label, user.locale ?? undefined),
              icon: entry.icon ?? null,
              order: entry.order
            })),
          i18n: { de: readCatalog(runtime, "de") ?? {}, en: readCatalog(runtime, "en") ?? {} }
        };
      });
  }

  /** Verteiler unter /api/m/<id>: leitet nur an laufende Module weiter. */
  function dispatch(request: Request, response: Response, next: NextFunction) {
    const id = request.params.moduleId as string;
    const runtime = runtimes.get(id);
    if (!runtime) {
      response.status(404).json({ error: "modul_inaktiv" });
      return;
    }
    // Schreibende Anfragen mit Sitzungs-Cookie brauchen wie im Kern das CSRF-Token; API-Tokens
    // nur mit Schreibrecht. Anfragen ohne Anmeldung entscheidet das Modul selbst.
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      resolveMatchdeskAuth(context, request);
      const kind = request.matchdeskAuth?.kind;
      if (kind === "session" && !requireCsrf(context, request, response)) return;
      if (kind === "api_token" && !enforceApiTokenWriteAccess(request, response)) return;
    }
    runtime.router(request, response, (error?: unknown) => {
      if (error && error !== "route" && error !== "router") {
        console.error(`[Matchdesk] Fehler in Modul ${id}`, error);
        if (!response.headersSent) response.status(500).json({ error: "modul_fehler" });
        return;
      }
      if (!response.headersSent) response.status(404).json({ error: "nicht_gefunden" });
      else next();
    });
  }

  /** Liefert Client-Dateien aktiver Module aus (gleiche Herkunft, CSP bleibt unverändert). */
  function serveClientFile(request: Request, response: Response) {
    const id = request.params.moduleId as string;
    const version = request.params.version as string;
    const rest = request.params.file;
    const relative = Array.isArray(rest) ? rest.join("/") : String(rest ?? "");
    const runtime = runtimes.get(id);
    if (!runtime || runtime.version !== version) {
      response.status(404).json({ error: "modul_inaktiv" });
      return;
    }
    const allowed =
      relative === runtime.manifest.client || relative.startsWith("client/") || relative.startsWith("assets/");
    const file = path.normalize(path.join(runtime.directory, relative));
    if (!allowed || !file.startsWith(runtime.directory + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.status(404).json({ error: "nicht_gefunden" });
      return;
    }
    const type = CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream";
    response.setHeader("Content-Type", type);
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.send(fs.readFileSync(file));
  }

  function audit(
    actor: ModuleActor,
    action: string,
    entityType: string,
    entityId: string,
    summary: string,
    metadata?: Record<string, unknown>
  ) {
    tryWriteAuditLog(context, { actor, action, entityType, entityId, summary, metadata });
  }

  function moduleTablesForRestore() {
    return listModules().flatMap((module) => module.manifest.tables);
  }

  return {
    modulesDir,
    init,
    close,
    listSources,
    getSource,
    addSource,
    updateSource,
    deleteSource,
    fetchSourceIndex,
    listAvailable,
    checkUpdates,
    listModules,
    getModule,
    describeModule,
    install: (actor: ModuleActor, input: Parameters<typeof install>[1]) => withLock(input.moduleId, () => install(actor, input)),
    enable: (actor: ModuleActor, id: string) => withLock(id, () => enable(actor, id)),
    disable: (actor: ModuleActor, id: string) => withLock(id, () => disable(actor, id)),
    update: (actor: ModuleActor, id: string, input: Parameters<typeof update>[2]) => withLock(id, () => update(actor, id, input)),
    uninstall: (actor: ModuleActor, id: string, input: Parameters<typeof uninstall>[2]) => withLock(id, () => uninstall(actor, id, input)),
    exportData,
    getSettings,
    putSettings,
    publicModules,
    dispatch,
    serveClientFile,
    isRunning: (id: string) => runtimes.has(id),
    moduleTablesForRestore
  };
}

export type ModuleManager = ReturnType<typeof createModuleManager>;
