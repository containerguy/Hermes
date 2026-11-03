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

describe("Spielt gerade (presence)", () => {
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

  async function enablePresence(agent: ReturnType<typeof request.agent>, csrf: string, enabled: boolean) {
    const current = await agent.get("/api/admin/settings").expect(200);
    await agent
      .put("/api/admin/settings")
      .set(CSRF_HEADER, csrf)
      .send({ ...current.body.settings, featuresGamePresenceEnabled: enabled })
      .expect(200);
  }

  it("is hidden while the feature is off", async () => {
    const admin = request.agent(started!.app);
    await login(admin, "hauptadmin");
    await admin.get("/api/presence").expect(404);
    const settings = await request(started!.app).get("/api/settings/public").expect(200);
    expect(settings.body.settings.featuresGamePresenceEnabled).toBe(false);
  });

  it("accepts agent reports with a full API token and lists them for logged-in users", async () => {
    const admin = request.agent(started!.app);
    await login(admin, "hauptadmin");
    const csrf = await fetchCsrf(admin);
    await enablePresence(admin, csrf, true);

    const full = await admin
      .post("/api/auth/api-tokens")
      .set(CSRF_HEADER, csrf)
      .send({ scope: "full", label: "game-agent" })
      .expect(201);
    const token = full.body.token as string;

    await request(started!.app).get("/api/presence").expect(401);
    await request(started!.app).post("/api/presence/game").send({ playing: [] }).expect(401);

    await request(started!.app)
      .post("/api/presence/game")
      .set("Authorization", `Bearer ${token}`)
      .send({
        host: "DESKTOP-M4PJL0I",
        playing: [{ title: "Counter-Strike 2", launcher: "steam", appId: "730", exe: "", source: "steam-registry" }]
      })
      .expect(204);

    const list = await admin.get("/api/presence").expect(200);
    expect(list.body.players).toHaveLength(1);
    expect(list.body.players[0]).toMatchObject({
      username: "hauptadmin",
      games: [{ title: "Counter-Strike 2", launcher: "steam", appId: "730" }]
    });
    expect(JSON.stringify(list.body)).not.toContain("DESKTOP");

    await request(started!.app)
      .post("/api/presence/game")
      .set("Authorization", `Bearer ${token}`)
      .send({ playing: "kaputt" })
      .expect(400);

    await request(started!.app).delete("/api/presence/game").set("Authorization", `Bearer ${token}`).expect(204);
    const after = await admin.get("/api/presence").expect(200);
    expect(after.body.players).toEqual([]);
  });

  it("rejects read-only tokens and session writes without CSRF", async () => {
    const admin = request.agent(started!.app);
    await login(admin, "hauptadmin");
    const csrf = await fetchCsrf(admin);
    await enablePresence(admin, csrf, true);

    const ro = await admin
      .post("/api/auth/api-tokens")
      .set(CSRF_HEADER, csrf)
      .send({ scope: "read_only" })
      .expect(201);

    await request(started!.app)
      .post("/api/presence/game")
      .set("Authorization", `Bearer ${ro.body.token}`)
      .send({ playing: [{ title: "Valheim", launcher: "steam" }] })
      .expect(403);
    await request(started!.app)
      .get("/api/presence")
      .set("Authorization", `Bearer ${ro.body.token}`)
      .expect(200);

    await admin.post("/api/presence/game").send({ playing: [] }).expect(403);
    await admin.post("/api/presence/game").set(CSRF_HEADER, csrf).send({ playing: [] }).expect(204);
  });
});
