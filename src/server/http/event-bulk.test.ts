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

import { createMatchdeskApp } from "../app";
import { bootstrapAdmin } from "../db/bootstrap-admin";
import { broadcastEventsChanged } from "../realtime/event-bus";

type StartedApp = Awaited<ReturnType<typeof createMatchdeskApp>>;

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

async function createRound(agent: ReturnType<typeof request.agent>, gameTitle: string) {
  const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const created = await agent
    .post("/api/events")
    .send({ gameTitle, startMode: "scheduled", startsAt, minPlayers: 1, maxPlayers: 4 })
    .expect(201);
  return created.body.event.id as string;
}

describe("POST /api/events/bulk – Mehrfachauswahl (HCI-110)", () => {
  beforeEach(
    async () => {
      vi.clearAllMocks();
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
    return { adminAgent, adminCsrf, managerAgent, manager };
  }

  it("archiviert mehrere Runden mit einer Anfrage, ein Audit-Eintrag je Runde, ein Broadcast", async () => {
    const { adminAgent, managerAgent } = await createManagerAndLogin();
    const a = await createRound(managerAgent, "Runde A");
    const b = await createRound(managerAgent, "Runde B");

    (broadcastEventsChanged as unknown as { mockClear: () => void }).mockClear();

    const result = await managerAgent
      .post("/api/events/bulk")
      .send({ action: "archive", ids: [a, b] })
      .expect(200);

    expect(result.body.updated.sort()).toEqual([a, b].sort());
    expect(result.body.skipped).toEqual([]);

    // Genau ein Board-Broadcast für die ganze Aktion.
    const archiveBroadcasts = (
      broadcastEventsChanged as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.filter(([reason]) => reason === "event_archived");
    expect(archiveBroadcasts).toHaveLength(1);

    // Beide Runden sind archiviert.
    await managerAgent
      .get("/api/events")
      .expect(200)
      .expect((response) => {
        const events = response.body.events as Array<{ id: string; status: string }>;
        expect(events.find((entry) => entry.id === a)?.status).toBe("archived");
        expect(events.find((entry) => entry.id === b)?.status).toBe("archived");
      });

    // Je Runde ein eigener Audit-Eintrag.
    await adminAgent
      .get("/api/admin/audit-log?limit=50")
      .expect(200)
      .expect((response) => {
        const archiveEntries = (
          response.body.auditLogs as Array<{ action: string; entityId?: string | null }>
        ).filter((entry) => entry.action === "event.archive");
        expect(archiveEntries.map((entry) => entry.entityId).sort()).toEqual([a, b].sort());
      });
  });

  it("sagt mehrere Runden ab und überspringt bereits beendete Runden", async () => {
    const { managerAgent } = await createManagerAndLogin();
    const active = await createRound(managerAgent, "Noch aktiv");
    const alreadyGone = await createRound(managerAgent, "Schon weg");
    await managerAgent.post(`/api/events/${alreadyGone}/cancel`).expect(200);

    const result = await managerAgent
      .post("/api/events/bulk")
      .send({ action: "cancel", ids: [active, alreadyGone] })
      .expect(200);

    expect(result.body.updated).toEqual([active]);
    expect(result.body.skipped).toEqual([{ id: alreadyGone, reason: "bereits_beendet" }]);
  });

  it("überspringt Runden ohne Verwaltungsrecht (kein stiller Erfolg)", async () => {
    const { adminAgent, adminCsrf, managerAgent } = await createManagerAndLogin();
    const round = await createRound(managerAgent, "Fremde Runde");

    await adminAgent
      .post("/api/admin/users")
      .send({ username: "gast", email: "gast@example.test", role: "user" })
      .set(CSRF_HEADER, adminCsrf)
      .expect(201);
    const userAgent = request.agent(started!.app);
    await login(userAgent, "gast");

    const result = await userAgent
      .post("/api/events/bulk")
      .send({ action: "archive", ids: [round] })
      .expect(200);

    expect(result.body.updated).toEqual([]);
    expect(result.body.skipped).toEqual([{ id: round, reason: "verboten" }]);

    // Die Runde bleibt unangetastet aktiv.
    await managerAgent
      .get("/api/events")
      .expect(200)
      .expect((response) => {
        const events = response.body.events as Array<{ id: string; status: string }>;
        expect(events.find((entry) => entry.id === round)?.status).not.toBe("archived");
      });
  });

  it("lehnt eine leere Auswahl mit 400 ab", async () => {
    const { managerAgent } = await createManagerAndLogin();
    const result = await managerAgent.post("/api/events/bulk").send({ action: "archive", ids: [] }).expect(400);
    expect(result.body.error).toBe("ungueltige_auswahl");
  });
});
