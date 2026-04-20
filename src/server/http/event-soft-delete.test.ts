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

describe("event soft delete (EVT-04)", () => {
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

  it("enforces admin-only soft delete and hides deleted events from listings + audit log", async () => {
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

    const managerAgent = request.agent(started!.app);
    await login(managerAgent, "manager");

    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const created = await managerAgent
      .post("/api/events")
      .send({
        gameTitle: "EVT-04 Deletable",
        startMode: "scheduled",
        startsAt,
        minPlayers: 1,
        maxPlayers: 4,
        details: "secret.example\npassword=supersecret"
      })
      .expect(201);

    const eventId = created.body.event.id as string;

    await adminAgent
      .delete(`/api/admin/events/${eventId}`)
      .set(CSRF_HEADER, adminCsrf)
      .expect(409)
      .expect((response) => {
        expect(response.body.error).toBe("event_nicht_loeschbar");
      });

    await managerAgent.post(`/api/events/${eventId}/cancel`).expect(200);

    const userAgent = request.agent(started!.app);
    await login(userAgent, "spieler1");

    await userAgent
      .delete(`/api/admin/events/${eventId}`)
      .set(CSRF_HEADER, await fetchCsrf(userAgent))
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe("admin_erforderlich");
      });

    await adminAgent.delete(`/api/admin/events/${eventId}`).set(CSRF_HEADER, adminCsrf).expect(204);

    for (const agent of [adminAgent, managerAgent, userAgent]) {
      await agent
        .get("/api/events")
        .expect(200)
        .expect((response) => {
          const ids = (response.body.events as Array<{ id: string }>).map((event) => event.id);
          expect(ids).not.toContain(eventId);
        });
    }

    await managerAgent.post(`/api/events/${eventId}/archive`).expect(404);
    await userAgent.post(`/api/events/${eventId}/participation`).send({ status: "joined" }).expect(404);

    await adminAgent
      .get("/api/admin/audit-log?limit=50")
      .expect(200)
      .expect((response) => {
        const entry = (response.body.auditLogs as Array<{ action: string; entityId?: string | null; metadata: unknown }>).find(
          (candidate) => candidate.action === "event.soft_delete" && candidate.entityId === eventId
        );
        expect(entry).toBeTruthy();

        const metadata = entry?.metadata as Record<string, unknown> | null | undefined;
        expect(metadata?.gameTitle).toBe("EVT-04 Deletable");
        expect(metadata?.status).toBe("cancelled");
        expect(typeof metadata?.deletedAt).toBe("string");

        const metadataString = JSON.stringify(metadata ?? {});
        expect(metadataString.includes("secret.example")).toBe(false);
        expect(metadataString.toLowerCase().includes("password")).toBe(false);
      });
  });
});

