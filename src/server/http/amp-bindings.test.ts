import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CSRF_HEADER } from "../auth/csrf";
import { bootstrapAdmin } from "../db/bootstrap-admin";
import { createHermesApp } from "../app";

type StartedApp = Awaited<ReturnType<typeof createHermesApp>>;

let started: StartedApp | undefined;
let databasePath: string;

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

async function enableAmp(admin: ReturnType<typeof request.agent>, csrf: string) {
  const current = await admin.get("/api/admin/settings").expect(200);
  await admin
    .put("/api/admin/settings")
    .set(CSRF_HEADER, csrf)
    .send({
      ...current.body.settings,
      ampIntegrationEnabled: true,
      ampBaseUrl: "https://amp-ctl.example.test"
    })
    .expect(200);
}

const minecraftBinding = {
  displayTitle: "Minecraft",
  ampInstanceId: "11111111-2222-3333-4444-555555555555",
  ampInstanceName: "Minecraft01",
  host: "minecraft.lanparty.example",
  port: 25565,
  connectScheme: "minecraft",
  enabled: true
};

describe("AMP server bindings (Phase 15-01)", () => {
  beforeEach(async () => {
    databasePath = path.join(os.tmpdir(), `hermes-test-${randomUUID()}.sqlite`);
    process.env.HERMES_DB_PATH = databasePath;
    process.env.HERMES_ADMIN_PHONE = "+491701234567";
    process.env.HERMES_ADMIN_USERNAME = "hauptadmin";
    process.env.HERMES_ADMIN_EMAIL = "hauptadmin@example.test";
    process.env.HERMES_MAIL_MODE = "console";
    process.env.HERMES_DEV_LOGIN_CODE = "123456";
    delete process.env.HERMES_STORAGE_BACKEND;
    delete process.env.HERMES_VAPID_PUBLIC_KEY;
    delete process.env.HERMES_VAPID_PRIVATE_KEY;
    await bootstrapAdmin();
    started = await createHermesApp();
  }, 30_000);

  afterEach(async () => {
    await started?.close();
    started = undefined;
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  });

  it("lets admins manage bindings, blocks managers, and auto-links events by title", async () => {
    const admin = request.agent(started!.app);
    await login(admin, "hauptadmin");
    const adminCsrf = await fetchCsrf(admin);
    await enableAmp(admin, adminCsrf);

    await admin
      .post("/api/admin/users")
      .set(CSRF_HEADER, adminCsrf)
      .send({ username: "mgr", email: "mgr@example.test", role: "manager" })
      .expect(201);
    const manager = request.agent(started!.app);
    await login(manager, "mgr");
    const managerCsrf = await fetchCsrf(manager);

    // Manager darf keine Bindungen anlegen
    await manager
      .post("/api/integrations/amp/bindings")
      .set(CSRF_HEADER, managerCsrf)
      .send(minecraftBinding)
      .expect(403);

    // Admin legt an
    const created = await admin
      .post("/api/integrations/amp/bindings")
      .set(CSRF_HEADER, adminCsrf)
      .send(minecraftBinding)
      .expect(201);
    const bindingId = created.body.binding.id as string;
    expect(created.body.binding.gameTitleNorm).toBe("minecraft");

    // Titel-Konflikt (gleicher normalisierter Titel)
    await admin
      .post("/api/integrations/amp/bindings")
      .set(CSRF_HEADER, adminCsrf)
      .send({ ...minecraftBinding, displayTitle: "MINE-craft" })
      .expect(409);

    // Alle Angemeldeten sehen aktive Bindungen
    const listed = await manager.get("/api/integrations/amp/bindings").expect(200);
    expect(listed.body.bindings).toHaveLength(1);
    expect(listed.body.bindings[0]).not.toHaveProperty("password");

    // Event mit passendem Titel wird automatisch verknüpft
    const event = await manager
      .post("/api/events")
      .set(CSRF_HEADER, managerCsrf)
      .send({ gameTitle: "minecraft", startMode: "now", minPlayers: 2, maxPlayers: 10 })
      .expect(201);
    expect(event.body.event.serverBindingId).toBe(bindingId);

    // Explizite Abwahl
    const unlinked = await manager
      .post("/api/events")
      .set(CSRF_HEADER, managerCsrf)
      .send({
        gameTitle: "Minecraft",
        startMode: "now",
        minPlayers: 2,
        maxPlayers: 10,
        serverBindingId: null
      })
      .expect(201);
    expect(unlinked.body.event.serverBindingId).toBeNull();

    // Unbekannte Bindung wird abgelehnt
    await manager
      .post("/api/events")
      .set(CSRF_HEADER, managerCsrf)
      .send({
        gameTitle: "Minecraft",
        startMode: "now",
        minPlayers: 2,
        maxPlayers: 10,
        serverBindingId: "does-not-exist"
      })
      .expect(400);

    // Titeländerung per PATCH ordnet neu zu
    const patched = await manager
      .patch(`/api/events/${unlinked.body.event.id}`)
      .set(CSRF_HEADER, managerCsrf)
      .send({ gameTitle: "Mine Craft" })
      .expect(200);
    expect(patched.body.event.serverBindingId).toBe(bindingId);

    // Deaktivierte Bindung wird nicht mehr zugeordnet
    await admin
      .put(`/api/integrations/amp/bindings/${bindingId}`)
      .set(CSRF_HEADER, adminCsrf)
      .send({ ...minecraftBinding, enabled: false, autoStopEnabled: true })
      .expect(200);
    // Audit hält fest, wer den Leerlauf-Stopp freigeschaltet hat
    const audit = await admin.get("/api/admin/audit-log").expect(200);
    const upserts = (audit.body.auditLogs as Array<{ action: string; metadata: Record<string, unknown> | null }>).filter(
      (entry) => entry.action === "gameserver.binding_upsert"
    );
    expect(upserts.map((entry) => entry.metadata?.autoStopEnabled).sort()).toEqual([false, true]);
    const afterDisable = await manager
      .post("/api/events")
      .set(CSRF_HEADER, managerCsrf)
      .send({ gameTitle: "Minecraft", startMode: "now", minPlayers: 2, maxPlayers: 10 })
      .expect(201);
    expect(afterDisable.body.event.serverBindingId).toBeNull();

    // Löschen setzt die Verknüpfung am Event auf null (ON DELETE SET NULL)
    await admin
      .delete(`/api/integrations/amp/bindings/${bindingId}`)
      .set(CSRF_HEADER, adminCsrf)
      .expect(204);
    const events = await manager.get("/api/events").expect(200);
    const linkedLater = (events.body.events as Array<{ id: string; serverBindingId: string | null }>).find(
      (e) => e.id === event.body.event.id
    );
    expect(linkedLater?.serverBindingId).toBeNull();
  });

  it("returns an empty binding list and 404 on writes while the module is disabled", async () => {
    const admin = request.agent(started!.app);
    await login(admin, "hauptadmin");
    const csrf = await fetchCsrf(admin);

    const listed = await admin.get("/api/integrations/amp/bindings").expect(200);
    expect(listed.body.bindings).toEqual([]);

    await admin
      .post("/api/integrations/amp/bindings")
      .set(CSRF_HEADER, csrf)
      .send(minecraftBinding)
      .expect(404);
  });
});
