import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CSRF_HEADER } from "../auth/csrf";
import { createMatchdeskApp } from "../app";
import { bootstrapAdmin } from "../db/bootstrap-admin";

type StartedApp = Awaited<ReturnType<typeof createMatchdeskApp>>;
type Agent = ReturnType<typeof request.agent>;

let started: StartedApp | undefined;
let databasePath: string;

async function login(agent: Agent, username: string) {
  await agent.post("/api/auth/request-code").send({ username }).expect(202);
  const response = await agent
    .post("/api/auth/verify-code")
    .send({ username, code: "123456", deviceName: "test" })
    .expect(200);
  return response.body.user as { id: string; permissions: { isAdmin: boolean; global: string[]; events: Record<string, string[]> } };
}

async function csrf(agent: Agent) {
  return (await agent.get("/api/auth/csrf").expect(200)).body.token as string;
}

async function send(agent: Agent, method: "post" | "patch" | "delete", url: string, body?: unknown) {
  const token = await csrf(agent);
  const pending = agent[method](url).set(CSRF_HEADER, token);
  return body === undefined ? pending : pending.send(body as object);
}

function round(title: string, mainEventId?: string | null) {
  return {
    gameTitle: title,
    startMode: "scheduled",
    startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    minPlayers: 2,
    maxPlayers: 4,
    ...(mainEventId !== undefined ? { mainEventId } : {})
  };
}

describe("Rechte und Rollen über die Admin-Schnittstelle", () => {
  beforeEach(async () => {
    databasePath = path.join(os.tmpdir(), `matchdesk-rbac-http-${randomUUID()}.sqlite`);
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

  async function setup() {
    const admin = request.agent(started!.app);
    await login(admin, "hauptadmin");
    const created = await send(admin, "post", "/api/admin/users", {
      username: "helfer",
      email: "helfer@example.test",
      role: "user"
    });
    expect(created.status).toBe(201);
    const helperId = created.body.user.id as string;
    const helper = request.agent(started!.app);
    await login(helper, "helfer");
    const eventA = (await send(admin, "post", "/api/main-events", { name: "LAN A" })).body.mainEvent.id as string;
    const eventB = (await send(admin, "post", "/api/main-events", { name: "LAN B" })).body.mainEvent.id as string;
    return { admin, helper, helperId, eventA, eventB };
  }

  it("liefert den Katalog mit Kernrechten und mitgelieferten Rollen", async () => {
    const { admin, helper } = await setup();
    const catalog = (await admin.get("/api/admin/rbac").expect(200)).body;
    expect(catalog.permissions.map((entry: { key: string }) => entry.key)).toContain("rounds.create");
    expect(catalog.roles.map((entry: { key: string }) => entry.key)).toEqual(
      expect.arrayContaining(["user", "organizer", "manager", "admin"])
    );
    await helper.get("/api/admin/rbac").expect(403);
  });

  it("Event-Vergabe erlaubt Runden nur in diesem Event und erlischt mit dem Ende", async () => {
    const { admin, helper, helperId, eventA, eventB } = await setup();

    expect((await send(helper, "post", "/api/events", round("Quake", eventA))).status).toBe(403);

    const granted = await send(admin, "post", `/api/admin/users/${helperId}/grants`, {
      roleKey: "organizer",
      mainEventId: eventA
    });
    expect(granted.status).toBe(201);
    expect(granted.body.grants).toHaveLength(1);
    expect(granted.body.grants[0]).toMatchObject({ roleKey: "organizer", mainEventId: eventA, mainEventName: "LAN A" });

    const me = (await helper.get("/api/auth/me").expect(200)).body.user;
    expect(me.permissions.global).not.toContain("rounds.create");
    expect(me.permissions.events[eventA]).toContain("rounds.create");

    expect((await send(helper, "post", "/api/events", round("Quake", eventA))).status).toBe(201);
    expect((await send(helper, "post", "/api/events", round("Quake", eventB))).status).toBe(403);
    expect((await send(helper, "post", "/api/events", round("Quake", null))).status).toBe(403);

    expect((await send(admin, "post", `/api/main-events/${eventA}/start`)).status).toBe(200);
    const ended = await send(admin, "post", `/api/main-events/${eventA}/end`);
    expect(ended.status).toBe(200);

    const after = (await helper.get("/api/auth/me").expect(200)).body.user;
    expect(after.permissions.events[eventA]).toBeUndefined();
    const users = (await admin.get("/api/admin/users").expect(200)).body.users as Array<{ id: string; grants: unknown[]; role: string }>;
    const helperRow = users.find((entry) => entry.id === helperId)!;
    expect(helperRow.grants).toEqual([]);
    // Zurückgestuft auf die Grundrolle, Konto bleibt.
    expect(helperRow.role).toBe("user");
  });

  it("globale Vergabe bleibt und lässt sich zurücknehmen", async () => {
    const { admin, helper, helperId, eventA } = await setup();
    const granted = await send(admin, "post", `/api/admin/users/${helperId}/grants`, { permissionKey: "main_events.manage" });
    expect(granted.status).toBe(201);
    expect((await send(helper, "patch", `/api/main-events/${eventA}`, { description: "Halle 2" })).status).toBe(200);

    const duplicate = await send(admin, "post", `/api/admin/users/${helperId}/grants`, { permissionKey: "main_events.manage" });
    expect(duplicate.status).toBe(409);

    const grantId = granted.body.grants[0].id as string;
    const revoked = await send(admin, "delete", `/api/admin/users/${helperId}/grants/${grantId}`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.grants).toEqual([]);
    expect((await send(helper, "patch", `/api/main-events/${eventA}`, { description: "Halle 3" })).status).toBe(403);
  });

  it("Event-Manager verwaltet nur sein Event und legt keine neuen an", async () => {
    const { admin, helper, helperId, eventA, eventB } = await setup();
    await send(admin, "post", `/api/admin/users/${helperId}/grants`, { roleKey: "manager", mainEventId: eventA });

    expect((await send(helper, "patch", `/api/main-events/${eventA}`, { description: "ok" })).status).toBe(200);
    expect((await send(helper, "patch", `/api/main-events/${eventB}`, { description: "nein" })).status).toBe(403);
    expect((await send(helper, "post", "/api/main-events", { name: "Eigenes" })).status).toBe(403);
    expect((await helper.get(`/api/main-events/${eventA}/participants`)).status).toBe(200);
    expect((await helper.get(`/api/main-events/${eventB}/participants`)).status).toBe(403);
  });

  it("lehnt unsinnige Vergaben ab", async () => {
    const { admin, helperId, eventA } = await setup();
    expect((await send(admin, "post", `/api/admin/users/${helperId}/grants`, { roleKey: "admin", mainEventId: eventA })).body.error).toBe("admin_nur_global");
    expect((await send(admin, "post", `/api/admin/users/${helperId}/grants`, { permissionKey: "pizza.manage", mainEventId: eventA })).body.error).toBe("recht_nicht_pro_event");
    expect((await send(admin, "post", `/api/admin/users/${helperId}/grants`, { permissionKey: "gibt.esnicht" })).body.error).toBe("recht_unbekannt");
    expect((await send(admin, "post", `/api/admin/users/${helperId}/grants`, {})).status).toBe(400);
  });

  it("eigene Rolle anlegen, Rechte anklicken, vergeben und löschen", async () => {
    const { admin, helper, helperId } = await setup();
    const created = await send(admin, "post", "/api/admin/roles", {
      key: "pizzadienst",
      label: "Pizzadienst",
      permissions: ["pizza.manage"]
    });
    expect(created.status).toBe(201);
    const role = created.body.roles.find((entry: { key: string }) => entry.key === "pizzadienst");
    expect(role.permissions).toEqual(["pizza.manage"]);

    await send(admin, "post", `/api/admin/users/${helperId}/grants`, { roleKey: "pizzadienst" });
    expect((await helper.get("/api/auth/me")).body.user.permissions.global).toContain("pizza.manage");

    expect((await send(admin, "patch", `/api/admin/roles/${role.id}`, { permissions: ["admin.access"] })).body.error).toBe(
      "admin_recht_nur_admin_rolle"
    );
    expect((await send(admin, "patch", "/api/admin/roles/role-admin", { permissions: [] })).body.error).toBe("admin_rolle_fest");
    expect((await send(admin, "delete", "/api/admin/roles/role-manager")).body.error).toBe("rolle_mitgeliefert");

    expect((await send(admin, "delete", `/api/admin/roles/${role.id}`)).status).toBe(204);
    expect((await helper.get("/api/auth/me")).body.user.permissions.global).not.toContain("pizza.manage");
  });
});
