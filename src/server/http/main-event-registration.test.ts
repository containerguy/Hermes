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
    sendPushToMainEventParticipants: vi.fn(actual.sendPushToMainEventParticipants),
    sendPushToUserIds: vi.fn(actual.sendPushToUserIds)
  };
});

import { createMatchdeskApp } from "../app";
import { bootstrapAdmin } from "../db/bootstrap-admin";
import { createDb } from "../db/client";
import { mainEventPushTargets, sendPushToUserIds } from "../push/push-service";

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


describe("event registration: capacity, waitlist, deadline, overview", () => {
  beforeEach(
    async () => {
      vi.clearAllMocks();
      databasePath = path.join(os.tmpdir(), `hermes-test-${randomUUID()}.sqlite`);
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

  function pushTargets(mainEventId: string) {
    const inspect = createDb(databasePath);
    try {
      return mainEventPushTargets(inspect, mainEventId);
    } finally {
      inspect.sqlite.close();
    }
  }

  async function createEventWith(agent: ReturnType<typeof request.agent>, body: Record<string, unknown>) {
    const csrf = await fetchCsrf(agent);
    const response = await agent.post("/api/main-events").set(CSRF_HEADER, csrf).send(body).expect(201);
    return response.body.mainEvent as { id: string; maxParticipants: number | null; registrationDeadline: string | null };
  }

  async function participate(agent: ReturnType<typeof request.agent>, id: string, status: string) {
    const csrf = await fetchCsrf(agent);
    return agent.post(`/api/main-events/${id}/participation`).set(CSRF_HEADER, csrf).send({ status });
  }

  async function patchEvent(agent: ReturnType<typeof request.agent>, id: string, body: Record<string, unknown>) {
    const csrf = await fetchCsrf(agent);
    return agent.patch(`/api/main-events/${id}`).set(CSRF_HEADER, csrf).send(body);
  }

  it("puts joins beyond capacity on the waitlist and promotes the first one when a seat frees up", async () => {
    const { adminAgent, managerAgent } = await createManagerAndLogin();
    const anna = await createUser(adminAgent, "anna");
    const bert = await createUser(adminAgent, "bert");
    const carl = await createUser(adminAgent, "carl");
    const dora = await createUser(adminAgent, "dora");
    const event = await createEventWith(managerAgent, { name: "LAN Winter", maxParticipants: 2 });
    expect(event.maxParticipants).toBe(2);

    expect((await participate(anna, event.id, "joined")).body.mainEvent.myParticipation).toBe("joined");
    expect((await participate(bert, event.id, "joined")).body.mainEvent.myParticipation).toBe("joined");
    const carlResult = (await participate(carl, event.id, "joined")).body.mainEvent;
    expect(carlResult).toMatchObject({
      myParticipation: "waitlisted",
      myWaitlistPosition: 1,
      participantCount: 2,
      waitlistCount: 1
    });
    expect((await participate(dora, event.id, "joined")).body.mainEvent.myWaitlistPosition).toBe(2);

    // Erneutes Zusagen ändert die Reihenfolge der Nachrücker nicht.
    expect((await participate(carl, event.id, "joined")).body.mainEvent.myWaitlistPosition).toBe(1);
    // Nachrücker bekommen keine Rundenbenachrichtigungen.
    expect(pushTargets(event.id)).toHaveLength(2);

    vi.mocked(sendPushToUserIds).mockClear();
    expect((await participate(anna, event.id, "declined")).status).toBe(200);

    const carlView = (await carl.get("/api/main-events").expect(200)).body.mainEvents[0];
    expect(carlView).toMatchObject({ myParticipation: "joined", myWaitlistPosition: null, participantCount: 2 });
    const doraView = (await dora.get("/api/main-events").expect(200)).body.mainEvents[0];
    expect(doraView).toMatchObject({ myParticipation: "waitlisted", myWaitlistPosition: 1 });
    expect(sendPushToUserIds).toHaveBeenCalledWith(
      expect.anything(),
      [expect.any(String)],
      expect.objectContaining({ title: "Nachgerückt" })
    );

    // Mehr Plätze: der nächste Nachrücker rückt auf.
    const patched = await patchEvent(managerAgent, event.id, { maxParticipants: 5 });
    expect(patched.status).toBe(200);
    expect(patched.body.mainEvent).toMatchObject({ participantCount: 3, waitlistCount: 0, maxParticipants: 5 });

    // Weniger Plätze nehmen niemandem die Zusage weg.
    const shrunk = await patchEvent(managerAgent, event.id, { maxParticipants: 1 });
    expect(shrunk.body.mainEvent).toMatchObject({ participantCount: 3, maxParticipants: 1 });
    expect((await participate(anna, event.id, "joined")).body.mainEvent.myParticipation).toBe("waitlisted");

    const audit = (await adminAgent.get("/api/admin/audit-log").expect(200)).body.auditLogs.map(
      (entry: { action: string }) => entry.action
    );
    expect(audit).toContain("main_event.waitlist_promoted");
  });

  it("keeps the waitlist order when a seat frees up without a decline and keeps waitlisted people when going private", async () => {
    const { adminAgent, managerAgent } = await createManagerAndLogin();
    const anna = await createUser(adminAgent, "anna");
    const bert = await createUser(adminAgent, "bert");
    const carl = await createUser(adminAgent, "carl");
    const event = await createEventWith(managerAgent, { name: "LAN Fair", maxParticipants: 1 });
    expect((await participate(anna, event.id, "joined")).body.mainEvent.myParticipation).toBe("joined");
    expect((await participate(bert, event.id, "joined")).body.mainEvent.myParticipation).toBe("waitlisted");

    // Anna wird gelöscht: Ihr Platz zählt nicht mehr. Carl stellt sich trotzdem hinten an, Bert rückt nach.
    const annaId = (await anna.get("/api/auth/me").expect(200)).body.user.id;
    const csrf = await fetchCsrf(adminAgent);
    await adminAgent.delete(`/api/admin/users/${annaId}`).set(CSRF_HEADER, csrf).expect(204);
    expect((await participate(carl, event.id, "joined")).body.mainEvent).toMatchObject({
      myParticipation: "waitlisted",
      myWaitlistPosition: 1,
      participantCount: 1
    });
    expect((await bert.get("/api/main-events").expect(200)).body.mainEvents[0].myParticipation).toBe("joined");

    // Beim Wechsel auf privat behalten auch Nachrücker den Zugang.
    expect((await patchEvent(managerAgent, event.id, { visibility: "private" })).status).toBe(200);
    expect((await carl.get("/api/main-events").expect(200)).body.mainEvents).toEqual([
      expect.objectContaining({ id: event.id, myParticipation: "waitlisted" })
    ]);
  });

  it("counts interested people separately and enforces the registration deadline only before the start", async () => {
    const { adminAgent, managerAgent } = await createManagerAndLogin();
    const anna = await createUser(adminAgent, "anna");
    const bert = await createUser(adminAgent, "bert");
    const event = await createEventWith(managerAgent, {
      name: "LAN Frühling",
      registrationDeadline: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });

    const interested = (await participate(anna, event.id, "interested")).body.mainEvent;
    expect(interested).toMatchObject({
      myParticipation: "interested",
      interestedCount: 1,
      participantCount: 0,
      registrationClosed: false
    });
    // Interessenten bekommen keine Rundenbenachrichtigungen.
    expect(pushTargets(event.id)).toHaveLength(0);

    const closedPatch = await patchEvent(managerAgent, event.id, {
      registrationDeadline: new Date(Date.now() - 60 * 1000).toISOString()
    });
    expect(closedPatch.status).toBe(200);

    const closed = await participate(bert, event.id, "joined");
    expect(closed.status).toBe(409);
    expect(closed.body.error).toBe("anmeldeschluss_vorbei");
    expect((await participate(bert, event.id, "interested")).status).toBe(409);
    // Bestehende Anmeldungen bleiben, absagen geht immer.
    expect((await participate(anna, event.id, "interested")).status).toBe(200);
    expect((await participate(anna, event.id, "joined")).status).toBe(409);
    expect((await participate(anna, event.id, "declined")).body.mainEvent).toMatchObject({
      myParticipation: "declined",
      registrationClosed: true
    });

    // Läuft das Event, kann man trotz Anmeldeschluss noch dazukommen.
    const csrf = await fetchCsrf(managerAgent);
    await managerAgent.post(`/api/main-events/${event.id}/start`).set(CSRF_HEADER, csrf).expect(200);
    expect((await participate(bert, event.id, "joined")).body.mainEvent).toMatchObject({
      myParticipation: "joined",
      registrationClosed: false
    });
  });

  it("rejects invalid capacity and lets nobody pick the waitlist directly", async () => {
    const { adminAgent, managerAgent } = await createManagerAndLogin();
    const anna = await createUser(adminAgent, "anna");
    const csrf = await fetchCsrf(managerAgent);
    await managerAgent.post("/api/main-events").set(CSRF_HEADER, csrf).send({ name: "X", maxParticipants: 0 }).expect(400);
    const event = await createEventWith(managerAgent, { name: "Y" });
    expect((await participate(anna, event.id, "waitlisted")).status).toBe(400);
  });

  it("shows managers who registered, who is waiting and who has not answered, also as CSV", async () => {
    const { adminAgent, managerAgent } = await createManagerAndLogin();
    const anna = await createUser(adminAgent, "anna");
    const bert = await createUser(adminAgent, "bert");
    await createUser(adminAgent, "carl");
    const adminCsrf = await fetchCsrf(adminAgent);
    // Ein Anzeigename, der in Excel als Formel laufen würde, wird entschärft.
    const evil = await adminAgent
      .post("/api/admin/users")
      .send({ username: "evil", email: "evil@example.test", role: "user" })
      .set(CSRF_HEADER, adminCsrf)
      .expect(201);
    await adminAgent
      .patch(`/api/admin/users/${evil.body.user.id}`)
      .send({ displayName: "=HYPERLINK(1)" })
      .set(CSRF_HEADER, adminCsrf);
    const evilAgent = request.agent(started!.app);
    await login(evilAgent, "evil");

    const event = await createEventWith(managerAgent, { name: "LAN Sommer", maxParticipants: 1 });
    expect((await participate(anna, event.id, "joined")).status).toBe(200);
    expect((await participate(bert, event.id, "joined")).status).toBe(200);
    expect((await participate(evilAgent, event.id, "interested")).status).toBe(200);

    await anna.get(`/api/main-events/${event.id}/participants`).expect(403);
    await anna.get(`/api/main-events/${event.id}/participants.csv`).expect(403);

    const overview = (await managerAgent.get(`/api/main-events/${event.id}/participants`).expect(200)).body;
    expect(overview.participants.map((row: { username: string; status: string; waitlistPosition: number | null }) => [
      row.username,
      row.status,
      row.waitlistPosition
    ])).toEqual([
      ["anna", "joined", null],
      ["bert", "waitlisted", 1],
      ["evil", "interested", null]
    ]);
    expect(overview.noResponse.map((row: { username: string }) => row.username)).toEqual(
      expect.arrayContaining(["carl", "hauptadmin", "manager"])
    );
    expect(overview.noResponse.map((row: { username: string }) => row.username)).not.toContain("anna");

    const csv = await managerAgent.get(`/api/main-events/${event.id}/participants.csv`).expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain("anmeldungen-LAN_Sommer.csv");
    const lines = csv.text.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0]).toBe('"Benutzername";"Anzeigename";"Status";"Nachrücker-Platz";"Geändert"');
    expect(lines[1]).toMatch(/^"anna";"anna";"joined";"";"/);
    expect(lines[2]).toMatch(/^"bert";"bert";"waitlisted";"1";"/);
    expect(lines[3]).toMatch(/^"evil";"'=HYPERLINK\(1\)";"interested"/);
    expect(lines.some((line) => line.startsWith('"carl";"carl";"no_response"'))).toBe(true);
  });

  async function enableRegistration(adminAgent: ReturnType<typeof request.agent>) {
    const csrf = await fetchCsrf(adminAgent);
    await adminAgent
      .put("/api/admin/settings")
      .send({
        appName: "Hermes Test",
        defaultNotificationsEnabled: true,
        eventAutoArchiveHours: 8,
        publicRegistrationEnabled: true,
        themePrimaryColor: "#0f766e",
        themeLoginColor: "#be123c",
        themeManagerColor: "#b7791f",
        themeAdminColor: "#2563eb",
        themeSurfaceColor: "#f6f8f4"
      })
      .set(CSRF_HEADER, csrf)
      .expect(200);
  }

  async function createInvite(adminAgent: ReturnType<typeof request.agent>, body: Record<string, unknown>) {
    const csrf = await fetchCsrf(adminAgent);
    return adminAgent.post("/api/admin/invite-codes").send(body).set(CSRF_HEADER, csrf);
  }

  it("registers new people through an event invite code, marks the event on the user and signs them up as interested", async () => {
    const { adminAgent, managerAgent } = await createManagerAndLogin();
    await enableRegistration(adminAgent);
    const event = await createEventWith(managerAgent, { name: "LAN Winter", visibility: "private" });

    const invite = await createInvite(adminAgent, { label: "Winter-Gäste", mainEventId: event.id });
    expect(invite.status).toBe(201);
    expect(invite.body.inviteCode).toMatchObject({ mainEventId: event.id, mainEventName: "LAN Winter" });

    await request(started!.app)
      .post("/api/auth/register")
      .send({ inviteCode: invite.body.inviteCode.code, username: "neuling", email: "neuling@example.test" })
      .expect(201);

    const adminUsers = (await adminAgent.get("/api/admin/users").expect(200)).body.users as Array<
      Record<string, unknown>
    >;
    expect(adminUsers.find((user) => user.username === "neuling")).toMatchObject({
      registeredViaMainEventId: event.id,
      registeredViaMainEventName: "LAN Winter",
      registeredViaInviteCodeId: invite.body.inviteCode.id
    });
    // Andere Benutzer haben keinen Event-Vermerk.
    expect(adminUsers.find((user) => user.username === "manager")).toMatchObject({ registeredViaMainEventId: null });

    // Der Neue sieht das private Event und steht als interessiert drin.
    const neuling = request.agent(started!.app);
    await login(neuling, "neuling");
    const seen = (await neuling.get("/api/main-events").expect(200)).body.mainEvents;
    expect(seen).toEqual([expect.objectContaining({ id: event.id, myParticipation: "interested", interestedCount: 1 })]);

    // Der Vermerk bleibt lesbar, auch wenn das geplante Event gelöscht wird.
    const csrf = await fetchCsrf(managerAgent);
    await managerAgent.delete(`/api/main-events/${event.id}`).set(CSRF_HEADER, csrf).expect(204);
    const after = (await adminAgent.get("/api/admin/users").expect(200)).body.users as Array<Record<string, unknown>>;
    expect(after.find((user) => user.username === "neuling")).toMatchObject({
      registeredViaMainEventId: null,
      registeredViaMainEventName: "LAN Winter"
    });
  });

  it("does not sign up people after the deadline and rejects codes for ended or unknown events", async () => {
    const { adminAgent, managerAgent } = await createManagerAndLogin();
    await enableRegistration(adminAgent);
    const event = await createEventWith(managerAgent, {
      name: "LAN Spät",
      registrationDeadline: new Date(Date.now() - 60 * 1000).toISOString()
    });
    const invite = await createInvite(adminAgent, { label: "Spät", mainEventId: event.id });
    await request(started!.app)
      .post("/api/auth/register")
      .send({ inviteCode: invite.body.inviteCode.code, username: "spaet", email: "spaet@example.test" })
      .expect(201);
    const spaet = request.agent(started!.app);
    await login(spaet, "spaet");
    expect((await spaet.get("/api/main-events").expect(200)).body.mainEvents[0].myParticipation).toBeNull();

    expect((await createInvite(adminAgent, { label: "X", mainEventId: "gibt-es-nicht" })).status).toBe(400);
    const csrf = await fetchCsrf(managerAgent);
    await managerAgent.post(`/api/main-events/${event.id}/start`).set(CSRF_HEADER, csrf).expect(200);
    await managerAgent.post(`/api/main-events/${event.id}/end`).set(CSRF_HEADER, csrf).expect(200);
    const ended = await createInvite(adminAgent, { label: "Y", mainEventId: event.id });
    expect(ended.status).toBe(400);
    expect(ended.body.error).toBe("invite_event_ungueltig");
  });
});
