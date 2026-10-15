import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../integrations/amp/__fixtures__/get-instances.json";
import { CSRF_HEADER } from "../auth/csrf";
import { bootstrapAdmin } from "../db/bootstrap-admin";
import { createHermesApp } from "../app";
import { setAmpFetchForTests } from "../integrations/amp/amp-session";
import { resetAmpStatusForTests } from "../integrations/amp/amp-status";
import { maskConsoleSecrets } from "./amp-routes";

type StartedApp = Awaited<ReturnType<typeof createHermesApp>>;
type AmpCall = { endpoint: string; body: Record<string, unknown> };

let started: StartedApp | undefined;
let databasePath: string;
let ampCalls: AmpCall[] = [];

const CS2_ID = (fixture as Array<{ AvailableInstances: Array<{ InstanceID: string; InstanceName: string }> }>)
  .flatMap((t) => t.AvailableInstances)
  .find((i) => i.InstanceName === "Counter-Strike201")!.InstanceID;

function installAmpMock() {
  ampCalls = [];
  const fetchMock = vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    // nicht-gierig: Proxy-Pfade enthalten ein zweites "/API/" (…/Servers/<id>/API/Core/Stop)
    const endpoint = String(url).replace(/^.*?\/API\//, "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    ampCalls.push({ endpoint, body });
    let payload: unknown;
    if (endpoint === "Core/Login") {
      payload = { success: true, sessionID: "S-TEST", rememberMeToken: "R" };
    } else if (endpoint === "ADSModule/GetInstances") {
      payload = fixture;
    } else if (endpoint.endsWith("/API/Core/GetUpdates")) {
      payload = {
        ConsoleEntries: [
          { Timestamp: "2026-10-15T20:00:00Z", Source: "Console", Contents: "Server started" },
          { Timestamp: "2026-10-15T20:00:01Z", Source: "Console", Contents: 'rcon_password "SuperGeheim123"' }
        ]
      };
    } else {
      payload = { Status: true };
    }
    return { status: 200, text: async () => JSON.stringify(payload) };
  });
  setAmpFetchForTests(fetchMock as unknown as Parameters<typeof setAmpFetchForTests>[0]);
}

async function login(agent: ReturnType<typeof request.agent>, username: string) {
  await agent.post("/api/auth/request-code").send({ username }).expect(202);
  const response = await agent
    .post("/api/auth/verify-code")
    .send({ username, code: "123456", deviceName: "test" })
    .expect(200);
  return response.body.user as { id: string; role: string };
}

async function fetchCsrf(agent: ReturnType<typeof request.agent>) {
  const response = await agent.get("/api/auth/csrf").expect(200);
  return response.body.token as string;
}

async function createUser(admin: ReturnType<typeof request.agent>, csrf: string, username: string, role: string) {
  await admin
    .post("/api/admin/users")
    .set(CSRF_HEADER, csrf)
    .send({ username, email: `${username}@example.test`, role })
    .expect(201);
  const agent = request.agent(started!.app);
  await login(agent, username);
  return { agent, csrf: await fetchCsrf(agent) };
}

describe("AMP control + status (Phase 15-02)", () => {
  beforeEach(async () => {
    databasePath = path.join(os.tmpdir(), `hermes-test-${randomUUID()}.sqlite`);
    process.env.HERMES_DB_PATH = databasePath;
    process.env.HERMES_ADMIN_PHONE = "+491701234567";
    process.env.HERMES_ADMIN_USERNAME = "hauptadmin";
    process.env.HERMES_ADMIN_EMAIL = "hauptadmin@example.test";
    process.env.HERMES_MAIL_MODE = "console";
    process.env.HERMES_DEV_LOGIN_CODE = "123456";
    process.env.HERMES_AMP_USERNAME = "hermes";
    process.env.HERMES_AMP_PASSWORD = "geheim";
    delete process.env.HERMES_AMP_CA_FILE;
    delete process.env.HERMES_AMP_REMEMBER_TOKEN_FILE;
    delete process.env.HERMES_STORAGE_BACKEND;
    delete process.env.HERMES_VAPID_PUBLIC_KEY;
    delete process.env.HERMES_VAPID_PRIVATE_KEY;
    resetAmpStatusForTests();
    installAmpMock();
    await bootstrapAdmin();
    started = await createHermesApp();
  }, 30_000);

  afterEach(async () => {
    await started?.close();
    started = undefined;
    setAmpFetchForTests(null);
    resetAmpStatusForTests();
    delete process.env.HERMES_AMP_USERNAME;
    delete process.env.HERMES_AMP_PASSWORD;
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  });

  it("masks secrets in console output", () => {
    expect(maskConsoleSecrets('rcon_password "abc"')).toBe('rcon_password ***');
    expect(maskConsoleSecrets("sv_password=hunter2 ok")).toBe("sv_password=*** ok");
    expect(maskConsoleSecrets("Server started")).toBe("Server started");
  });

  it("enforces the role matrix, audits actions, serves status and kiosk server info", async () => {
    const admin = request.agent(started!.app);
    await login(admin, "hauptadmin");
    const adminCsrf = await fetchCsrf(admin);

    const current = await admin.get("/api/admin/settings").expect(200);
    await admin
      .put("/api/admin/settings")
      .set(CSRF_HEADER, adminCsrf)
      .send({
        ...current.body.settings,
        ampIntegrationEnabled: true,
        ampBaseUrl: "https://amp-ctl.example.test",
        kioskStreamEnabled: true,
        kioskStreamSecret: "kiosk-secret-123456"
      })
      .expect(200);

    const created = await admin
      .post("/api/integrations/amp/bindings")
      .set(CSRF_HEADER, adminCsrf)
      .send({
        displayTitle: "Counter-Strike 2",
        ampInstanceId: CS2_ID,
        ampInstanceName: "Counter-Strike201",
        host: "cs2.lanparty.example",
        port: 27015,
        connectScheme: "steam",
        enabled: true
      })
      .expect(201);
    const bindingId = created.body.binding.id as string;

    const user = await createUser(admin, adminCsrf, "spieler", "user");
    const organizer = await createUser(admin, adminCsrf, "orga", "organizer");
    const manager = await createUser(admin, adminCsrf, "mgr", "manager");

    // Status: jeder Angemeldete, Refresh stößt genau einen GetInstances-Poll an
    const status = await user.agent.get("/api/integrations/amp/status?refresh=1").expect(200);
    expect(status.body.servers).toHaveLength(1);
    expect(status.body.servers[0]).toMatchObject({
      bindingId,
      running: true,
      appState: "Ready",
      players: 0,
      maxPlayers: 32,
      host: "cs2.lanparty.example"
    });
    expect(ampCalls.filter((c) => c.endpoint === "ADSModule/GetInstances")).toHaveLength(1);

    // Rollen: user + organizer 403 auf jede Aktion, manager 200
    for (const action of ["start", "stop", "restart", "update", "kill"]) {
      await user.agent
        .post(`/api/integrations/amp/instances/${bindingId}/${action}`)
        .set(CSRF_HEADER, user.csrf)
        .expect(403);
      await organizer.agent
        .post(`/api/integrations/amp/instances/${bindingId}/${action}`)
        .set(CSRF_HEADER, organizer.csrf)
        .expect(403);
    }
    await manager.agent
      .post(`/api/integrations/amp/instances/${bindingId}/stop`)
      .set(CSRF_HEADER, manager.csrf)
      .expect(200);
    expect(ampCalls.some((c) => c.endpoint === `ADSModule/Servers/${CS2_ID}/API/Core/Stop`)).toBe(true);

    await manager.agent
      .post(`/api/integrations/amp/instances/${bindingId}/update`)
      .set(CSRF_HEADER, manager.csrf)
      .expect(200);
    expect(ampCalls.some((c) => c.endpoint === `ADSModule/Servers/${CS2_ID}/API/Core/UpdateApplication`)).toBe(true);

    // Unbekannte Aktion / unbekannte Bindung
    await manager.agent
      .post(`/api/integrations/amp/instances/${bindingId}/explode`)
      .set(CSRF_HEADER, manager.csrf)
      .expect(404);
    await manager.agent
      .post(`/api/integrations/amp/instances/nope/stop`)
      .set(CSRF_HEADER, manager.csrf)
      .expect(404);

    // Audit-Eintrag für manager-Aktion
    const audit = await admin.get("/api/admin/audit-log").expect(200);
    const entries = audit.body.auditLogs as Array<{ action: string; actorUsername: string }>;
    expect(entries.some((e) => e.action === "amp.instance_stop" && e.actorUsername === "mgr")).toBe(true);

    // Konsole: nur manager+, Passwort maskiert, Cursor funktioniert
    await user.agent.get(`/api/integrations/amp/instances/${bindingId}/console`).expect(403);
    const console1 = await manager.agent.get(`/api/integrations/amp/instances/${bindingId}/console`).expect(200);
    expect(console1.body.lines).toHaveLength(2);
    expect(JSON.stringify(console1.body)).not.toContain("SuperGeheim123");
    expect(console1.body.lines[1].text).toBe("rcon_password ***");
    const console2 = await manager.agent
      .get(`/api/integrations/amp/instances/${bindingId}/console?since=${console1.body.cursor}`)
      .expect(200);
    expect(console2.body.lines).toHaveLength(2); // Mock liefert bei jedem GetUpdates dieselben zwei Zeilen neu
    expect(console2.body.lines[0].seq).toBeGreaterThan(console1.body.cursor);

    await manager.agent
      .post(`/api/integrations/amp/instances/${bindingId}/console`)
      .set(CSRF_HEADER, manager.csrf)
      .send({ command: "status" })
      .expect(200);
    expect(
      ampCalls.some((c) => c.endpoint === `ADSModule/Servers/${CS2_ID}/API/Core/SendConsoleMessage` && c.body.message === "status")
    ).toBe(true);

    // Kiosk liefert genau die sechs Serverfelder
    await manager.agent
      .post("/api/events")
      .set(CSRF_HEADER, manager.csrf)
      .send({ gameTitle: "Counter-Strike 2", startMode: "now", minPlayers: 2, maxPlayers: 10 })
      .expect(201);
    const kiosk = await request(started!.app).get("/api/kiosk/events?id=kiosk-secret-123456").expect(200);
    const kioskEvent = (kiosk.body.events as Array<{ gameTitle: string; server: unknown }>).find(
      (e) => e.gameTitle === "Counter-Strike 2"
    );
    expect(kioskEvent?.server).toEqual({
      running: true,
      appState: "Ready",
      players: 0,
      maxPlayers: 32,
      host: "cs2.lanparty.example",
      port: 27015
    });

    // Rate-Limit greift bei Klick-Spam
    let limited = false;
    for (let i = 0; i < 25; i += 1) {
      const res = await manager.agent
        .post(`/api/integrations/amp/instances/${bindingId}/restart`)
        .set(CSRF_HEADER, manager.csrf);
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  }, 60_000);

  it("hides status and control while the module is disabled", async () => {
    const admin = request.agent(started!.app);
    await login(admin, "hauptadmin");
    const csrf = await fetchCsrf(admin);
    await admin.get("/api/integrations/amp/status").expect(404);
    await admin.post("/api/integrations/amp/instances/x/stop").set(CSRF_HEADER, csrf).expect(404);
  });
});
