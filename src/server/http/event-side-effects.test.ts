import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSRF_HEADER } from "../auth/csrf";

vi.mock("../realtime/event-bus", async () => {
  const actual = await vi.importActual<typeof import("../realtime/event-bus")>("../realtime/event-bus");
  return {
    ...actual,
    broadcastEventsChanged: vi.fn(actual.broadcastEventsChanged)
  };
});

vi.mock("../push/push-service", async () => {
  const actual = await vi.importActual<typeof import("../push/push-service")>("../push/push-service");
  return {
    ...actual,
    sendPushToOperators: vi.fn(actual.sendPushToOperators),
    sendPushToEnabledUsers: vi.fn(actual.sendPushToEnabledUsers)
  };
});

import { createHermesApp } from "../app";
import { bootstrapAdmin } from "../db/bootstrap-admin";
import { broadcastEventsChanged } from "../realtime/event-bus";
import { sendPushToEnabledUsers, sendPushToOperators } from "../push/push-service";

type StartedApp = Awaited<ReturnType<typeof createHermesApp>>;

let started: StartedApp | undefined;
let databasePath: string;

async function login(agent: ReturnType<typeof request.agent>, username: string) {
  await agent.post("/api/auth/request-code").send({ username }).expect(202);
  const response = await agent
    .post("/api/auth/verify-code")
    .send({ username, code: "123456", deviceName: "test" })
    .expect(200);

  return response.body.user as { id: string; role: string; username: string };
}

async function fetchCsrf(agent: ReturnType<typeof request.agent>) {
  const response = await agent.get("/api/auth/csrf").expect(200);
  return response.body.token as string;
}

describe("event side effects (EVT-02) and lifecycle regression (EVT-03)", () => {
  beforeEach(
    async () => {
      vi.clearAllMocks();
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

  async function createManagerAndLogin() {
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

    const managerAgent = request.agent(started!.app);
    const manager = await login(managerAgent, "manager");

    return { adminAgent, managerAgent, manager };
  }

  async function createUserAsAdmin(
    adminAgent: ReturnType<typeof request.agent>,
    csrfToken: string,
    input: { username: string; email: string; role?: "user" | "manager" | "admin" }
  ) {
    await adminAgent
      .post("/api/admin/users")
      .send({ username: input.username, email: input.email, role: input.role ?? "user" })
      .set(CSRF_HEADER, csrfToken)
      .expect(201);
  }

  it("emits backend-authored notification payloads for create, ready, cancel, and archive flows", async () => {
    const { managerAgent, manager } = await createManagerAndLogin();
    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const created = await managerAgent
      .post("/api/events")
      .send({
        gameTitle: "Payload Proof",
        startMode: "scheduled",
        startsAt,
        minPlayers: 2,
        maxPlayers: 4
      })
      .expect(201);

    const eventId = created.body.event.id as string;

    expect(sendPushToEnabledUsers).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        title: "Neue Runde",
        body: `${manager.username}: Payload Proof`,
        url: "/#events",
        vibrate: [220, 80, 220],
        requireInteraction: true
      })
    );

    const adminAgent = request.agent(started!.app);
    await login(adminAgent, "hauptadmin");
    const csrfToken = await fetchCsrf(adminAgent);
    await createUserAsAdmin(adminAgent, csrfToken, {
      username: "spieler-ready",
      email: "spieler-ready@example.test"
    });
    await createUserAsAdmin(adminAgent, csrfToken, {
      username: "spieler-ready-2",
      email: "spieler-ready-2@example.test"
    });

    const readyUserAgent = request.agent(started!.app);
    await login(readyUserAgent, "spieler-ready");
    const readyUserTwoAgent = request.agent(started!.app);
    await login(readyUserTwoAgent, "spieler-ready-2");

    await readyUserAgent
      .post(`/api/events/${eventId}/participation`)
      .send({ status: "joined" })
      .expect(200);
    await readyUserTwoAgent
      .post(`/api/events/${eventId}/participation`)
      .send({ status: "joined" })
      .expect(200);

    expect(sendPushToEnabledUsers).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        title: "Runde aktualisiert",
        body: "Payload Proof ist startbereit.",
        url: "/#events",
        vibrate: [180, 80, 180]
      })
    );

    await managerAgent.post(`/api/events/${eventId}/cancel`).expect(200);

    expect(sendPushToEnabledUsers).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      expect.objectContaining({
        title: "Runde storniert",
        body: "Payload Proof wurde storniert.",
        url: "/#events",
        vibrate: [260, 90, 120]
      })
    );

    const createdArchive = await managerAgent
      .post("/api/events")
      .send({
        gameTitle: "Archive Proof",
        startMode: "scheduled",
        startsAt,
        minPlayers: 1,
        maxPlayers: 4
      })
      .expect(201);

    const archiveId = createdArchive.body.event.id as string;
    await managerAgent.post(`/api/events/${archiveId}/archive`).expect(200);

    expect(sendPushToEnabledUsers).toHaveBeenNthCalledWith(
      5,
      expect.anything(),
      expect.objectContaining({
        title: "Runde archiviert",
        body: "Archive Proof wurde archiviert.",
        url: "/#events",
        vibrate: [120]
      })
    );
  });

  it("audits + operator-pushes capacity rejections without forcing extra SSE broadcast (EVT-02)", async () => {
    const adminAgent = request.agent(started!.app);
    const admin = await login(adminAgent, "hauptadmin");
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
    const manager = await login(managerAgent, "manager");

    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const created = await managerAgent
      .post("/api/events")
      .send({
        gameTitle: "EVT-02 Side Effects",
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

    expect(sendPushToOperators).toHaveBeenCalledTimes(1);
    expect(sendPushToOperators).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: "Runde voll",
        body: "EVT-02 Side Effects: Beitritt abgelehnt (Spieler 2 von 1).",
        url: "/#events",
        vibrate: [180, 80, 180]
      })
    );

    const participationBroadcasts = (broadcastEventsChanged as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      ([reason]) => reason === "participation_updated"
    );
    expect(participationBroadcasts).toHaveLength(1);

    await adminAgent
      .get("/api/admin/audit-log?limit=50")
      .expect(200)
      .expect((response) => {
        const entry = (
          response.body.auditLogs as Array<{ action: string; entityId?: string | null; metadata: unknown }>
        ).find(
          (candidate) =>
            candidate.action === "participation.set" &&
            candidate.entityId === eventId &&
            typeof candidate.metadata === "object" &&
            !!candidate.metadata &&
            (candidate.metadata as Record<string, unknown>).outcome === "rejected" &&
            (candidate.metadata as Record<string, unknown>).reason === "event_voll"
        );

        expect(entry).toBeTruthy();
      });
  });

  it("keeps manual cancel/archive and auto-archive behavior working (EVT-03)", async () => {
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

    const managerAgent = request.agent(started!.app);
    await login(managerAgent, "manager");

    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const createdCancelable = await managerAgent
      .post("/api/events")
      .send({
        gameTitle: "EVT-03 Cancel Works",
        startMode: "scheduled",
        startsAt,
        minPlayers: 1,
        maxPlayers: 4
      })
      .expect(201);

    const cancelId = createdCancelable.body.event.id as string;
    await managerAgent.post(`/api/events/${cancelId}/cancel`).expect(200);

    await managerAgent
      .get("/api/events")
      .expect(200)
      .expect((response) => {
        const event = (response.body.events as Array<{ id: string; status: string }>).find(
          (entry) => entry.id === cancelId
        );
        expect(event?.status).toBe("cancelled");
      });

    const pastStartsAt = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString();
    const createdAutoArchive = await managerAgent
      .post("/api/events")
      .send({
        gameTitle: "EVT-03 Auto Archive",
        startMode: "scheduled",
        startsAt: pastStartsAt,
        minPlayers: 1,
        maxPlayers: 4
      })
      .expect(201);

    const archiveId = createdAutoArchive.body.event.id as string;
    await managerAgent
      .get("/api/events")
      .expect(200)
      .expect((response) => {
        const event = (response.body.events as Array<{ id: string; status: string }>).find(
          (entry) => entry.id === archiveId
        );
        expect(event?.status).toBe("archived");
      });
  });
});

