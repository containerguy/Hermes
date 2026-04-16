import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("app flow", () => {
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

  it("applies schema migrations including Phase 1 auth hardening foundations", async () => {
    const sqlite = new Database(databasePath);

    const usersColumns = sqlite
      .prepare("SELECT name FROM pragma_table_info('users') ORDER BY cid")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(usersColumns).toContain("display_name");

    const sessionsColumns = sqlite
      .prepare("SELECT name FROM pragma_table_info('sessions') ORDER BY cid")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(sessionsColumns).toContain("token_hash");

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toContain("email_change_challenges");
    expect(tables).toContain("rate_limit_entries");
    expect(tables).toContain("rate_limit_allowlist");

    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(indexes).toContain("sessions_token_hash_unique");
    expect(indexes).toContain("login_challenges_username_created_at_idx");
    expect(indexes).toContain("login_challenges_username_consumed_expires_idx");
    expect(indexes).toContain("login_challenges_expires_at_idx");
    expect(indexes).toContain("rate_limit_entries_scope_key_unique");
    expect(indexes).toContain("rate_limit_allowlist_ip_or_cidr_unique");

    sqlite.close();

    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const buildServer = packageJson.scripts?.["build:server"] ?? "";
    expect(buildServer).toContain("cp src/server/db/migrations/*.sql dist-server/migrations/");
    expect(buildServer).toContain("cp src/server/db/migrations/*.sql dist-server/db/migrations/");
  });

  it("lets admins list and clear persisted rate-limit blocks", async () => {
    const sqlite = new Database(databasePath);
    const timestamp = new Date().toISOString();
    const id = randomUUID();
    const key = createHash("sha256").update("test-key").digest("hex");
    const blockedUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    sqlite
      .prepare(
        `
        INSERT INTO rate_limit_entries (
          id,
          scope,
          key,
          attempt_count,
          window_started_at,
          last_attempt_at,
          blocked_until,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(id, "login_request", key, 10, timestamp, timestamp, blockedUntil, timestamp, timestamp);
    sqlite.close();

    const adminAgent = request.agent(started!.app);
    await login(adminAgent, "hauptadmin");

    await adminAgent
      .get("/api/admin/rate-limits")
      .expect(200)
      .expect((response) => {
        const ids = (response.body.rateLimits as Array<{ id: string }>).map((entry) => entry.id);
        expect(ids).toContain(id);
      });

    await adminAgent.delete(`/api/admin/rate-limits/${id}`).expect(200);

    await adminAgent
      .get("/api/admin/rate-limits")
      .expect(200)
      .expect((response) => {
        const ids = (response.body.rateLimits as Array<{ id: string }>).map((entry) => entry.id);
        expect(ids).not.toContain(id);
      });
  });

  it("returns a generic success response for unknown login-code requests without creating challenges", async () => {
    const agent = request(started!.app);
    await agent.post("/api/auth/request-code").send({ username: "unbekannt" }).expect(202);

    const sqlite = new Database(databasePath);
    const count = sqlite
      .prepare("SELECT COUNT(*) AS count FROM login_challenges WHERE username = ?")
      .get("unbekannt") as { count: number };
    sqlite.close();
    expect(count.count).toBe(0);
  });

  it("supersedes older login challenges and cleans expired challenges", async () => {
    const adminAgent = request.agent(started!.app);
    await login(adminAgent, "hauptadmin");

    await adminAgent
      .post("/api/admin/users")
      .send({ username: "spieler", email: "spieler@example.test", role: "user" })
      .expect(201);

    const sqlite = new Database(databasePath);
    const expiredId = randomUUID();
    const past = new Date(Date.now() - 60_000).toISOString();
    sqlite
      .prepare(
        `
        INSERT INTO login_challenges (
          id, phone_number, username, email, code_hash, expires_at, consumed_at, sent_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(expiredId, "user:expired", "spieler", "spieler@example.test", "hash", past, null, null, past);
    sqlite.close();

    await request(started!.app).post("/api/auth/request-code").send({ username: "spieler" }).expect(202);
    await request(started!.app).post("/api/auth/request-code").send({ username: "spieler" }).expect(202);

    const sqliteAfter = new Database(databasePath);
    const rows = sqliteAfter
      .prepare(
        "SELECT id, consumed_at, expires_at FROM login_challenges WHERE username = ? ORDER BY created_at ASC"
      )
      .all("spieler") as Array<{ id: string; consumed_at: string | null; expires_at: string }>;
    sqliteAfter.close();

    expect(rows.some((row) => row.id === expiredId)).toBe(false);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].consumed_at).not.toBeNull();
    expect(rows[rows.length - 1].consumed_at).toBeNull();
  });

  it("rate-limits repeated login-code requests and OTP verification attempts", async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(started!.app).post("/api/auth/request-code").send({ username: "unbekannt2" }).expect(202);
    }

    await request(started!.app)
      .post("/api/auth/request-code")
      .send({ username: "unbekannt2" })
      .expect(429)
      .expect((response) => {
        expect(response.body.error).toBe("rate_limit_aktiv");
        expect(typeof response.body.retryAfterSeconds).toBe("number");
      });

    for (let i = 0; i < 8; i += 1) {
      await request(started!.app)
        .post("/api/auth/verify-code")
        .send({ username: "unbekannt2", code: "000000", deviceName: "x" })
        .expect(401);
    }

    await request(started!.app)
      .post("/api/auth/verify-code")
      .send({ username: "unbekannt2", code: "000000", deviceName: "x" })
      .expect(429)
      .expect((response) => {
        expect(response.body.error).toBe("rate_limit_aktiv");
        expect(typeof response.body.retryAfterSeconds).toBe("number");
      });
  });

  it("logs in, manages roles, creates events and enforces participation capacity", async () => {
    const adminAgent = request.agent(started!.app);
    await login(adminAgent, "hauptadmin");

    const manager = await adminAgent
      .post("/api/admin/users")
      .send({
        username: "manager",
        email: "manager@example.test",
        role: "manager"
      })
      .expect(201);

    expect(manager.body.user.phoneNumber).toMatch(/^user:/);

    await adminAgent
      .post("/api/admin/users")
      .send({
        username: "spieler1",
        email: "spieler1@example.test",
        role: "user"
      })
      .expect(201);

    await adminAgent
      .post("/api/admin/users")
      .send({
        username: "spieler2",
        email: "spieler2@example.test",
        role: "user"
      })
      .expect(201);

    await adminAgent
      .patch(`/api/admin/users/${manager.body.user.id}`)
      .send({ role: "manager" })
      .expect(200);

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
      .expect(200);

    const invite = await adminAgent
      .post("/api/admin/invite-codes")
      .send({ label: "Test LAN", code: "TESTLAN", maxUses: 5 })
      .expect(201);

    const invitedAgent = request.agent(started!.app);
    const invited = await invitedAgent
      .post("/api/auth/register")
      .send({ inviteCode: "TESTLAN", username: "invitee", email: "invitee@example.test" })
      .expect(201);

    await invitedAgent
      .post("/api/auth/verify-code")
      .send({ username: "invitee", code: "123456", deviceName: "phone" })
      .expect(200);

    const sessionsResponse = await invitedAgent.get("/api/auth/sessions").expect(200);
    expect(sessionsResponse.body.sessions).toHaveLength(1);
    await invitedAgent
      .delete(`/api/auth/sessions/${sessionsResponse.body.sessions[0].id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.revokedCurrent).toBe(true);
      });

    expect(invite.body.inviteCode.usedCount).toBe(0);
    await adminAgent.delete(`/api/admin/users/${invited.body.user.id}`).expect(204);
    await request(started!.app).post("/api/auth/request-code").send({ username: "invitee" }).expect(202);

    await request(started!.app)
      .get("/api/settings")
      .expect(200)
      .expect((response) => {
        expect(response.body.settings.appName).toBe("Hermes Test");
        expect(response.body.settings.themeAdminColor).toBe("#2563eb");
      });

    await adminAgent.post("/api/admin/backup").expect(200);

    const managerAgent = request.agent(started!.app);
    await login(managerAgent, "manager");

    const userOneAgent = request.agent(started!.app);
    await login(userOneAgent, "spieler1");

    const userTwoAgent = request.agent(started!.app);
    await login(userTwoAgent, "spieler2");

    await userOneAgent
      .post("/api/events")
      .send({ gameTitle: "Blocked", startMode: "now", minPlayers: 1, maxPlayers: 2 })
      .expect(403);

    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const event = await managerAgent
      .post("/api/events")
      .send({
        gameTitle: "Duo Game",
        startMode: "scheduled",
        startsAt,
        minPlayers: 1,
        maxPlayers: 1
      })
      .expect(201);

    const eventId = event.body.event.id as string;

    await userOneAgent
      .post(`/api/events/${eventId}/participation`)
      .send({ status: "joined" })
      .expect(200)
      .expect((response) => {
        expect(response.body.event.status).toBe("ready");
        expect(response.body.event.joinedCount).toBe(1);
      });

    await userTwoAgent
      .post(`/api/events/${eventId}/participation`)
      .send({ status: "joined" })
      .expect(409);

    await userOneAgent
      .post(`/api/events/${eventId}/participation`)
      .send({ status: "declined" })
      .expect(200);

    await adminAgent
      .get("/api/admin/audit-log?limit=20")
      .expect(200)
      .expect((response) => {
        const summaries = (response.body.auditLogs as Array<{ summary: string }>).map(
          (entry) => entry.summary
        );
        expect(summaries.some((summary) => summary.includes("nicht dabei"))).toBe(true);
        expect(summaries.some((summary) => summary.includes("Duo Game"))).toBe(true);
      });

    await userTwoAgent
      .post(`/api/events/${eventId}/participation`)
      .send({ status: "joined" })
      .expect(200);
  });
});
