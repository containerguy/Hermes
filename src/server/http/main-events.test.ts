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
    sendPushToEnabledUsers: vi.fn(actual.sendPushToEnabledUsers),
    sendPushToMainEventParticipants: vi.fn(actual.sendPushToMainEventParticipants)
  };
});

import { createHermesApp } from "../app";
import { bootstrapAdmin } from "../db/bootstrap-admin";
import { createDb } from "../db/client";
import { broadcastEventsChanged } from "../realtime/event-bus";
import {
  mainEventPushTargets,
  sendPushToEnabledUsers,
  sendPushToMainEventParticipants
} from "../push/push-service";

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


describe("events with start and end (main events)", () => {
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

  async function createUser(adminAgent: ReturnType<typeof request.agent>, username: string) {
    const csrf = await fetchCsrf(adminAgent);
    await adminAgent
      .post("/api/admin/users")
      .send({ username, email: `${username}@example.test`, role: "user" })
      .set(CSRF_HEADER, csrf)
      .expect(201);
    const agent = request.agent(started!.app);
    await login(agent, username);
    return agent;
  }

  async function createMainEvent(agent: ReturnType<typeof request.agent>, name: string) {
    const csrf = await fetchCsrf(agent);
    const response = await agent
      .post("/api/main-events")
      .set(CSRF_HEADER, csrf)
      .send({ name, description: "Halle 3", plannedStartAt: "2026-11-06T16:00:00.000Z" })
      .expect(201);
    return response.body.mainEvent as { id: string; status: string; name: string };
  }

  async function action(agent: ReturnType<typeof request.agent>, id: string, verb: "start" | "end") {
    const csrf = await fetchCsrf(agent);
    return agent.post(`/api/main-events/${id}/${verb}`).set(CSRF_HEADER, csrf);
  }

  function round(title: string, extra: Record<string, unknown> = {}) {
    return {
      gameTitle: title,
      startMode: "scheduled",
      startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      minPlayers: 2,
      maxPlayers: 4,
      ...extra
    };
  }

  it("lets managers create, start and end an event; plain users may only read", async () => {
    const { adminAgent, managerAgent } = await createManagerAndLogin();
    const userAgent = await createUser(adminAgent, "spieler");

    const userCsrf = await fetchCsrf(userAgent);
    await userAgent
      .post("/api/main-events")
      .set(CSRF_HEADER, userCsrf)
      .send({ name: "Heimlich" })
      .expect(403);

    // ohne CSRF-Token kein Schreibzugriff
    await managerAgent.post("/api/main-events").send({ name: "Ohne Token" }).expect(403);

    const created = await createMainEvent(managerAgent, "LAN Herbst");
    expect(created.status).toBe("planned");

    const started = await action(managerAgent, created.id, "start");
    expect(started.status).toBe(200);
    expect(started.body.mainEvent.status).toBe("running");
    expect(started.body.mainEvent.startedAt).toEqual(expect.any(String));
    expect(sendPushToEnabledUsers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: "Event gestartet", body: "LAN Herbst läuft jetzt. Bist du dabei?" })
    );

    // starten nur einmal
    expect((await action(managerAgent, created.id, "start")).status).toBe(409);

    const list = await userAgent.get("/api/main-events").expect(200);
    expect(list.body.mainEvents).toEqual([
      expect.objectContaining({ id: created.id, name: "LAN Herbst", status: "running", description: "Halle 3" })
    ]);

    const ended = await action(managerAgent, created.id, "end");
    expect(ended.status).toBe(200);
    expect(ended.body.mainEvent.status).toBe("ended");
    expect((await action(managerAgent, created.id, "end")).status).toBe(409);
    expect((await action(managerAgent, created.id, "start")).status).toBe(409);

    const auditActions = (await adminAgent.get("/api/admin/audit-log").expect(200)).body.auditLogs.map(
      (entry: { action: string }) => entry.action
    );
    expect(auditActions).toEqual(expect.arrayContaining(["main_event.create", "main_event.start", "main_event.end"]));
  });

  it("allows only one running event at a time", async () => {
    const { managerAgent } = await createManagerAndLogin();
    const first = await createMainEvent(managerAgent, "Tag 1");
    const second = await createMainEvent(managerAgent, "Tag 2");

    expect((await action(managerAgent, first.id, "start")).status).toBe(200);
    const blocked = await action(managerAgent, second.id, "start");
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ error: "anderes_hauptevent_laeuft", runningMainEventId: first.id });

    expect((await action(managerAgent, first.id, "end")).status).toBe(200);
    expect((await action(managerAgent, second.id, "start")).status).toBe(200);
  });

  it("links new rounds to the running event and labels their notifications", async () => {
    const { managerAgent } = await createManagerAndLogin();

    const withoutEvent = await managerAgent.post("/api/events").send(round("Vorher")).expect(201);
    expect(withoutEvent.body.event.mainEventId).toBeNull();

    const lan = await createMainEvent(managerAgent, "LAN Herbst");
    await action(managerAgent, lan.id, "start");
    vi.mocked(sendPushToEnabledUsers).mockClear();

    const linked = await managerAgent.post("/api/events").send(round("Quake")).expect(201);
    expect(linked.body.event).toMatchObject({ mainEventId: lan.id, mainEventName: "LAN Herbst" });
    expect(sendPushToMainEventParticipants).toHaveBeenCalledWith(
      expect.anything(),
      lan.id,
      expect.objectContaining({ title: "Neue Runde · LAN Herbst" })
    );
    expect(sendPushToEnabledUsers).not.toHaveBeenCalled();

    // explizit ohne Event
    const loose = await managerAgent.post("/api/events").send(round("Solo", { mainEventId: null })).expect(201);
    expect(loose.body.event.mainEventId).toBeNull();

    const onlyLan = await managerAgent.get(`/api/events?mainEventId=${lan.id}`).expect(200);
    expect(onlyLan.body.events.map((event: { gameTitle: string }) => event.gameTitle)).toEqual(["Quake"]);
    const onlyLoose = await managerAgent.get("/api/events?mainEventId=none").expect(200);
    expect(onlyLoose.body.events.map((event: { gameTitle: string }) => event.gameTitle).sort()).toEqual([
      "Solo",
      "Vorher"
    ]);

    const missing = await managerAgent.post("/api/events").send(round("X", { mainEventId: "gibt-es-nicht" }));
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("hauptevent_nicht_gefunden");
  });

  it("archives the event's open rounds when it ends and refuses new rounds for it", async () => {
    const { managerAgent } = await createManagerAndLogin();
    const lan = await createMainEvent(managerAgent, "LAN Herbst");
    await action(managerAgent, lan.id, "start");

    const linked = await managerAgent.post("/api/events").send(round("Quake")).expect(201);
    const loose = await managerAgent.post("/api/events").send(round("Solo", { mainEventId: null })).expect(201);

    const ended = await action(managerAgent, lan.id, "end");
    expect(ended.body.archivedRounds).toBe(1);

    const events = (await managerAgent.get("/api/events").expect(200)).body.events as Array<{
      id: string;
      status: string;
    }>;
    expect(events.find((event) => event.id === linked.body.event.id)?.status).toBe("archived");
    expect(events.find((event) => event.id === loose.body.event.id)?.status).not.toBe("archived");

    const refused = await managerAgent.post("/api/events").send(round("Zu spät", { mainEventId: lan.id }));
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("hauptevent_beendet");

    // ohne laufendes Event landen neue Runden wieder ohne Zuordnung
    const after = await managerAgent.post("/api/events").send(round("Danach")).expect(201);
    expect(after.body.event.mainEventId).toBeNull();
  });

  it("deletes only planned events and keeps their rounds", async () => {
    const { managerAgent } = await createManagerAndLogin();
    const planned = await createMainEvent(managerAgent, "Vielleicht");
    const roundResponse = await managerAgent
      .post("/api/events")
      .send(round("Vorplanung", { mainEventId: planned.id }))
      .expect(201);
    expect(roundResponse.body.event.mainEventId).toBe(planned.id);

    let csrf = await fetchCsrf(managerAgent);
    await managerAgent.delete(`/api/main-events/${planned.id}`).set(CSRF_HEADER, csrf).expect(204);
    const events = (await managerAgent.get("/api/events").expect(200)).body.events as Array<{
      id: string;
      mainEventId: string | null;
    }>;
    expect(events.find((event) => event.id === roundResponse.body.event.id)?.mainEventId).toBeNull();

    const running = await createMainEvent(managerAgent, "Jetzt");
    await action(managerAgent, running.id, "start");
    csrf = await fetchCsrf(managerAgent);
    await managerAgent.delete(`/api/main-events/${running.id}`).set(CSRF_HEADER, csrf).expect(409);
  });

  it("edits planned data until the event has ended", async () => {
    const { managerAgent } = await createManagerAndLogin();
    const lan = await createMainEvent(managerAgent, "LAN");
    let csrf = await fetchCsrf(managerAgent);
    const patched = await managerAgent
      .patch(`/api/main-events/${lan.id}`)
      .set(CSRF_HEADER, csrf)
      .send({ name: "LAN Herbst", plannedEndAt: "2026-11-08T12:00:00.000Z" })
      .expect(200);
    expect(patched.body.mainEvent).toMatchObject({ name: "LAN Herbst", plannedEndAt: "2026-11-08T12:00:00.000Z" });

    await managerAgent
      .patch(`/api/main-events/${lan.id}`)
      .set(CSRF_HEADER, csrf)
      .send({ plannedEndAt: "2026-11-01T12:00:00.000Z" })
      .expect(400);

    await action(managerAgent, lan.id, "start");
    await action(managerAgent, lan.id, "end");
    csrf = await fetchCsrf(managerAgent);
    await managerAgent.patch(`/api/main-events/${lan.id}`).set(CSRF_HEADER, csrf).send({ name: "Neu" }).expect(409);
  });

  it("lets every user join or decline an event and notifies only participants about its rounds", async () => {
    const { adminAgent, managerAgent } = await createManagerAndLogin();
    const fanAgent = await createUser(adminAgent, "fan");
    const restAgent = await createUser(adminAgent, "rest");
    await createUser(adminAgent, "stumm");

    const lan = await createMainEvent(managerAgent, "LAN Herbst");
    await action(managerAgent, lan.id, "start");

    let csrf = await fetchCsrf(fanAgent);
    const joined = await fanAgent
      .post(`/api/main-events/${lan.id}/participation`)
      .set(CSRF_HEADER, csrf)
      .send({ status: "joined" })
      .expect(200);
    expect(joined.body.mainEvent).toMatchObject({ myParticipation: "joined", participantCount: 1 });

    csrf = await fetchCsrf(restAgent);
    await restAgent
      .post(`/api/main-events/${lan.id}/participation`)
      .set(CSRF_HEADER, csrf)
      .send({ status: "declined" })
      .expect(200);
    await restAgent.post(`/api/main-events/${lan.id}/participation`).send({ status: "joined" }).expect(403);

    const list = (await restAgent.get("/api/main-events").expect(200)).body.mainEvents;
    expect(list[0]).toMatchObject({ myParticipation: "declined", participantCount: 1 });

    const inspect = createDb(databasePath);
    const targets = mainEventPushTargets(inspect, lan.id);
    inspect.sqlite.close();
    const fanId = (await fanAgent.get("/api/auth/me").expect(200)).body.user.id;
    expect(targets).toEqual([fanId]);

    // „dabei" bei einer Runde gilt als Teilnahme am Event, wenn noch nichts entschieden ist
    const quake = await managerAgent.post("/api/events").send(round("Quake")).expect(201);
    const stummAgent = request.agent(started!.app);
    await login(stummAgent, "stumm");
    await stummAgent.post(`/api/events/${quake.body.event.id}/participation`).send({ status: "joined" }).expect(200);
    await restAgent.post(`/api/events/${quake.body.event.id}/participation`).send({ status: "joined" }).expect(200);
    const after = (await managerAgent.get("/api/main-events").expect(200)).body.mainEvents[0];
    expect(after.participantCount).toBe(2);

    await action(managerAgent, lan.id, "end");
    csrf = await fetchCsrf(fanAgent);
    await fanAgent
      .post(`/api/main-events/${lan.id}/participation`)
      .set(CSRF_HEADER, csrf)
      .send({ status: "declined" })
      .expect(409);
  });
});
