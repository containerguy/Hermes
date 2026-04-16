import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
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

describe("event capacity (EVT-01)", () => {
  beforeEach(
    async () => {
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
    },
    30_000
  );

  afterEach(async () => {
    await started?.close();
    started = undefined;

    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  });

  it("allows only one concurrent join for an event with maxPlayers=1", async () => {
    const adminAgent = request.agent(started!.app);
    await login(adminAgent, "hauptadmin");
    const adminCsrf = await fetchCsrf(adminAgent);

    const managerCreate = await adminAgent
      .post("/api/admin/users")
      .send({ username: "manager", email: "manager@example.test", role: "manager" })
      .set(CSRF_HEADER, adminCsrf)
      .expect(201);

    const managerId = managerCreate.body.user.id as string;
    await adminAgent
      .patch(`/api/admin/users/${managerId}`)
      .send({ role: "manager" })
      .set(CSRF_HEADER, adminCsrf)
      .expect(200);

    await adminAgent
      .post("/api/admin/users")
      .send({ username: "spieler1", email: "spieler1@example.test", role: "user" })
      .set(CSRF_HEADER, adminCsrf)
      .expect(201);

    await adminAgent
      .post("/api/admin/users")
      .send({ username: "spieler2", email: "spieler2@example.test", role: "user" })
      .set(CSRF_HEADER, adminCsrf)
      .expect(201);

    const managerAgent = request.agent(started!.app);
    await login(managerAgent, "manager");

    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const created = await managerAgent
      .post("/api/events")
      .send({
        gameTitle: "Duo Game Concurrency",
        startMode: "scheduled",
        startsAt,
        minPlayers: 1,
        maxPlayers: 1
      })
      .expect(201);

    const eventId = created.body.event.id as string;

    const userOneAgent = request.agent(started!.app);
    await login(userOneAgent, "spieler1");

    const userTwoAgent = request.agent(started!.app);
    await login(userTwoAgent, "spieler2");

    const req1 = userOneAgent.post(`/api/events/${eventId}/participation`).send({ status: "joined" });
    const req2 = userTwoAgent.post(`/api/events/${eventId}/participation`).send({ status: "joined" });
    const [res1, res2] = await Promise.all([req1, req2]);

    const statuses = [res1.status, res2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const loser = res1.status === 409 ? res1 : res2;
    expect(loser.body.error).toBe("event_voll");

    const list = await userOneAgent.get("/api/events").expect(200);
    const event = (list.body.events as Array<{ id: string; joinedCount: number }>).find(
      (entry) => entry.id === eventId
    );
    expect(event).toBeTruthy();
    expect(event?.joinedCount).toBe(1);
  });
});

