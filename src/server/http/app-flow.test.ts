import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("app flow", () => {
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
  });

  afterEach(async () => {
    await started?.close();
    started = undefined;

    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  });

  it("logs in, manages roles, creates events and enforces participation capacity", async () => {
    const adminAgent = request.agent(started!.app);
    await login(adminAgent, "hauptadmin");

    const manager = await adminAgent
      .post("/api/admin/users")
      .send({
        username: "manager",
        email: "manager@example.test",
        role: "manager"
      })
      .expect(201);

    expect(manager.body.user.phoneNumber).toMatch(/^user:/);

    await adminAgent
      .post("/api/admin/users")
      .send({
        username: "spieler1",
        email: "spieler1@example.test",
        role: "user"
      })
      .expect(201);

    await adminAgent
      .post("/api/admin/users")
      .send({
        username: "spieler2",
        email: "spieler2@example.test",
        role: "user"
      })
      .expect(201);

    await adminAgent
      .patch(`/api/admin/users/${manager.body.user.id}`)
      .send({ role: "manager" })
      .expect(200);

    await adminAgent
      .put("/api/admin/settings")
      .send({
        appName: "Hermes Test",
        defaultNotificationsEnabled: true,
        eventAutoArchiveHours: 8,
        themePrimaryColor: "#0f766e",
        themeLoginColor: "#be123c",
        themeManagerColor: "#b7791f",
        themeAdminColor: "#2563eb",
        themeSurfaceColor: "#f6f8f4"
      })
      .expect(200);

    await request(started!.app)
      .get("/api/settings")
      .expect(200)
      .expect((response) => {
        expect(response.body.settings.appName).toBe("Hermes Test");
        expect(response.body.settings.themeAdminColor).toBe("#2563eb");
      });

    await adminAgent.post("/api/admin/backup").expect(200);

    const managerAgent = request.agent(started!.app);
    await login(managerAgent, "manager");

    const userOneAgent = request.agent(started!.app);
    await login(userOneAgent, "spieler1");

    const userTwoAgent = request.agent(started!.app);
    await login(userTwoAgent, "spieler2");

    await userOneAgent
      .post("/api/events")
      .send({ gameTitle: "Blocked", startMode: "now", minPlayers: 1, maxPlayers: 2 })
      .expect(403);

    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const event = await managerAgent
      .post("/api/events")
      .send({
        gameTitle: "Duo Game",
        startMode: "scheduled",
        startsAt,
        minPlayers: 1,
        maxPlayers: 1
      })
      .expect(201);

    const eventId = event.body.event.id as string;

    await userOneAgent
      .post(`/api/events/${eventId}/participation`)
      .send({ status: "joined" })
      .expect(200)
      .expect((response) => {
        expect(response.body.event.status).toBe("ready");
        expect(response.body.event.joinedCount).toBe(1);
      });

    await userTwoAgent
      .post(`/api/events/${eventId}/participation`)
      .send({ status: "joined" })
      .expect(409);

    await userOneAgent
      .post(`/api/events/${eventId}/participation`)
      .send({ status: "declined" })
      .expect(200);

    await userTwoAgent
      .post(`/api/events/${eventId}/participation`)
      .send({ status: "joined" })
      .expect(200);
  });
});
