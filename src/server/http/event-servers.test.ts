import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CSRF_HEADER } from "../auth/csrf";
import { bootstrapAdmin } from "../db/bootstrap-admin";
import { createMatchdeskApp } from "../app";

type StartedApp = Awaited<ReturnType<typeof createMatchdeskApp>>;
type Agent = ReturnType<typeof request.agent>;

let started: StartedApp | undefined;
let databasePath: string;

async function login(agent: Agent, username: string) {
  await agent.post("/api/auth/request-code").send({ username }).expect(202);
  await agent
    .post("/api/auth/verify-code")
    .send({ username, code: "123456", deviceName: "test" })
    .expect(200);
}

async function fetchCsrf(agent: Agent) {
  const response = await agent.get("/api/auth/csrf").expect(200);
  return response.body.token as string;
}

function binding(title: string, instance: string) {
  return {
    displayTitle: title,
    ampInstanceId: instance,
    ampInstanceName: `${title}01`,
    host: `${title.toLowerCase()}.lan.example`,
    port: 27015,
    connectScheme: "steam",
    enabled: true
  };
}

function round(title: string, extra: Record<string, unknown> = {}) {
  return { gameTitle: title, startMode: "now", minPlayers: 2, maxPlayers: 10, ...extra };
}

describe("Gameserver pro Event (C4)", () => {
  beforeEach(async () => {
    databasePath = path.join(os.tmpdir(), `matchdesk-test-${randomUUID()}.sqlite`);
    process.env.MATCHDESK_DB_PATH = databasePath;
    process.env.MATCHDESK_ADMIN_PHONE = "+491701234567";
    process.env.MATCHDESK_ADMIN_USERNAME = "hauptadmin";
    process.env.MATCHDESK_ADMIN_EMAIL = "hauptadmin@example.test";
    process.env.MATCHDESK_MAIL_MODE = "console";
    process.env.MATCHDESK_DEV_LOGIN_CODE = "123456";
    delete process.env.MATCHDESK_STORAGE_BACKEND;
    delete process.env.MATCHDESK_VAPID_PUBLIC_KEY;
    delete process.env.MATCHDESK_VAPID_PRIVATE_KEY;
    await bootstrapAdmin();
    started = await createMatchdeskApp();
  }, 30_000);

  afterEach(async () => {
    await started?.close();
    started = undefined;
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  });

  it("offers only the chosen servers in an event and keeps rounds without event unrestricted", async () => {
    const admin = request.agent(started!.app);
    await login(admin, "hauptadmin");
    const csrf = await fetchCsrf(admin);
    const current = await admin.get("/api/admin/settings").expect(200);
    await admin
      .put("/api/admin/settings")
      .set(CSRF_HEADER, csrf)
      .send({ ...current.body.settings, ampIntegrationEnabled: true, ampBaseUrl: "https://amp.example.test" })
      .expect(200);

    const cs = (
      await admin
        .post("/api/integrations/amp/bindings")
        .set(CSRF_HEADER, csrf)
        .send(binding("CS2", "11111111-2222-3333-4444-555555555555"))
        .expect(201)
    ).body.binding.id as string;
    const mc = (
      await admin
        .post("/api/integrations/amp/bindings")
        .set(CSRF_HEADER, csrf)
        .send(binding("Minecraft", "66666666-7777-8888-9999-000000000000"))
        .expect(201)
    ).body.binding.id as string;

    const lan = (
      await admin.post("/api/main-events").set(CSRF_HEADER, csrf).send({ name: "LAN" }).expect(201)
    ).body.mainEvent as { id: string; serverBindingIds: string[] };
    expect(lan.serverBindingIds).toEqual([]);
    await admin.post(`/api/main-events/${lan.id}/start`).set(CSRF_HEADER, csrf).expect(200);

    // Ohne Auswahl bietet das Event alle Server an
    const before = await admin
      .post("/api/events")
      .set(CSRF_HEADER, csrf)
      .send(round("Minecraft", { mainEventId: lan.id }))
      .expect(201);
    expect(before.body.event.serverBindingId).toBe(mc);

    // Unbekannte Bindung wird abgelehnt
    await admin
      .put(`/api/main-events/${lan.id}/servers`)
      .set(CSRF_HEADER, csrf)
      .send({ bindingIds: ["gibt-es-nicht"] })
      .expect(400);

    const saved = await admin
      .put(`/api/main-events/${lan.id}/servers`)
      .set(CSRF_HEADER, csrf)
      .send({ bindingIds: [cs] })
      .expect(200);
    expect(saved.body.mainEvent.serverBindingIds).toEqual([cs]);

    // Angebotener Server wird weiter automatisch verknüpft
    const csRound = await admin
      .post("/api/events")
      .set(CSRF_HEADER, csrf)
      .send(round("CS2", { mainEventId: lan.id }))
      .expect(201);
    expect(csRound.body.event.serverBindingId).toBe(cs);

    // Nicht angebotener Server: keine Auto-Verknüpfung, explizit abgelehnt
    const mcRound = await admin
      .post("/api/events")
      .set(CSRF_HEADER, csrf)
      .send(round("Minecraft", { mainEventId: lan.id }))
      .expect(201);
    expect(mcRound.body.event.serverBindingId).toBeNull();
    const rejected = await admin
      .post("/api/events")
      .set(CSRF_HEADER, csrf)
      .send(round("Minecraft", { mainEventId: lan.id, serverBindingId: mc }))
      .expect(400);
    expect(rejected.body.error).toBe("server_nicht_im_event");
    await admin
      .patch(`/api/events/${mcRound.body.event.id}`)
      .set(CSRF_HEADER, csrf)
      .send({ serverBindingId: mc })
      .expect(400);

    // Runde ohne Event: alle Server
    const free = await admin
      .post("/api/events")
      .set(CSRF_HEADER, csrf)
      .send(round("Minecraft", { mainEventId: null }))
      .expect(201);
    expect(free.body.event.serverBindingId).toBe(mc);

    // Normale Benutzer dürfen die Auswahl nicht ändern
    await admin
      .post("/api/admin/users")
      .set(CSRF_HEADER, csrf)
      .send({ username: "spieler", email: "spieler@example.test", role: "user" })
      .expect(201);
    const user = request.agent(started!.app);
    await login(user, "spieler");
    const userCsrf = await fetchCsrf(user);
    await user
      .put(`/api/main-events/${lan.id}/servers`)
      .set(CSRF_HEADER, userCsrf)
      .send({ bindingIds: [] })
      .expect(403);

    const audit = await admin.get("/api/admin/audit-log").expect(200);
    expect(JSON.stringify(audit.body)).toContain("main_event.servers");
  });
});
