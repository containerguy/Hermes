import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CSRF_HEADER } from "../auth/csrf";
import { bootstrapAdmin } from "../db/bootstrap-admin";
import { createMatchdeskApp } from "../app";
import { sha256, type ModuleFetch } from "./source-fetch";
import { createTarGz } from "./tar";
import { createDb } from "../db/client";
import { listNotificationChannels, notifyUsers } from "../notifications/dispatcher";

type StartedApp = Awaited<ReturnType<typeof createMatchdeskApp>>;

const SOURCE_URL = "https://modules.example.test/demo";
const INDEX_URL = `${SOURCE_URL}/matchdesk-source.json`;

const files = new Map<string, Buffer>();
let fetchCalls: string[] = [];

const fakeFetch: ModuleFetch = async (url) => {
  fetchCalls.push(url);
  const body = files.get(url);
  return {
    ok: Boolean(body),
    status: body ? 200 : 404,
    arrayBuffer: async () => {
      const data = body ?? Buffer.alloc(0);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    }
  };
};

const DEMO_SERVER = `
export function register(ctx) {
  ctx.router.get("/hello", (request, response) => {
    const user = ctx.currentUser(request);
    response.json({ greeting: ctx.settings.get().greeting, user: user ? user.username : null, canManage: ctx.can(user, "demo.manage") });
  });
  ctx.router.get("/notes", (_request, response) => {
    response.json({ notes: ctx.db.prepare("SELECT id, text FROM demo_notes ORDER BY id").all() });
  });
  ctx.router.post("/notes", (request, response) => {
    if (!ctx.requireWrite(request, response)) return;
    const user = ctx.currentUser(request);
    if (!ctx.can(user, "demo.write")) { response.status(403).json({ error: "recht_fehlt" }); return; }
    ctx.db.prepare("INSERT INTO demo_notes (id, text, user_id) VALUES (?, ?, ?)").run(request.body.id, request.body.text, user.id);
    response.status(201).json({ ok: true });
  });
  ctx.router.get("/secret", (_request, response) => {
    try { ctx.env("NOT_DECLARED"); response.json({ leaked: true }); }
    catch { response.json({ leaked: false }); }
  });
  ctx.router.get("/token", (_request, response) => {
    try { response.json({ token: ctx.env("DEMO_TOKEN") ?? null }); }
    catch { response.json({ token: "nicht-angemeldet" }); }
  });
  ctx.router.get("/boom", () => { throw new Error("kaputt"); });
  ctx.router.post("/ohne-pruefung", (_request, response) => { response.json({ ok: true }); });
  ctx.router.post("/roh", (request, response) => {
    const raw = ctx.rawBody(request);
    response.json({ body: request.body, raw: raw ? raw.toString("utf8") : null });
  });
  ctx.notifications.registerChannel({
    id: "demo",
    label: { de: "Demo-Kanal", en: "Demo channel" },
    isAvailable: (user) => Boolean(user.phoneNumber),
    unavailableHint: { de: "Telefonnummer fehlt", en: "Phone number missing" },
    send: async (user, message) => {
      globalThis.__demoSent = [...(globalThis.__demoSent ?? []), { user: user.username, message }];
    }
  });
  globalThis.__demoStarts = (globalThis.__demoStarts ?? 0) + 1;
  ctx.onStop(() => { globalThis.__demoStops = (globalThis.__demoStops ?? 0) + 1; });
}
`;

function demoManifest(version: string, extra: Record<string, unknown> = {}) {
  return {
    id: "demo",
    name: { de: "Demo", en: "Demo" },
    version,
    matchdeskApi: 1,
    server: "server.mjs",
    client: "client.mjs",
    permissions: [
      { key: "demo.write", label: "Notizen schreiben", defaultRoles: ["user"] },
      { key: "demo.manage", label: "Demo verwalten", scopable: true, defaultRoles: ["manager"] }
    ],
    settings: {
      type: "object",
      properties: {
        greeting: { type: "string", minLength: 1, default: "Hallo" },
        limit: { type: "integer", minimum: 1, default: 5 }
      },
      additionalProperties: false
    },
    menu: [
      { path: "", label: "Demo", order: 40 },
      { path: "verwaltung", label: "Demo-Verwaltung", order: 41, permission: "demo.manage" }
    ],
    tables: ["demo_notes"],
    ...extra
  };
}

function buildPackage(version: string, options: { migrations?: Record<string, string>; manifest?: Record<string, unknown> } = {}) {
  const migrations = options.migrations ?? {
    "0001_init.sql":
      "CREATE TABLE IF NOT EXISTS demo_notes (id TEXT PRIMARY KEY, text TEXT NOT NULL, user_id TEXT REFERENCES users(id) ON DELETE CASCADE);"
  };
  return createTarGz([
    { path: "package/manifest.json", data: JSON.stringify(options.manifest ?? demoManifest(version)) },
    { path: "package/server.mjs", data: DEMO_SERVER },
    { path: "package/client.mjs", data: "export default function createModule() { return { pages: [] }; }" },
    { path: "package/i18n/de.json", data: JSON.stringify({ "demo.title": "Demo" }) },
    ...Object.entries(migrations).map(([name, sql]) => ({ path: `package/migrations/${name}`, data: sql })),
    { path: "package/uninstall.sql", data: "DROP TABLE IF EXISTS demo_notes;" }
  ]);
}

function publish(versions: Array<{ version: string; pkg: Buffer; sha?: string; matchdeskApi?: number }>) {
  for (const entry of versions) {
    files.set(`${SOURCE_URL}/demo-${entry.version}.tgz`, entry.pkg);
  }
  files.set(
    INDEX_URL,
    Buffer.from(
      JSON.stringify({
        matchdeskSource: 1,
        name: "Demo-Quelle",
        modules: [
          {
            id: "demo",
            name: "Demo",
            versions: versions.map((entry) => ({
              version: entry.version,
              matchdeskApi: entry.matchdeskApi ?? 1,
              url: `demo-${entry.version}.tgz`,
              sha256: entry.sha ?? sha256(entry.pkg)
            }))
          }
        ]
      })
    )
  );
}

let started: StartedApp | undefined;
let databasePath: string;
let modulesDir: string;

async function start() {
  started = await createMatchdeskApp({ modules: { modulesDir, fetch: fakeFetch } });
  return started;
}

async function login(app: StartedApp, username: string) {
  const agent = request.agent(app.app);
  await agent.post("/api/auth/request-code").send({ username }).expect(202);
  await agent.post("/api/auth/verify-code").send({ username, code: "123456", deviceName: "test" }).expect(200);
  const csrf = (await agent.get("/api/auth/csrf").expect(200)).body.token as string;
  return { agent, csrf };
}

async function adminSession(app: StartedApp) {
  return login(app, "hauptadmin");
}

async function addDemoSource(admin: Awaited<ReturnType<typeof login>>) {
  const response = await admin.agent
    .post("/api/admin/modules/sources")
    .set(CSRF_HEADER, admin.csrf)
    .send({ name: "Demo", url: SOURCE_URL, trust: "third_party" })
    .expect(200);
  return response.body.source.id as string;
}

async function installAndEnable(admin: Awaited<ReturnType<typeof login>>, sourceId: string, version?: string) {
  await admin.agent
    .post("/api/admin/modules/install")
    .set(CSRF_HEADER, admin.csrf)
    .send({ sourceId, moduleId: "demo", version, confirm: true })
    .expect(200);
  await admin.agent.post("/api/admin/modules/demo/enable").set(CSRF_HEADER, admin.csrf).send({}).expect(200);
}

describe("Modulverwaltung", () => {
  beforeEach(async () => {
    databasePath = path.join(os.tmpdir(), `matchdesk-modules-${randomUUID()}.sqlite`);
    modulesDir = path.join(os.tmpdir(), `matchdesk-modules-${randomUUID()}`);
    process.env.MATCHDESK_DB_PATH = databasePath;
    process.env.MATCHDESK_ADMIN_PHONE = "+491701234567";
    process.env.MATCHDESK_ADMIN_USERNAME = "hauptadmin";
    process.env.MATCHDESK_ADMIN_EMAIL = "hauptadmin@example.test";
    process.env.MATCHDESK_MAIL_MODE = "console";
    process.env.MATCHDESK_DEV_LOGIN_CODE = "123456";
    delete process.env.MATCHDESK_STORAGE_BACKEND;
    files.clear();
    fetchCalls = [];
    await bootstrapAdmin();
  }, 30_000);

  afterEach(async () => {
    await started?.close();
    started = undefined;
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });
    fs.rmSync(modulesDir, { recursive: true, force: true });
  });

  it("legt die offizielle Quelle an und erlaubt nur Admins", async () => {
    const app = await start();
    const admin = await adminSession(app);
    const list = await admin.agent.get("/api/admin/modules").expect(200);
    expect(list.body.matchdeskApi).toBe(1);
    expect(list.body.sources).toEqual([
      expect.objectContaining({ id: "official", url: "https://github.com/containerguy/matchdesk-modules", trust: "official" })
    ]);
    expect(list.body.modules).toEqual([]);

    await admin.agent
      .post("/api/admin/users")
      .set(CSRF_HEADER, admin.csrf)
      .send({ username: "spieler", email: "spieler@example.test" })
      .expect(201);
    const player = await login(app, "spieler");
    await player.agent.get("/api/admin/modules").expect(403);
    await request(app.app).get("/api/admin/modules").expect(401);
  });

  it("installiert, aktiviert, konfiguriert, schaltet aus und deinstalliert ein Modul im laufenden Betrieb", async () => {
    publish([{ version: "1.0.0", pkg: buildPackage("1.0.0") }]);
    const app = await start();
    const admin = await adminSession(app);
    const sourceId = await addDemoSource(admin);

    const available = await admin.agent.get(`/api/admin/modules/sources/${sourceId}/modules`).expect(200);
    expect(available.body.modules).toEqual([
      expect.objectContaining({ id: "demo", latestCompatible: "1.0.0", installed: null, updateAvailable: false })
    ]);

    // Schritt 1: Vorschau ohne Installation
    const preview = await admin.agent
      .post("/api/admin/modules/install")
      .set(CSRF_HEADER, admin.csrf)
      .send({ sourceId, moduleId: "demo" })
      .expect(200);
    expect(preview.body.confirmed).toBe(false);
    expect(preview.body.preview).toEqual(
      expect.objectContaining({
        id: "demo",
        version: "1.0.0",
        tables: ["demo_notes"],
        trust: "third_party",
        permissions: expect.arrayContaining([expect.objectContaining({ key: "demo.manage", scopable: true })])
      })
    );
    expect((await admin.agent.get("/api/admin/modules").expect(200)).body.modules).toEqual([]);

    // Schritt 2: bestätigt installieren — noch nicht aktiv
    await admin.agent
      .post("/api/admin/modules/install")
      .set(CSRF_HEADER, admin.csrf)
      .send({ sourceId, moduleId: "demo", confirm: true })
      .expect(200);
    expect(fs.existsSync(path.join(modulesDir, "demo", "1.0.0", "manifest.json"))).toBe(true);
    await admin.agent.get("/api/m/demo/hello").expect(404, { error: "modul_inaktiv" });

    await admin.agent.post("/api/admin/modules/demo/enable").set(CSRF_HEADER, admin.csrf).send({}).expect(200);
    const hello = await admin.agent.get("/api/m/demo/hello").expect(200);
    expect(hello.body).toEqual({ greeting: "Hallo", user: "hauptadmin", canManage: true });

    // Einstellungen werden gegen das Schema aus dem Manifest geprüft
    await admin.agent
      .put("/api/admin/modules/demo/settings")
      .set(CSRF_HEADER, admin.csrf)
      .send({ settings: { greeting: "", limit: 3 } })
      .expect(400);
    await admin.agent
      .put("/api/admin/modules/demo/settings")
      .set(CSRF_HEADER, admin.csrf)
      .send({ settings: { greeting: "Moin", limit: 3 } })
      .expect(200);
    expect((await admin.agent.get("/api/m/demo/hello").expect(200)).body.greeting).toBe("Moin");

    // Geheimnisse nur aus dem Manifest; Fehler im Modul landen als 500 modul_fehler
    expect((await admin.agent.get("/api/m/demo/secret").expect(200)).body).toEqual({ leaked: false });
    await admin.agent.get("/api/m/demo/boom").expect(500, { error: "modul_fehler" });
    await admin.agent.get("/api/m/demo/unbekannt").expect(404);

    // Menü und Rechte für normale Benutzer
    await admin.agent
      .post("/api/admin/users")
      .set(CSRF_HEADER, admin.csrf)
      .send({ username: "spieler", email: "spieler@example.test" })
      .expect(201);
    const player = await login(app, "spieler");
    const publicList = await player.agent.get("/api/modules").expect(200);
    expect(publicList.body.modules).toEqual([
      expect.objectContaining({
        id: "demo",
        version: "1.0.0",
        clientUrl: "/modules/demo/1.0.0/client.mjs",
        permissions: ["demo.write"],
        menu: [expect.objectContaining({ path: "", label: "Demo" })],
        i18n: { de: { "demo.title": "Demo" }, en: {} }
      })
    ]);
    expect((await request(app.app).get("/api/modules").expect(200)).body.modules).toEqual([]);

    // Modulrechte stehen im Rechtesystem des Kerns und lassen sich pro Benutzer vergeben
    const catalog = await admin.agent.get("/api/admin/rbac").expect(200);
    expect(catalog.body.permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "demo.manage", moduleId: "demo", scopable: true }),
        expect.objectContaining({ key: "demo.write", moduleId: "demo" })
      ])
    );
    expect((await player.agent.get("/api/m/demo/hello").expect(200)).body.canManage).toBe(false);
    const playerId = (await player.agent.get("/api/auth/me").expect(200)).body.user.id as string;
    await admin.agent
      .post(`/api/admin/users/${playerId}/grants`)
      .set(CSRF_HEADER, admin.csrf)
      .send({ permissionKey: "demo.manage" })
      .expect((response) => expect(response.status).toBeLessThan(300));
    expect((await player.agent.get("/api/m/demo/hello").expect(200)).body.canManage).toBe(true);
    expect((await player.agent.get("/api/modules").expect(200)).body.modules[0].menu).toHaveLength(2);

    // Client-Datei gleiche Herkunft; Server-Code wird nicht ausgeliefert
    const client = await request(app.app).get("/modules/demo/1.0.0/client.mjs").expect(200);
    expect(client.headers["content-type"]).toContain("text/javascript");
    await request(app.app).get("/modules/demo/1.0.0/server.mjs").expect(404);
    await request(app.app).get("/modules/demo/0.9.0/client.mjs").expect(404);

    // Schreiben braucht CSRF und das Recht
    await player.agent.post("/api/m/demo/notes").send({ id: "n1", text: "x" }).expect(403);
    await player.agent.post("/api/m/demo/notes").set(CSRF_HEADER, player.csrf).send({ id: "n1", text: "Hallo" }).expect(201);
    expect((await player.agent.get("/api/m/demo/notes").expect(200)).body.notes).toEqual([{ id: "n1", text: "Hallo" }]);

    // CSRF prüft der Kern, auch wenn das Modul es vergisst; ohne Anmeldung entscheidet das Modul
    await player.agent.post("/api/m/demo/ohne-pruefung").send({}).expect(403);
    await player.agent.post("/api/m/demo/ohne-pruefung").set(CSRF_HEADER, player.csrf).send({}).expect(200);
    await request(app.app).post("/api/m/demo/ohne-pruefung").send({}).expect(200);

    // Deinstallieren nur im ausgeschalteten Zustand und mit Bestätigung
    await admin.agent.post("/api/admin/modules/demo/uninstall").set(CSRF_HEADER, admin.csrf).send({ confirmId: "demo" }).expect(409);
    await admin.agent.post("/api/admin/modules/demo/disable").set(CSRF_HEADER, admin.csrf).send({}).expect(200);
    await player.agent.get("/api/m/demo/hello").expect(404, { error: "modul_inaktiv" });
    expect((await player.agent.get("/api/modules").expect(200)).body.modules).toEqual([]);

    const exported = await admin.agent.get("/api/admin/modules/demo/export").expect(200);
    expect(exported.body.tables.demo_notes).toHaveLength(1);
    expect(exported.body.settings).toEqual({ greeting: "Moin", limit: 3 });

    await admin.agent.post("/api/admin/modules/demo/uninstall").set(CSRF_HEADER, admin.csrf).send({ confirmId: "falsch" }).expect(400);
    await admin.agent.post("/api/admin/modules/demo/uninstall").set(CSRF_HEADER, admin.csrf).send({ confirmId: "demo" }).expect(204);

    const sqlite = new (await import("better-sqlite3")).default(databasePath, { readonly: true });
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'demo_notes'").get()).toBeUndefined();
    expect(sqlite.prepare("SELECT name FROM schema_migrations WHERE name LIKE 'demo/%'").all()).toEqual([]);
    expect(sqlite.prepare("SELECT * FROM module_settings").all()).toEqual([]);
    const actions = (sqlite.prepare("SELECT action FROM audit_logs WHERE action LIKE 'module.%' ORDER BY created_at").all() as Array<{ action: string }>).map(
      (row) => row.action
    );
    sqlite.close();
    expect(actions).toEqual(
      expect.arrayContaining([
        "module.source_added",
        "module.installed",
        "module.enabled",
        "module.settings_updated",
        "module.disabled",
        "module.uninstalled"
      ])
    );
    expect(fs.existsSync(path.join(modulesDir, "demo"))).toBe(false);
    const catalogAfter = await admin.agent.get("/api/admin/rbac").expect(200);
    expect(catalogAfter.body.permissions.filter((entry: { moduleId: string | null }) => entry.moduleId === "demo")).toEqual([]);
  });

  it("nimmt Zugangsdaten im Admin entgegen, speichert sie verschlüsselt und startet das Modul neu", async () => {
    publish([{ version: "1.0.0", pkg: buildPackage("1.0.0", { manifest: demoManifest("1.0.0", { secrets: ["DEMO_TOKEN"] }) }) }]);
    delete process.env.MATCHDESK_DEMO_TOKEN;
    process.env.MATCHDESK_DEVICE_KEY_SECRET = "test-device-key-secret";
    try {
      const app = await start();
      const admin = await adminSession(app);
      const sourceId = await addDemoSource(admin);
      await installAndEnable(admin, sourceId);

      const empty = await admin.agent.get("/api/admin/modules/demo/secrets").expect(200);
      expect(empty.body).toEqual({
        defaultKey: false,
        secrets: [{ name: "DEMO_TOKEN", envName: "MATCHDESK_DEMO_TOKEN", fromEnv: false, stored: "missing", updatedAt: null }]
      });
      expect((await admin.agent.get("/api/m/demo/token").expect(200)).body.token).toBeNull();

      // Nur angemeldete Namen, nur mit CSRF, nicht leer
      await admin.agent.put("/api/admin/modules/demo/secrets/OTHER").set(CSRF_HEADER, admin.csrf).send({ value: "x" }).expect(404);
      await admin.agent.put("/api/admin/modules/demo/secrets/DEMO_TOKEN").send({ value: "x" }).expect(403);
      await admin.agent.put("/api/admin/modules/demo/secrets/DEMO_TOKEN").set(CSRF_HEADER, admin.csrf).send({ value: "  " }).expect(400);

      const starts = (globalThis as { __demoStarts?: number }).__demoStarts ?? 0;
      const saved = await admin.agent
        .put("/api/admin/modules/demo/secrets/DEMO_TOKEN")
        .set(CSRF_HEADER, admin.csrf)
        .send({ value: " geheim-123 " })
        .expect(200);
      expect(saved.body.secrets[0]).toEqual(expect.objectContaining({ stored: "stored", fromEnv: false }));
      expect(JSON.stringify(saved.body)).not.toContain("geheim-123");
      expect((globalThis as { __demoStarts?: number }).__demoStarts).toBe(starts + 1);
      expect((await admin.agent.get("/api/m/demo/token").expect(200)).body.token).toBe("geheim-123");

      const context = createDb();
      try {
        const row = context.sqlite.prepare("SELECT value_enc FROM module_secrets WHERE module_id = 'demo'").get() as { value_enc: string };
        expect(row.value_enc).toMatch(/^v1:/);
        expect(row.value_enc).not.toContain("geheim");
        const audit = context.sqlite.prepare("SELECT summary, metadata FROM audit_logs WHERE action = 'module.secret_updated'").all();
        expect(audit).toHaveLength(1);
        expect(JSON.stringify(audit)).not.toContain("geheim");
      } finally {
        context.sqlite.close();
      }

      // Umgebungsvariable hat Vorrang
      process.env.MATCHDESK_DEMO_TOKEN = "aus-env";
      expect((await admin.agent.get("/api/m/demo/token").expect(200)).body.token).toBe("aus-env");
      expect((await admin.agent.get("/api/admin/modules/demo/secrets").expect(200)).body.secrets[0].fromEnv).toBe(true);
      delete process.env.MATCHDESK_DEMO_TOKEN;

      // Anderer Schlüssel: nicht mehr lesbar, statt Unsinn an das Modul zu geben
      process.env.MATCHDESK_DEVICE_KEY_SECRET = "anderer-schluessel";
      expect((await admin.agent.get("/api/admin/modules/demo/secrets").expect(200)).body.secrets[0].stored).toBe("unreadable");
      expect((await admin.agent.get("/api/m/demo/token").expect(200)).body.token).toBeNull();
      process.env.MATCHDESK_DEVICE_KEY_SECRET = "test-device-key-secret";

      const removed = await admin.agent.delete("/api/admin/modules/demo/secrets/DEMO_TOKEN").set(CSRF_HEADER, admin.csrf).expect(200);
      expect(removed.body.secrets[0].stored).toBe("missing");
      expect((await admin.agent.get("/api/m/demo/token").expect(200)).body.token).toBeNull();
    } finally {
      delete process.env.MATCHDESK_DEVICE_KEY_SECRET;
      delete process.env.MATCHDESK_DEMO_TOKEN;
    }
  });

  it("meldet Benachrichtigungskanäle von Modulen an und beim Ausschalten wieder ab", async () => {
    publish([{ version: "1.0.0", pkg: buildPackage("1.0.0") }]);
    const app = await start();
    const admin = await adminSession(app);
    const sourceId = await addDemoSource(admin);
    await installAndEnable(admin, sourceId);
    (globalThis as { __demoSent?: unknown[] }).__demoSent = [];

    expect(listNotificationChannels().find((channel) => channel.id === "demo")).toEqual(
      expect.objectContaining({ moduleId: "demo", defaultEnabled: false })
    );
    const choices = (await admin.agent.get("/api/notifications/channels").expect(200)).body.channels;
    expect(choices).toEqual(expect.arrayContaining([expect.objectContaining({ id: "demo", enabled: false, available: true })]));
    await admin.agent.put("/api/notifications/channels/demo").set(CSRF_HEADER, admin.csrf).send({ enabled: true }).expect(200);

    const context = createDb();
    try {
      const adminId = context.sqlite.prepare("SELECT id FROM users WHERE username = 'hauptadmin'").get() as { id: string };
      const message = { mainEventId: "e1", eventName: "LAN", subject: "Pizza", body: "Um 20 Uhr", path: "#main-events" };
      const deliveries = await notifyUsers(context, [adminId.id], message, { onlyChannels: ["demo"] });
      expect(deliveries).toEqual([expect.objectContaining({ channelId: "demo", status: "sent" })]);
      expect((globalThis as { __demoSent?: unknown[] }).__demoSent).toEqual([
        {
          user: "hauptadmin",
          message: expect.objectContaining({ subject: "Pizza", body: "Um 20 Uhr", eventName: "LAN", path: "#main-events" })
        }
      ]);

      await admin.agent.post("/api/admin/modules/demo/disable").set(CSRF_HEADER, admin.csrf).send({}).expect(200);
      expect(listNotificationChannels().some((channel) => channel.id === "demo")).toBe(false);
      expect(await notifyUsers(context, [adminId.id], message, { onlyChannels: ["demo"] })).toEqual([
        expect.objectContaining({ status: "skipped", error: "kein_kanal" })
      ]);
    } finally {
      context.sqlite.close();
    }
  });

  it("gibt Modulen den rohen JSON-Body ihrer Anfragen, dem Kern nicht", async () => {
    publish([{ version: "1.0.0", pkg: buildPackage("1.0.0") }]);
    const app = await start();
    const admin = await adminSession(app);
    const sourceId = await addDemoSource(admin);
    await installAndEnable(admin, sourceId);

    // Ohne Anmeldung wie ein Webhook; die Bytes kommen unverändert an (Abstände, Escapes, Reihenfolge).
    const raw = '{ "z":1,"a" : "\\u00e4" }';
    const response = await request(app.app).post("/api/m/demo/roh").set("Content-Type", "application/json").send(raw).expect(200);
    expect(response.body).toEqual({ body: { z: 1, a: "ä" }, raw });
    // Kern-Routen parsen JSON wie bisher (Anmeldung per JSON-Body).
    await request(app.app).post("/api/auth/request-code").set("Content-Type", "application/json").send('{ "username" : "hauptadmin" }').expect(202);
  });

  it("lehnt Pakete mit falscher Prüfsumme, falscher Schnittstelle oder fremden Tabellen ab", async () => {
    const pkg = buildPackage("1.0.0");
    publish([{ version: "1.0.0", pkg, sha: "0".repeat(64) }]);
    const app = await start();
    const admin = await adminSession(app);
    const sourceId = await addDemoSource(admin);

    const wrongSha = await admin.agent
      .post("/api/admin/modules/install")
      .set(CSRF_HEADER, admin.csrf)
      .send({ sourceId, moduleId: "demo", confirm: true })
      .expect(422);
    expect(wrongSha.body.error).toBe("paket_pruefsumme_falsch");

    publish([{ version: "2.0.0", pkg: buildPackage("2.0.0"), matchdeskApi: 2 }]);
    await admin.agent.get(`/api/admin/modules/sources/${sourceId}/modules?force=1`).expect(200);
    const wrongApi = await admin.agent
      .post("/api/admin/modules/install")
      .set(CSRF_HEADER, admin.csrf)
      .send({ sourceId, moduleId: "demo", version: "2.0.0", confirm: true })
      .expect(422);
    expect(wrongApi.body.error).toBe("modul_api_inkompatibel");

    const evil = buildPackage("1.0.1", {
      migrations: {
        "0001_init.sql": "CREATE TABLE demo_notes (id TEXT PRIMARY KEY, text TEXT NOT NULL);",
        "0002_evil.sql": "ALTER TABLE users ADD COLUMN evil TEXT;"
      }
    });
    publish([{ version: "1.0.1", pkg: evil }]);
    await admin.agent.get(`/api/admin/modules/sources/${sourceId}/modules?force=1`).expect(200);
    await admin.agent
      .post("/api/admin/modules/install")
      .set(CSRF_HEADER, admin.csrf)
      .send({ sourceId, moduleId: "demo", confirm: true })
      .expect(200);
    const enable = await admin.agent.post("/api/admin/modules/demo/enable").set(CSRF_HEADER, admin.csrf).send({}).expect(500);
    expect(enable.body.message).toContain("fremde Tabellen");
    await admin.agent.get("/api/m/demo/hello").expect(404);
    const module = (await admin.agent.get("/api/admin/modules/demo").expect(200)).body.module;
    expect(module.state).toBe("installed");
    expect(module.error).toContain("users");

    const sqlite = new (await import("better-sqlite3")).default(databasePath, { readonly: true });
    const columns = (sqlite.prepare("SELECT name FROM pragma_table_info('users')").all() as Array<{ name: string }>).map((row) => row.name);
    const applied = sqlite.prepare("SELECT name FROM schema_migrations WHERE name LIKE 'demo/%'").all();
    sqlite.close();
    expect(columns).not.toContain("evil");
    // 0001 lief sauber durch, 0002 wurde zurückgerollt
    expect(applied).toEqual([{ name: "demo/0001_init.sql" }]);
  });

  it("schützt Quellen mit aktiven Modulen und lässt verwaiste Module nur noch deinstallieren", async () => {
    publish([{ version: "1.0.0", pkg: buildPackage("1.0.0") }]);
    const app = await start();
    const admin = await adminSession(app);
    const sourceId = await addDemoSource(admin);
    await installAndEnable(admin, sourceId);

    const blocked = await admin.agent.delete(`/api/admin/modules/sources/${sourceId}`).set(CSRF_HEADER, admin.csrf).expect(409);
    expect(blocked.body).toEqual(expect.objectContaining({ error: "quelle_hat_aktive_module", modules: ["demo"] }));
    await admin.agent
      .patch(`/api/admin/modules/sources/${sourceId}`)
      .set(CSRF_HEADER, admin.csrf)
      .send({ name: "Neu" })
      .expect(409);

    await admin.agent.post("/api/admin/modules/demo/disable").set(CSRF_HEADER, admin.csrf).send({}).expect(200);
    await admin.agent
      .patch(`/api/admin/modules/sources/${sourceId}`)
      .set(CSRF_HEADER, admin.csrf)
      .send({ name: "Neu" })
      .expect(200);
    await admin.agent.delete(`/api/admin/modules/sources/${sourceId}`).set(CSRF_HEADER, admin.csrf).expect(204);

    const module = (await admin.agent.get("/api/admin/modules/demo").expect(200)).body.module;
    expect(module.orphaned).toBe(true);
    const update = await admin.agent.post("/api/admin/modules/demo/update").set(CSRF_HEADER, admin.csrf).send({}).expect(409);
    expect(update.body.error).toBe("modul_verwaist");
    await admin.agent.post("/api/admin/modules/demo/uninstall").set(CSRF_HEADER, admin.csrf).send({ confirmId: "demo" }).expect(204);
  });

  it("prüft Quellen-Eingaben: nur HTTPS und nur Token-Variablen mit festem Präfix", async () => {
    const app = await start();
    const admin = await adminSession(app);
    const http = await admin.agent
      .post("/api/admin/modules/sources")
      .set(CSRF_HEADER, admin.csrf)
      .send({ name: "Unsicher", url: "http://modules.example.test/x" })
      .expect(400);
    expect(http.body.error).toBe("quelle_nur_https");
    const token = await admin.agent
      .post("/api/admin/modules/sources")
      .set(CSRF_HEADER, admin.csrf)
      .send({ name: "Privat", url: "https://github.com/acme/modules", tokenEnv: "MATCHDESK_SESSION_SECRET" })
      .expect(400);
    expect(token.body.error).toBe("quelle_token_name_ungueltig");
    await admin.agent
      .post("/api/admin/modules/sources")
      .set(CSRF_HEADER, admin.csrf)
      .send({ name: "Privat", url: "https://github.com/acme/modules", tokenEnv: "MATCHDESK_SOURCE_TOKEN_ACME" })
      .expect(200);
  });

  it("empfiehlt Updates, spielt sie mit neuen Migrationen ein und verweigert Zurückstufen", async () => {
    const v1 = buildPackage("1.0.0");
    publish([{ version: "1.0.0", pkg: v1 }]);
    const app = await start();
    const admin = await adminSession(app);
    const sourceId = await addDemoSource(admin);
    await installAndEnable(admin, sourceId);

    const v2 = buildPackage("1.1.0", {
      migrations: {
        "0001_init.sql":
          "CREATE TABLE IF NOT EXISTS demo_notes (id TEXT PRIMARY KEY, text TEXT NOT NULL, user_id TEXT REFERENCES users(id) ON DELETE CASCADE);",
        "0002_pinned.sql": "ALTER TABLE demo_notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;"
      },
      manifest: demoManifest("1.1.0", {
        permissions: [
          { key: "demo.write", label: "Notizen schreiben", defaultRoles: ["user"] },
          { key: "demo.manage", label: "Demo verwalten", scopable: true, defaultRoles: ["manager"] },
          { key: "demo.pin", label: "Anheften", defaultRoles: ["manager"] }
        ]
      })
    });
    publish([
      { version: "1.0.0", pkg: v1 },
      { version: "1.1.0", pkg: v2 }
    ]);

    const updates = await admin.agent.get("/api/admin/modules/updates?force=1").expect(200);
    expect(updates.body.updates).toEqual([{ id: "demo", installed: "1.0.0", latest: "1.1.0", sourceId }]);

    const preview = await admin.agent.post("/api/admin/modules/demo/update").set(CSRF_HEADER, admin.csrf).send({}).expect(200);
    expect(preview.body).toEqual(
      expect.objectContaining({ confirmed: false, from: "1.0.0", to: "1.1.0", diff: expect.objectContaining({ addedPermissions: ["demo.pin"] }) })
    );

    const stopsBefore = (globalThis as { __demoStops?: number }).__demoStops ?? 0;
    const done = await admin.agent.post("/api/admin/modules/demo/update").set(CSRF_HEADER, admin.csrf).send({ confirm: true }).expect(200);
    expect(done.body.module).toEqual(expect.objectContaining({ version: "1.1.0", previousVersion: "1.0.0", state: "enabled", running: true }));
    expect((globalThis as { __demoStops?: number }).__demoStops).toBe(stopsBefore + 1);
    await admin.agent.get("/api/m/demo/hello").expect(200);
    expect((await request(app.app).get("/modules/demo/1.1.0/client.mjs")).status).toBe(200);

    const sqlite = new (await import("better-sqlite3")).default(databasePath, { readonly: true });
    const columns = (sqlite.prepare("SELECT name FROM pragma_table_info('demo_notes')").all() as Array<{ name: string }>).map((row) => row.name);
    sqlite.close();
    expect(columns).toContain("pinned");

    const downgrade = await admin.agent
      .post("/api/admin/modules/demo/update")
      .set(CSRF_HEADER, admin.csrf)
      .send({ version: "1.0.0", confirm: true })
      .expect(409);
    expect(downgrade.body.error).toBe("modul_zurueckstufen_unmoeglich");
    expect((await admin.agent.get("/api/admin/modules/updates").expect(200)).body.updates).toEqual([]);
  });

  it("startet aktive Module nach einem Neustart wieder und lädt fehlende Dateien mit gleicher Prüfsumme nach", async () => {
    publish([{ version: "1.0.0", pkg: buildPackage("1.0.0") }]);
    let app = await start();
    let admin = await adminSession(app);
    const sourceId = await addDemoSource(admin);
    await installAndEnable(admin, sourceId);
    await app.close();
    started = undefined;

    fs.rmSync(modulesDir, { recursive: true, force: true });
    fetchCalls = [];
    app = await start();
    admin = await adminSession(app);
    expect(fetchCalls).toEqual([`${SOURCE_URL}/demo-1.0.0.tgz`]);
    expect((await admin.agent.get("/api/m/demo/hello").expect(200)).body.greeting).toBe("Hallo");
  });

  it("startet ein Modul nicht, wenn das nachgeladene Paket eine andere Prüfsumme hat", async () => {
    publish([{ version: "1.0.0", pkg: buildPackage("1.0.0") }]);
    let app = await start();
    let admin = await adminSession(app);
    const sourceId = await addDemoSource(admin);
    await installAndEnable(admin, sourceId);
    await app.close();
    started = undefined;

    fs.rmSync(modulesDir, { recursive: true, force: true });
    files.set(`${SOURCE_URL}/demo-1.0.0.tgz`, buildPackage("1.0.0", { migrations: {} }));
    app = await start();
    admin = await adminSession(app);
    await admin.agent.get("/api/m/demo/hello").expect(404);
    const module = (await admin.agent.get("/api/admin/modules/demo").expect(200)).body.module;
    expect(module).toEqual(expect.objectContaining({ state: "enabled", running: false }));
    expect(module.error).toContain("Prüfsumme");
  });
});
