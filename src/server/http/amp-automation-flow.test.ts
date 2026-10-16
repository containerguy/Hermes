import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async () => undefined)
  }
}));

import webpush from "web-push";
import fixture from "../integrations/amp/__fixtures__/get-instances.json";
import { CSRF_HEADER } from "../auth/csrf";
import { bootstrapAdmin } from "../db/bootstrap-admin";
import { createHermesApp } from "../app";
import { setAmpFetchForTests } from "../integrations/amp/amp-session";
import { resetAmpStatusForTests } from "../integrations/amp/amp-status";
import { runAutomationNow } from "../integrations/amp/amp-automation";

type StartedApp = Awaited<ReturnType<typeof createHermesApp>>;
type Agent = ReturnType<typeof request.agent>;
type FixtureInstance = { InstanceID: string; InstanceName: string; AppState: number };

let started: StartedApp | undefined;
let databasePath: string;
let ampCalls: string[] = [];
let instances: Array<{ AvailableInstances: FixtureInstance[] }> = [];

function minecraft() {
  return instances.flatMap((t) => t.AvailableInstances).find((i) => i.InstanceName === "Minecraft01")!;
}

function installAmpMock() {
  ampCalls = [];
  instances = JSON.parse(JSON.stringify(fixture));
  const fetchMock = vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    const endpoint = String(url).replace(/^.*?\/API\//, "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    ampCalls.push(endpoint);
    let payload: unknown;
    if (endpoint === "Core/Login") {
      payload = { success: true, sessionID: "S-TEST", rememberMeToken: "R" };
    } else if (endpoint.endsWith("/API/Core/Login")) {
      payload = { success: true, sessionID: "I-TEST" };
    } else if (endpoint.includes("/API/") && body.SESSIONID !== "I-TEST") {
      payload = { Title: "Unauthorized Access", Message: "requires the Session.Exists permission." };
    } else if (endpoint === "ADSModule/GetInstances") {
      payload = instances;
    } else {
      payload = { Status: true };
    }
    return { status: 200, text: async () => JSON.stringify(payload) };
  });
  setAmpFetchForTests(fetchMock as unknown as Parameters<typeof setAmpFetchForTests>[0]);
}

async function login(agent: Agent, username: string) {
  await agent.post("/api/auth/request-code").send({ username }).expect(202);
  const response = await agent
    .post("/api/auth/verify-code")
    .send({ username, code: "123456", deviceName: "test" })
    .expect(200);
  return response.body.user as { id: string };
}

async function fetchCsrf(agent: Agent) {
  const response = await agent.get("/api/auth/csrf").expect(200);
  return response.body.token as string;
}

async function createUser(admin: Agent, csrf: string, username: string, role: string) {
  await admin
    .post("/api/admin/users")
    .set(CSRF_HEADER, csrf)
    .send({ username, email: `${username}@example.test`, role })
    .expect(201);
  const agent = request.agent(started!.app);
  const user = await login(agent, username);
  return { agent, csrf: await fetchCsrf(agent), id: user.id };
}

function addSubscription(userId: string, endpoint: string) {
  const sqlite = new Database(databasePath);
  sqlite
    .prepare(
      `INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, created_at, revoked_at)
       VALUES (?, ?, NULL, ?, 'p', 'a', ?, NULL)`
    )
    .run(randomUUID(), userId, endpoint, new Date().toISOString());
  sqlite.close();
}

function auditActions(action: string) {
  const sqlite = new Database(databasePath);
  const rows = sqlite
    .prepare("SELECT actor_user_id, summary FROM audit_logs WHERE action = ?")
    .all(action) as Array<{ actor_user_id: string | null; summary: string }>;
  sqlite.close();
  return rows;
}

describe("AMP automation (Phase 15-04)", () => {
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
    process.env.HERMES_VAPID_PUBLIC_KEY = "test-public";
    process.env.HERMES_VAPID_PRIVATE_KEY = "test-private";
    delete process.env.HERMES_AMP_CA_FILE;
    delete process.env.HERMES_AMP_REMEMBER_TOKEN_FILE;
    delete process.env.HERMES_STORAGE_BACKEND;
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
    vi.clearAllMocks();
    for (const key of [
      "HERMES_AMP_USERNAME",
      "HERMES_AMP_PASSWORD",
      "HERMES_VAPID_PUBLIC_KEY",
      "HERMES_VAPID_PRIVATE_KEY"
    ]) {
      delete process.env[key];
    }
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  });

  it("auto-starts once when an event is ready and pushes only joined participants once", async () => {
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
        ampAutoStartOnReady: true
      })
      .expect(200);

    const binding = await admin
      .post("/api/integrations/amp/bindings")
      .set(CSRF_HEADER, adminCsrf)
      .send({
        displayTitle: "Minecraft",
        ampInstanceId: minecraft().InstanceID,
        ampInstanceName: "Minecraft01",
        host: "minecraft.lanparty.example",
        port: 25565,
        connectScheme: "minecraft",
        enabled: true
      })
      .expect(201);
    const bindingId = binding.body.binding.id as string;

    const manager = await createUser(admin, adminCsrf, "mgr", "manager");
    const anna = await createUser(admin, adminCsrf, "anna", "user");
    const ben = await createUser(admin, adminCsrf, "ben", "user");
    const carla = await createUser(admin, adminCsrf, "carla", "user");

    // Ben hat Benachrichtigungen aus, Carla ist "nicht dabei"
    await ben.agent
      .patch("/api/push/preferences")
      .set(CSRF_HEADER, ben.csrf)
      .send({ enabled: false })
      .expect(200);
    addSubscription(anna.id, "https://push.example.test/anna");
    addSubscription(ben.id, "https://push.example.test/ben");
    addSubscription(carla.id, "https://push.example.test/carla");

    // Erster Tick nach dem Start: nur Basis, noch keine Events
    await admin.get("/api/integrations/amp/status?refresh=1").expect(200);
    await runAutomationNow();

    const created = await manager.agent
      .post("/api/events")
      .set(CSRF_HEADER, manager.csrf)
      .send({ gameTitle: "Minecraft", startMode: "now", minPlayers: 2, maxPlayers: 10 })
      .expect(201);
    const eventId = created.body.event.id as string;
    expect(created.body.event.serverBindingId).toBe(bindingId);

    for (const player of [anna, ben]) {
      await player.agent
        .post(`/api/events/${eventId}/participation`)
        .set(CSRF_HEADER, player.csrf)
        .send({ status: "joined" })
        .expect(200);
    }
    await carla.agent
      .post(`/api/events/${eventId}/participation`)
      .set(CSRF_HEADER, carla.csrf)
      .send({ status: "declined" })
      .expect(200);

    // Event ist bereit, Minecraft01 steht auf Stopped -> genau ein Start
    await runAutomationNow();
    await runAutomationNow();
    const startCalls = ampCalls.filter((c) => c === `ADSModule/Servers/${minecraft().InstanceID}/API/Core/Start`);
    expect(startCalls).toHaveLength(1);
    const autoStarts = auditActions("amp.auto_start");
    expect(autoStarts).toHaveLength(1);
    expect(autoStarts[0].actor_user_id).toBeNull();
    const sendNotification = webpush.sendNotification as unknown as ReturnType<typeof vi.fn>;
    const serverPushes = () =>
      sendNotification.mock.calls.filter(([, raw]) => String(raw).includes("Server für"));
    expect(serverPushes()).toHaveLength(0);

    // Server läuft -> Push nur an Anna (dabei + Benachrichtigungen an), einmal
    minecraft().AppState = 20;
    await admin.get("/api/integrations/amp/status?refresh=1").expect(200);
    await runAutomationNow();
    await runAutomationNow();

    expect(serverPushes()).toHaveLength(1);
    const [subscription, rawPayload] = serverPushes()[0] as [{ endpoint: string }, string];
    expect(subscription.endpoint).toBe("https://push.example.test/anna");
    const payload = JSON.parse(rawPayload) as Record<string, unknown>;
    expect(payload).toEqual({
      title: "Server für Minecraft läuft",
      body: "Du bist dabei – jetzt verbinden.",
      url: "/#events"
    });
    expect(rawPayload).not.toContain("minecraft.lanparty.example");
    expect(rawPayload).not.toContain("25565");

    // Manager stoppt bewusst -> Automatik startet nicht erneut
    minecraft().AppState = 0;
    await admin.get("/api/integrations/amp/status?refresh=1").expect(200);
    await runAutomationNow();
    expect(ampCalls.filter((c) => c === `ADSModule/Servers/${minecraft().InstanceID}/API/Core/Start`)).toHaveLength(1);
  });

  it("auto-stops an idle server without active events and audits it", async () => {
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
        ampAutoStopIdleMinutes: 1
      })
      .expect(200);
    const cs2 = instances.flatMap((t) => t.AvailableInstances).find((i) => i.InstanceName === "Counter-Strike201")!;
    await admin
      .post("/api/integrations/amp/bindings")
      .set(CSRF_HEADER, adminCsrf)
      .send({
        displayTitle: "Counter-Strike 2",
        ampInstanceId: cs2.InstanceID,
        ampInstanceName: "Counter-Strike201",
        host: "cs2.lanparty.example",
        port: 27015,
        connectScheme: "steam",
        enabled: true
      })
      .expect(201);
    await admin.get("/api/integrations/amp/status?refresh=1").expect(200);

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await runAutomationNow();
      vi.setSystemTime(Date.now() + 30_000);
      await runAutomationNow();
      expect(ampCalls).not.toContain(`ADSModule/Servers/${cs2.InstanceID}/API/Core/Stop`);
      vi.setSystemTime(Date.now() + 31_000);
      await runAutomationNow();
    } finally {
      vi.useRealTimers();
    }

    expect(ampCalls.filter((c) => c === `ADSModule/Servers/${cs2.InstanceID}/API/Core/Stop`)).toHaveLength(1);
    const autoStops = auditActions("amp.auto_stop");
    expect(autoStops).toHaveLength(1);
    expect(autoStops[0].actor_user_id).toBeNull();
  });

  it("does nothing while the AMP module is disabled", async () => {
    await runAutomationNow();
    await runAutomationNow();
    expect(ampCalls).toHaveLength(0);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });
});
