import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CSRF_HEADER } from "../auth/csrf";
import { bootstrapAdmin } from "../db/bootstrap-admin";
import { createHermesApp } from "../app";

type StartedApp = Awaited<ReturnType<typeof createHermesApp>>;
type Agent = ReturnType<typeof request.agent>;

let started: StartedApp | undefined;
let databasePath: string;

async function login(agent: Agent, username: string) {
  await agent.post("/api/auth/request-code").send({ username }).expect(202);
  await agent
    .post("/api/auth/verify-code")
    .send({ username, code: "123456", deviceName: "test" })
    .expect(200);
}

async function fetchCsrf(agent: Agent) {
  const response = await agent.get("/api/auth/csrf").expect(200);
  return response.body.token as string;
}

async function createUser(admin: Agent, username: string, role: "user" | "manager" | "admin") {
  const csrf = await fetchCsrf(admin);
  await admin
    .post("/api/admin/users")
    .set(CSRF_HEADER, csrf)
    .send({ username, email: `${username}@example.test`, role })
    .expect(201);
}

async function revokeOthers(agent: Agent, status: number) {
  const csrf = await fetchCsrf(agent);
  return agent.post("/api/admin/sessions/revoke-others").set(CSRF_HEADER, csrf).expect(status);
}

describe("admin: sign out all other users", () => {
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

  it("revokes every session except the acting admin's own ones", async () => {
    const admin = request.agent(started!.app);
    const adminOtherDevice = request.agent(started!.app);
    await login(admin, "hauptadmin");
    await login(adminOtherDevice, "hauptadmin");

    await createUser(admin, "spieler", "user");
    await createUser(admin, "orga", "manager");
    await createUser(admin, "zweitadmin", "admin");

    const spieler = request.agent(started!.app);
    const spielerPhone = request.agent(started!.app);
    const orga = request.agent(started!.app);
    const zweitadmin = request.agent(started!.app);
    await login(spieler, "spieler");
    await login(spielerPhone, "spieler");
    await login(orga, "orga");
    await login(zweitadmin, "zweitadmin");

    const response = await revokeOthers(admin, 200);
    expect(response.body).toEqual({ revokedSessions: 4, affectedUsers: 3 });

    await admin.get("/api/auth/me").expect(200);
    await adminOtherDevice.get("/api/auth/me").expect(200);
    for (const agent of [spieler, spielerPhone, orga, zweitadmin]) {
      await agent.get("/api/auth/me").expect(401);
    }

    // Signed-out users can log in again.
    await login(spieler, "spieler");
    await spieler.get("/api/auth/me").expect(200);

    const sqlite = new Database(databasePath);
    const audit = sqlite
      .prepare("SELECT actor_username, metadata FROM audit_logs WHERE action = ?")
      .get("auth.sessions_revoke_others") as { actor_username: string; metadata: string };
    sqlite.close();
    expect(audit.actor_username).toBe("hauptadmin");
    expect(JSON.parse(audit.metadata)).toEqual({ revokedSessions: 4, affectedUsers: 3 });
  });

  it("is admin-only", async () => {
    const admin = request.agent(started!.app);
    await login(admin, "hauptadmin");
    await createUser(admin, "orga", "manager");
    await createUser(admin, "spieler", "user");

    const orga = request.agent(started!.app);
    const spieler = request.agent(started!.app);
    await login(orga, "orga");
    await login(spieler, "spieler");

    await revokeOthers(orga, 403);
    await revokeOthers(spieler, 403);
    await request(started!.app).post("/api/admin/sessions/revoke-others").expect(401);

    await admin.get("/api/auth/me").expect(200);
    await orga.get("/api/auth/me").expect(200);
    await spieler.get("/api/auth/me").expect(200);
  });
});
