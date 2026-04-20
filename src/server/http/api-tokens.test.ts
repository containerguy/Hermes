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

describe("API tokens", () => {
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

  it("allows Bearer full token for GET/POST events; read_only blocks writes", async () => {
    const agent = request.agent(started!.app);
    await login(agent, "hauptadmin");
    const csrf = await fetchCsrf(agent);

    await agent
      .post("/api/admin/users")
      .set(CSRF_HEADER, csrf)
      .send({ username: "mgr", email: "mgr@example.test", role: "manager" })
      .expect(201);

    const mgrAgent = request.agent(started!.app);
    await login(mgrAgent, "mgr");

    const mgrCsrf = await fetchCsrf(mgrAgent);
    const created = await mgrAgent
      .post("/api/auth/api-tokens")
      .set(CSRF_HEADER, mgrCsrf)
      .send({ scope: "full", label: "full-e2e" })
      .expect(201);

    const fullToken = created.body.token as string;
    expect(fullToken.startsWith("hm_at_")).toBe(true);

    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const ev = await request(started!.app)
      .post("/api/events")
      .set("Authorization", `Bearer ${fullToken}`)
      .send({
        gameTitle: "API token game",
        startMode: "scheduled",
        startsAt,
        minPlayers: 2,
        maxPlayers: 8
      })
      .expect(201);

    const eventId = ev.body.event.id as string;

    const list = await request(started!.app)
      .get("/api/events")
      .set("Authorization", `Bearer ${fullToken}`)
      .expect(200);

    expect(list.body.events.some((e: { id: string }) => e.id === eventId)).toBe(true);

    const ro = await mgrAgent
      .post("/api/auth/api-tokens")
      .set(CSRF_HEADER, mgrCsrf)
      .send({ scope: "read_only" })
      .expect(201);

    const roToken = ro.body.token as string;

    await request(started!.app)
      .get("/api/events")
      .set("Authorization", `Bearer ${roToken}`)
      .expect(200);

    await request(started!.app)
      .post("/api/events")
      .set("Authorization", `Bearer ${roToken}`)
      .send({
        gameTitle: "blocked",
        startMode: "now",
        minPlayers: 1,
        maxPlayers: 2
      })
      .expect(403)
      .expect((res) => {
        expect(res.body.error).toBe("api_token_nur_lesen");
      });

    await request(started!.app)
      .patch(`/api/events/${eventId}`)
      .set("Authorization", `Bearer ${roToken}`)
      .send({ gameTitle: "nope" })
      .expect(403)
      .expect((res) => {
        expect(res.body.error).toBe("api_token_nur_lesen");
      });

    await mgrAgent
      .delete(`/api/auth/api-tokens/${created.body.apiToken.id}`)
      .set(CSRF_HEADER, mgrCsrf)
      .expect(204);

    await mgrAgent
      .delete(`/api/auth/api-tokens/${ro.body.apiToken.id}`)
      .set(CSRF_HEADER, mgrCsrf)
      .expect(204);
  });

  it("allows admin Bearer token to list users (GET) and blocks read_only on admin POST", async () => {
    const agent = request.agent(started!.app);
    await login(agent, "hauptadmin");
    const csrf = await fetchCsrf(agent);

    const tok = await agent
      .post("/api/auth/api-tokens")
      .set(CSRF_HEADER, csrf)
      .send({ scope: "read_only", label: "ro-admin" })
      .expect(201);

    const roToken = tok.body.token as string;

    await request(started!.app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${roToken}`)
      .expect(200);

    await request(started!.app)
      .post("/api/admin/users")
      .set("Authorization", `Bearer ${roToken}`)
      .send({ username: "x", email: "x@example.test", role: "user" })
      .expect(403)
      .expect((res) => {
        expect(res.body.error).toBe("api_token_nur_lesen");
      });
  });
});
