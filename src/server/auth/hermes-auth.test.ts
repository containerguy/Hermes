import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CSRF_HEADER } from "./csrf";
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

describe("hermes-auth", () => {
  beforeEach(
    async () => {
      databasePath = path.join(os.tmpdir(), `hermes-auth-test-${randomUUID()}.sqlite`);
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

  it("returns 401 nicht_angemeldet for /api/auth/me without any auth", async () => {
    await request(started!.app)
      .get("/api/auth/me")
      .expect(401)
      .expect((res) => {
        expect(res.body.error).toBe("nicht_angemeldet");
      });
  });

  it("populates session auth from a valid cookie", async () => {
    const agent = request.agent(started!.app);
    const user = await login(agent, "hauptadmin");

    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body.user.id).toBe(user.id);
    expect(me.body.user.username).toBe("hauptadmin");
  });

  it("accepts a valid Bearer full token for read endpoints", async () => {
    const agent = request.agent(started!.app);
    await login(agent, "hauptadmin");
    const csrf = await fetchCsrf(agent);

    const created = await agent
      .post("/api/auth/api-tokens")
      .set(CSRF_HEADER, csrf)
      .send({ scope: "full", label: "hermes-auth-test" })
      .expect(201);

    const fullToken = created.body.token as string;

    await request(started!.app)
      .get("/api/events")
      .set("Authorization", `Bearer ${fullToken}`)
      .expect(200);
  });

  it("rejects a revoked Bearer token", async () => {
    const agent = request.agent(started!.app);
    await login(agent, "hauptadmin");
    const csrf = await fetchCsrf(agent);

    const created = await agent
      .post("/api/auth/api-tokens")
      .set(CSRF_HEADER, csrf)
      .send({ scope: "full", label: "to-be-revoked" })
      .expect(201);

    const token = created.body.token as string;
    const tokenId = created.body.apiToken.id as string;

    await agent
      .delete(`/api/auth/api-tokens/${tokenId}`)
      .set(CSRF_HEADER, csrf)
      .expect(204);

    await request(started!.app)
      .get("/api/events")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });

  it("Bearer takes precedence over cookie (invalid Bearer + valid cookie → 401)", async () => {
    const agent = request.agent(started!.app);
    await login(agent, "hauptadmin");

    // Sanity: agent.cookie alone works on /api/events
    await agent.get("/api/events").expect(200);

    // Now send a known-bad Bearer alongside the cookie: Bearer wins, cookie is ignored.
    await agent
      .get("/api/events")
      .set("Authorization", "Bearer hm_at_invalid_token_value_for_test")
      .expect(401);
  });

  it("read_only token blocks state-changing requests with api_token_nur_lesen", async () => {
    const agent = request.agent(started!.app);
    await login(agent, "hauptadmin");
    const csrf = await fetchCsrf(agent);

    const created = await agent
      .post("/api/auth/api-tokens")
      .set(CSRF_HEADER, csrf)
      .send({ scope: "read_only", label: "ro" })
      .expect(201);

    const roToken = created.body.token as string;

    await request(started!.app)
      .post("/api/admin/users")
      .set("Authorization", `Bearer ${roToken}`)
      .send({ username: "blocked", email: "blocked@example.test", role: "user" })
      .expect(403)
      .expect((res) => {
        expect(res.body.error).toBe("api_token_nur_lesen");
      });
  });
});
