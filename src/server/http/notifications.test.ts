import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSRF_HEADER } from "../auth/csrf";
import { createMatchdeskApp } from "../app";
import { bootstrapAdmin } from "../db/bootstrap-admin";
import { createDb } from "../db/client";
import * as mainEventRoutes from "./main-event-routes";
import {
  notifyUsers,
  registerNotificationChannel,
  unregisterNotificationChannel,
  unsubscribeTokenFor
} from "../notifications/dispatcher";
import { runEventReminders } from "../notifications/reminders";

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
  return response.body.user as { id: string };
}

async function send(agent: Agent, method: "post" | "patch" | "put" | "delete", url: string, body?: unknown) {
  const token = (await agent.get("/api/auth/csrf").expect(200)).body.token as string;
  const pending = agent[method](url).set(CSRF_HEADER, token);
  return body === undefined ? pending : pending.send(body as object);
}

describe("Benachrichtigungs-Verteiler", () => {
  beforeEach(async () => {
    databasePath = path.join(os.tmpdir(), `matchdesk-notify-${randomUUID()}.sqlite`);
    process.env.MATCHDESK_DB_PATH = databasePath;
    process.env.MATCHDESK_ADMIN_PHONE = "+491701234567";
    process.env.MATCHDESK_ADMIN_USERNAME = "hauptadmin";
    process.env.MATCHDESK_ADMIN_EMAIL = "hauptadmin@example.test";
    process.env.MATCHDESK_MAIL_MODE = "console";
    process.env.MATCHDESK_DEV_LOGIN_CODE = "123456";
    delete process.env.MATCHDESK_STORAGE_BACKEND;
    delete process.env.MATCHDESK_VAPID_PUBLIC_KEY;
    delete process.env.MATCHDESK_VAPID_PRIVATE_KEY;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await bootstrapAdmin();
    started = await createMatchdeskApp();
  }, 30_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    unregisterNotificationChannel("testkanal");
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
      username: "gast",
      email: "gast@example.test",
      role: "user"
    });
    const guestId = created.body.user.id as string;
    const guest = request.agent(started!.app);
    await login(guest, "gast");
    const eventId = (
      await send(admin, "post", "/api/main-events", {
        name: "LAN Winter",
        plannedStartAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      })
    ).body.mainEvent.id as string;
    return { admin, guest, guestId, eventId };
  }

  it("zeigt die Kanalwahl und speichert sie", async () => {
    const { guest } = await setup();
    const initial = (await guest.get("/api/notifications/channels").expect(200)).body;
    expect(initial.channels.map((entry: { id: string }) => entry.id)).toEqual(["mail", "push"]);
    expect(initial.channels[0]).toMatchObject({ enabled: true, available: true });
    expect(initial.channels[1]).toMatchObject({ enabled: true, available: false });

    const updated = await send(guest, "put", "/api/notifications/channels/mail", { enabled: false });
    expect(updated.status).toBe(200);
    expect(updated.body.channels[0].enabled).toBe(false);
    expect((await send(guest, "put", "/api/notifications/channels/gibtsnicht", { enabled: true })).status).toBe(404);
  });

  it("Rundnachricht geht an die gewählte Gruppe, Abmeldelink stoppt sie", async () => {
    const { admin, guest, guestId, eventId } = await setup();
    expect((await send(guest, "post", `/api/main-events/${eventId}/participation`, { status: "joined" })).status).toBe(200);

    expect((await send(guest, "post", `/api/main-events/${eventId}/broadcasts`, { subject: "x", body: "y", audience: ["joined"] })).status).toBe(403);
    expect((await send(admin, "post", `/api/main-events/${eventId}/broadcasts`, { subject: "x", body: "y", audience: ["declined"] })).body.error).toBe(
      "rundnachricht_ohne_empfaenger"
    );

    const sent = await send(admin, "post", `/api/main-events/${eventId}/broadcasts`, {
      subject: "Aufbau",
      body: "Wir bauen ab 14 Uhr auf.",
      audience: ["joined"]
    });
    expect(sent.status).toBe(202);
    expect(sent.body.broadcast.recipientCount).toBe(1);
    await mainEventRoutes.lastBroadcastDelivery;
    const history = (await admin.get(`/api/main-events/${eventId}/broadcasts`).expect(200)).body.broadcasts;
    expect(history[0]).toMatchObject({ subject: "Aufbau", delivered: true, channels: { mail: { sent: 1, failed: 0 } }, skipped: 0 });

    // Abmelden über den Link (GET zeigt nur die Bestätigung).
    const context = createDb(databasePath);
    const token = unsubscribeTokenFor(context, guestId);
    context.sqlite.close();
    const page = await request(started!.app).get(`/api/notifications/unsubscribe/${token}`).expect(200);
    expect(page.text).toContain("<form");
    await request(started!.app).post(`/api/notifications/unsubscribe/${token}`).expect(200);
    await request(started!.app).post("/api/notifications/unsubscribe/falsch").expect(404);
    expect((await guest.get("/api/notifications/channels")).body.unsubscribed).toBe(true);

    await send(admin, "post", `/api/main-events/${eventId}/broadcasts`, { subject: "Zwei", body: "Noch was.", audience: ["joined"] });
    await mainEventRoutes.lastBroadcastDelivery;
    const second = (await admin.get(`/api/main-events/${eventId}/broadcasts`).expect(200)).body.broadcasts[0];
    expect(second).toMatchObject({ subject: "Zwei", channels: {}, skipped: 1 });

    // Wer einen Kanal wieder einschaltet, ist wieder angemeldet.
    await send(guest, "put", "/api/notifications/channels/mail", { enabled: true });
    expect((await guest.get("/api/notifications/channels")).body.unsubscribed).toBe(false);
  });

  it("Modulkanäle sind Opt-in und werden nach Wahl benutzt", async () => {
    const { guest, guestId } = await setup();
    const sendSpy = vi.fn(async () => undefined);
    registerNotificationChannel({
      id: "testkanal",
      label: { de: "Testkanal", en: "Test channel" },
      moduleId: "test",
      defaultEnabled: false,
      isAvailable: () => true,
      send: sendSpy
    });
    expect(() =>
      registerNotificationChannel({ id: "mail", label: { de: "x", en: "x" }, moduleId: "x", defaultEnabled: false, isAvailable: () => true, send: sendSpy })
    ).toThrow();

    const context = createDb(databasePath);
    const message = { mainEventId: "e", eventName: "LAN", subject: "Hallo", body: "Text", path: "#main-events" };
    await notifyUsers(context, [guestId], message);
    expect(sendSpy).not.toHaveBeenCalled();

    await send(guest, "put", "/api/notifications/channels/testkanal", { enabled: true });
    const deliveries = await notifyUsers(context, [guestId], message);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(deliveries.map((entry) => entry.channelId).sort()).toEqual(["mail", "testkanal"]);
    context.sqlite.close();
  });

  it("Erinnerungen gehen einmal raus und nach Terminänderung erneut", async () => {
    const { admin, guest, eventId } = await setup();
    await send(guest, "post", `/api/main-events/${eventId}/participation`, { status: "joined" });
    const context = createDb(databasePath);
    // Start in 10 Tagen: in 4 Tagen ist die Wochen-Erinnerung fällig.
    const inFourDays = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    expect(await runEventReminders(context, new Date())).toEqual([]);
    const first = await runEventReminders(context, inFourDays);
    expect(first).toEqual([{ mainEventId: eventId, kind: "start_7d", recipients: 1 }]);
    expect(await runEventReminders(context, inFourDays)).toEqual([]);

    // Neuer Termin: Erinnerung darf wieder raus; abgeschaltete Erinnerungen nicht.
    await send(admin, "patch", `/api/main-events/${eventId}`, {
      plannedStartAt: new Date(Date.now() + 11 * 24 * 60 * 60 * 1000).toISOString(),
      remindersEnabled: false
    });
    expect(await runEventReminders(context, new Date(Date.now() + 5 * 24 * 60 * 60 * 1000))).toEqual([]);
    await send(admin, "patch", `/api/main-events/${eventId}`, { remindersEnabled: true });
    expect((await runEventReminders(context, new Date(Date.now() + 5 * 24 * 60 * 60 * 1000))).map((entry) => entry.kind)).toEqual(["start_7d"]);
    context.sqlite.close();
  });

  it("liefert Kalendereintrag und persönlichen Kalender-Link", async () => {
    const { guest, eventId } = await setup();
    const ics = await guest.get(`/api/main-events/${eventId}/calendar.ics`).expect(200);
    expect(ics.headers["content-type"]).toContain("text/calendar");
    expect(ics.text).toContain("SUMMARY:LAN Winter");
    expect(ics.text).toContain(`UID:${eventId}@`);

    const feedPath = (await guest.get("/api/notifications/calendar-feed").expect(200)).body.path as string;
    const empty = await request(started!.app).get(feedPath).expect(200);
    expect(empty.text).not.toContain("BEGIN:VEVENT");
    await send(guest, "post", `/api/main-events/${eventId}/participation`, { status: "interested" });
    expect((await request(started!.app).get(feedPath).expect(200)).text).toContain("SUMMARY:LAN Winter");

    const renewed = (await send(guest, "post", "/api/notifications/calendar-feed/renew")).body.path as string;
    expect(renewed).not.toBe(feedPath);
    await request(started!.app).get(feedPath).expect(404);
  });
});
