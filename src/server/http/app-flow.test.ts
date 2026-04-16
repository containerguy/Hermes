import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    const csrf = await fetchCsrf(adminAgent);

    await adminAgent
      .get("/api/admin/rate-limits")
      .expect(200)
      .expect((response) => {
        const ids = (response.body.rateLimits as Array<{ id: string }>).map((entry) => entry.id);
        expect(ids).toContain(id);
      });

    await adminAgent.delete(`/api/admin/rate-limits/${id}`).set(CSRF_HEADER, csrf).expect(200);

    await adminAgent
      .get("/api/admin/rate-limits")
      .expect(200)
      .expect((response) => {
        const ids = (response.body.rateLimits as Array<{ id: string }>).map((entry) => entry.id);
        expect(ids).not.toContain(id);
      });
  });

  it("does not block primary actions when audit logging fails (D-27)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalPrepare = Database.prototype.prepare;
    const prepareSpy = vi
      .spyOn(Database.prototype, "prepare")
      .mockImplementation(function (this: unknown, sql: string) {
      if (typeof sql === "string" && sql.toLowerCase().includes("audit_logs")) {
        throw new Error("audit boom");
      }
      return originalPrepare.call(this as never, sql);
    });

    try {
      await request(started!.app).post("/api/auth/request-code").send({ username: "unbekannt" }).expect(202);

      const sqlite = new Database(databasePath);
      const timestamp = new Date().toISOString();
      const id = randomUUID();
      const key = createHash("sha256").update("audit-fail-key").digest("hex");
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
      const csrf = await fetchCsrf(adminAgent);
      await adminAgent.delete(`/api/admin/rate-limits/${id}`).set(CSRF_HEADER, csrf).expect(200);

      expect(errorSpy).toHaveBeenCalledWith("[Hermes] audit log failed", expect.any(Error));
    } finally {
      prepareSpy.mockRestore();
      errorSpy.mockRestore();
    }
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
    const csrf = await fetchCsrf(adminAgent);

    await adminAgent
      .post("/api/admin/users")
      .send({ username: "spieler", email: "spieler@example.test", role: "user" })
      .set(CSRF_HEADER, csrf)
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

  it("throttles repeated invite registration attempts (invite_register) for invalid invite codes", async () => {
    const adminAgent = request.agent(started!.app);
    await login(adminAgent, "hauptadmin");
    const adminCsrf = await fetchCsrf(adminAgent);

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
      .set(CSRF_HEADER, adminCsrf)
      .expect(200);

    for (let i = 0; i < 10; i += 1) {
      await request(started!.app)
        .post("/api/auth/register")
        .send({ inviteCode: "FALSCH", username: `probe${i}`, email: `probe${i}@example.test` })
        .expect(403)
        .expect((response) => {
          expect(response.body.error).toBe("invite_ungueltig");
        });
    }

    await request(started!.app)
      .post("/api/auth/register")
      .send({ inviteCode: "FALSCH", username: "probe10", email: "probe10@example.test" })
      .expect(429)
      .expect((response) => {
        expect(response.body.error).toBe("rate_limit_aktiv");
        expect(typeof response.body.retryAfterSeconds).toBe("number");
      });
  });

  it("rejects admin-supplied custom invite codes and redacts invite codes in audit metadata", async () => {
    const adminAgent = request.agent(started!.app);
    await login(adminAgent, "hauptadmin");
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

    await adminAgent
      .post("/api/admin/invite-codes")
      .send({ label: "Weak", code: "TESTLAN" })
      .set(CSRF_HEADER, csrf)
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toBe("invite_code_custom_deaktiviert");
      });

    const created = await adminAgent
      .post("/api/admin/invite-codes")
      .send({ label: "Generated only" })
      .set(CSRF_HEADER, csrf)
      .expect(201);

    const fullCode = (created.body.inviteCode as { code: string }).code;
    expect(fullCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    // 16 Crockford-base32 chars are 80 bits, generated by backend crypto randomness.

    await adminAgent
      .get("/api/admin/invite-codes")
      .expect(200)
      .expect((response) => {
        const inviteCodes = response.body.inviteCodes as Array<{ id: string; code: string }>;
        const listed = inviteCodes.find((entry) => entry.code === fullCode);
        expect(listed).toBeTruthy();
      });

    await adminAgent
      .get("/api/admin/audit-log?limit=20")
      .expect(200)
      .expect((response) => {
        const inviteCreate = (response.body.auditLogs as Array<{ action: string; metadata: unknown }>).find(
          (entry) => entry.action === "invite.create"
        );
        expect(inviteCreate).toBeTruthy();
        const metadata = inviteCreate?.metadata as Record<string, unknown> | null | undefined;
        expect(metadata).toBeTruthy();
        const metadataString = JSON.stringify(metadata ?? {});
        expect(metadataString.includes(fullCode)).toBe(false);
      });
  });

  it("supports invite lifecycle edit, deactivate, reactivate, and safe delete", async () => {
    // Note: INV-03 atomic maxUses concurrency is deferred to Phase 2; these tests assert single-request behavior only.
    const adminAgent = request.agent(started!.app);
    await login(adminAgent, "hauptadmin");
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

    const created = await adminAgent
      .post("/api/admin/invite-codes")
      .send({ label: "Lifecycle", maxUses: 3 })
      .set(CSRF_HEADER, csrf)
      .expect(201);

    const invite = created.body.inviteCode as { id: string; code: string; label: string };

    await adminAgent
      .patch(`/api/admin/invite-codes/${invite.id}`)
      .send({ label: "Lifecycle Updated" })
      .set(CSRF_HEADER, csrf)
      .expect(200)
      .expect((response) => {
        expect(response.body.inviteCode.label).toBe("Lifecycle Updated");
      });

    const invitedOne = request.agent(started!.app);
    await invitedOne
      .post("/api/auth/register")
      .send({ inviteCode: invite.code, username: "life1", email: "life1@example.test" })
      .expect(201);

    const invitedTwo = request.agent(started!.app);
    await invitedTwo
      .post("/api/auth/register")
      .send({ inviteCode: invite.code, username: "life2", email: "life2@example.test" })
      .expect(201);

    await adminAgent
      .patch(`/api/admin/invite-codes/${invite.id}`)
      .send({ maxUses: 1 })
      .set(CSRF_HEADER, csrf)
      .expect(409)
      .expect((response) => {
        expect(response.body.error).toBe("invite_max_uses_unter_used_count");
      });

    await adminAgent
      .post(`/api/admin/invite-codes/${invite.id}/deactivate`)
      .set(CSRF_HEADER, csrf)
      .expect(200)
      .expect((response) => {
        expect(response.body.inviteCode.revokedAt).toBeTruthy();
      });

    await adminAgent
      .post(`/api/admin/invite-codes/${invite.id}/reactivate`)
      .set(CSRF_HEADER, csrf)
      .expect(200)
      .expect((response) => {
        expect(response.body.inviteCode.revokedAt).toBeNull();
      });

    const unused = await adminAgent
      .post("/api/admin/invite-codes")
      .send({ label: "Unused" })
      .set(CSRF_HEADER, csrf)
      .expect(201);

    const unusedInvite = unused.body.inviteCode as { id: string };
    await adminAgent.delete(`/api/admin/invite-codes/${unusedInvite.id}`).set(CSRF_HEADER, csrf).expect(204);

    await adminAgent
      .delete(`/api/admin/invite-codes/${invite.id}`)
      .set(CSRF_HEADER, csrf)
      .expect(409)
      .expect((response) => {
        expect(response.body.error).toBe("invite_hat_nutzungen");
      });
  });

  it("stores hashed session tokens, rejects legacy sessions, and revokes sessions after sensitive admin changes", async () => {
    const adminAgent = request.agent(started!.app);
    await login(adminAgent, "hauptadmin");
    const adminCsrf = await fetchCsrf(adminAgent);

    const created = await adminAgent
      .post("/api/admin/users")
      .send({ username: "revokee", email: "revokee@example.test", role: "user" })
      .set(CSRF_HEADER, adminCsrf)
      .expect(201);

    const userId = created.body.user.id as string;

    const userAgent = request.agent(started!.app);
    await userAgent.post("/api/auth/request-code").send({ username: "revokee" }).expect(202);
    const verify = await userAgent
      .post("/api/auth/verify-code")
      .send({ username: "revokee", code: "123456", deviceName: "test" })
      .expect(200);

    expect(verify.body.user.id).toBe(userId);

    const setCookie = verify.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const sessionCookie = cookieHeader.find((value) => value.startsWith("hermes_session="));
    expect(sessionCookie).toBeTruthy();

    const rawCookieToken = (sessionCookie ?? "").split(";", 1)[0]?.split("=", 2)[1] ?? "";
    expect(rawCookieToken.length).toBeGreaterThan(10);

    const sqlite = new Database(databasePath);
    const sessionIds = sqlite
      .prepare("SELECT id FROM sessions WHERE user_id = ?")
      .all(userId)
      .map((row) => (row as { id: string }).id);
    expect(sessionIds).not.toContain(rawCookieToken);

    const legacyId = "legacy-session-token";
    const timestamp = new Date().toISOString();
    sqlite
      .prepare(
        `
        INSERT INTO sessions (
          id,
          user_id,
          device_name,
          user_agent,
          last_seen_at,
          created_at,
          token_hash,
          revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(legacyId, userId, "legacy", "ua", timestamp, timestamp, null, null);
    sqlite.close();

    await request(started!.app)
      .get("/api/auth/me")
      .set("Cookie", `hermes_session=${legacyId}`)
      .expect(401)
      .expect((response) => {
        expect(response.body.error).toBe("nicht_angemeldet");
      });

    await userAgent.get("/api/auth/me").expect(200);
    await adminAgent
      .patch(`/api/admin/users/${userId}`)
      .send({ role: "manager" })
      .set(CSRF_HEADER, adminCsrf)
      .expect(200);
    await userAgent.get("/api/auth/me").expect(401);

    await login(userAgent, "revokee");
    await userAgent.get("/api/auth/me").expect(200);
    await adminAgent
      .patch(`/api/admin/users/${userId}`)
      .send({ email: "revokee2@example.test" })
      .set(CSRF_HEADER, adminCsrf)
      .expect(200);
    await userAgent.get("/api/auth/me").expect(401);

    await login(userAgent, "revokee");
    await userAgent.get("/api/auth/me").expect(200);
    await adminAgent.delete(`/api/admin/users/${userId}`).set(CSRF_HEADER, adminCsrf).expect(204);
    await userAgent.get("/api/auth/me").expect(401);
  });

  it("enforces CSRF on authenticated mutations and exempts public auth endpoints", async () => {
    await request(started!.app).post("/api/auth/request-code").send({ username: "unbekannt-csrf" }).expect(202);

    const adminAgent = request.agent(started!.app);
    await login(adminAgent, "hauptadmin");

    await adminAgent
      .put("/api/admin/settings")
      .send({ appName: "No CSRF" })
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe("csrf_token_ungueltig");
      });

    const csrf = await fetchCsrf(adminAgent);
    await adminAgent.put("/api/admin/settings").set(CSRF_HEADER, csrf).send({ appName: "With CSRF" }).expect(200);

    const sessionsResponse = await adminAgent.get("/api/auth/sessions").expect(200);
    expect(sessionsResponse.body.sessions.length).toBeGreaterThan(0);

    await adminAgent
      .delete(`/api/auth/sessions/${sessionsResponse.body.sessions[0].id}`)
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe("csrf_token_ungueltig");
      });

    await adminAgent
      .delete(`/api/auth/sessions/${sessionsResponse.body.sessions[0].id}`)
      .set(CSRF_HEADER, csrf)
      .expect(200);
  });

  it("rejects duplicate active emails for admin create, admin update, and invite registration", async () => {
    const adminAgent = request.agent(started!.app);
    await login(adminAgent, "hauptadmin");
    const adminCsrf = await fetchCsrf(adminAgent);

    await adminAgent
      .post("/api/admin/users")
      .send({ username: "dup1", email: "duplicate@example.test", role: "user" })
      .set(CSRF_HEADER, adminCsrf)
      .expect(201);

    await adminAgent
      .post("/api/admin/users")
      .send({ username: "dup2", email: "duplicate@example.test", role: "user" })
      .set(CSRF_HEADER, adminCsrf)
      .expect(409)
      .expect((response) => {
        expect(response.body.error).toBe("email_existiert_bereits");
      });

    const createdA = await adminAgent
      .post("/api/admin/users")
      .send({ username: "emailA", email: "emailA@example.test", role: "user" })
      .set(CSRF_HEADER, adminCsrf)
      .expect(201);

    const createdB = await adminAgent
      .post("/api/admin/users")
      .send({ username: "emailB", email: "emailB@example.test", role: "user" })
      .set(CSRF_HEADER, adminCsrf)
      .expect(201);

    await adminAgent
      .patch(`/api/admin/users/${createdB.body.user.id as string}`)
      .send({ email: createdA.body.user.email as string })
      .set(CSRF_HEADER, adminCsrf)
      .expect(409)
      .expect((response) => {
        expect(response.body.error).toBe("email_existiert_bereits");
      });

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
      .set(CSRF_HEADER, adminCsrf)
      .expect(200);

    const inviteResponse = await adminAgent
      .post("/api/admin/invite-codes")
      .send({ label: "Dup Email Invite" })
      .set(CSRF_HEADER, adminCsrf)
      .expect(201);

    const inviteCode = (inviteResponse.body.inviteCode as { code: string }).code;

    await request(started!.app)
      .post("/api/auth/register")
      .send({ inviteCode, username: "dup-invite-1", email: "invite-dup@example.test" })
      .expect(201);

    await request(started!.app)
      .post("/api/auth/register")
      .send({ inviteCode, username: "dup-invite-2", email: "invite-dup@example.test" })
      .expect(409)
      .expect((response) => {
        expect(response.body.error).toBe("email_existiert_bereits");
      });
  });

  it("supports profile display-name updates and confirmed email changes", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const adminAgent = request.agent(started!.app);
      await login(adminAgent, "hauptadmin");
      const adminCsrf = await fetchCsrf(adminAgent);

      const created = await adminAgent
        .post("/api/admin/users")
        .send({ username: "profile-user", email: "profile-user@example.test", role: "user" })
        .set(CSRF_HEADER, adminCsrf)
        .expect(201);

      const agent = request.agent(started!.app);
      await login(agent, "profile-user");
      const csrf = await fetchCsrf(agent);

      await agent
        .patch("/api/auth/profile")
        .set(CSRF_HEADER, csrf)
        .send({ displayName: "Display Name" })
        .expect(200)
        .expect((response) => {
          expect(response.body.user.displayName).toBe("Display Name");
        });

      logSpy.mockClear();
      await agent
        .post("/api/auth/email-change")
        .set(CSRF_HEADER, csrf)
        .send({ newEmail: "profile-new@example.test" })
        .expect(202);

      const emailChangeLog = logSpy.mock.calls
        .map((call) => String(call[0] ?? ""))
        .find((line) => line.includes("Email change code"));
      expect(emailChangeLog).toBeTruthy();
      expect(emailChangeLog?.includes("<profile-new@example.test>")).toBe(true);

      logSpy.mockClear();
      await request(started!.app).post("/api/auth/request-code").send({ username: "profile-user" }).expect(202);
      const loginLog = logSpy.mock.calls
        .map((call) => String(call[0] ?? ""))
        .find((line) => line.includes("Login code for profile-user"));
      expect(loginLog).toBeTruthy();
      expect(loginLog?.includes("<profile-user@example.test>")).toBe(true);

      await agent
        .post("/api/auth/email-change/verify")
        .set(CSRF_HEADER, csrf)
        .send({ code: "000000" })
        .expect(401)
        .expect((response) => {
          expect(response.body.error).toBe("code_abgelehnt");
        });

      await agent
        .post("/api/auth/email-change/verify")
        .set(CSRF_HEADER, csrf)
        .send({ code: "123456" })
        .expect(200)
        .expect((response) => {
          expect(response.body.user.email).toBe("profile-new@example.test");
        });

      await agent.get("/api/auth/me").expect(401);

      await adminAgent
        .get("/api/admin/audit-log?limit=50")
        .expect(200)
        .expect((response) => {
          const emailChange = (response.body.auditLogs as Array<{ action: string; metadata: unknown }>).find(
            (entry) => entry.action === "user.email_change_confirm"
          );
          expect(emailChange).toBeTruthy();

          const profileUpdate = (response.body.auditLogs as Array<{ action: string; metadata: unknown }>).find(
            (entry) => entry.action === "user.profile_update"
          );
          expect(profileUpdate).toBeTruthy();

          const metadataString = JSON.stringify({
            emailChange: emailChange?.metadata ?? null,
            profileUpdate: profileUpdate?.metadata ?? null
          });
          expect(metadataString.includes("123456")).toBe(false);
        });

      expect(created.body.user.displayName).toBe("profile-user");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("rejects expired or consumed email-change challenges", async () => {
    const adminAgent = request.agent(started!.app);
    await login(adminAgent, "hauptadmin");
    const adminCsrf = await fetchCsrf(adminAgent);

    const created = await adminAgent
      .post("/api/admin/users")
      .send({ username: "challenge-user", email: "challenge-user@example.test", role: "user" })
      .set(CSRF_HEADER, adminCsrf)
      .expect(201);

    const userId = created.body.user.id as string;

    const agent = request.agent(started!.app);
    await login(agent, "challenge-user");
    const csrf = await fetchCsrf(agent);

    await agent
      .post("/api/auth/email-change")
      .set(CSRF_HEADER, csrf)
      .send({ newEmail: "challenge-new@example.test" })
      .expect(202);

    const sqlite = new Database(databasePath);
    sqlite
      .prepare("UPDATE email_change_challenges SET expires_at = ?, consumed_at = NULL WHERE user_id = ?")
      .run(new Date(Date.now() - 60_000).toISOString(), userId);
    sqlite.close();

    await agent
      .post("/api/auth/email-change/verify")
      .set(CSRF_HEADER, csrf)
      .send({ code: "123456" })
      .expect(401)
      .expect((response) => {
        expect(response.body.error).toBe("code_abgelehnt");
      });

    const sqlite2 = new Database(databasePath);
    sqlite2
      .prepare("UPDATE email_change_challenges SET expires_at = ?, consumed_at = ? WHERE user_id = ?")
      .run(new Date(Date.now() + 10 * 60_000).toISOString(), new Date().toISOString(), userId);
    sqlite2.close();

    await agent
      .post("/api/auth/email-change/verify")
      .set(CSRF_HEADER, csrf)
      .send({ code: "123456" })
      .expect(401)
      .expect((response) => {
        expect(response.body.error).toBe("code_abgelehnt");
      });
  });

  it("logs in, manages roles, creates events and enforces participation capacity", async () => {
    const adminAgent = request.agent(started!.app);
    await login(adminAgent, "hauptadmin");
    const adminCsrf = await fetchCsrf(adminAgent);

    const manager = await adminAgent
      .post("/api/admin/users")
      .send({
        username: "manager",
        email: "manager@example.test",
        role: "manager"
      })
      .set(CSRF_HEADER, adminCsrf)
      .expect(201);

    expect(manager.body.user.phoneNumber).toMatch(/^user:/);

    await adminAgent
      .post("/api/admin/users")
      .send({
        username: "spieler1",
        email: "spieler1@example.test",
        role: "user"
      })
      .set(CSRF_HEADER, adminCsrf)
      .expect(201);

    await adminAgent
      .post("/api/admin/users")
      .send({
        username: "spieler2",
        email: "spieler2@example.test",
        role: "user"
      })
      .set(CSRF_HEADER, adminCsrf)
      .expect(201);

    await adminAgent
      .patch(`/api/admin/users/${manager.body.user.id}`)
      .send({ role: "manager" })
      .set(CSRF_HEADER, adminCsrf)
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
      .set(CSRF_HEADER, adminCsrf)
      .expect(200);

    const invite = await adminAgent
      .post("/api/admin/invite-codes")
      .send({ label: "Test LAN", maxUses: 5 })
      .set(CSRF_HEADER, adminCsrf)
      .expect(201);

    const createdInvite = invite.body.inviteCode as { code: string; usedCount: number };
    expect(createdInvite.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);

    const invitedAgent = request.agent(started!.app);
    const invited = await invitedAgent
      .post("/api/auth/register")
      .send({ inviteCode: createdInvite.code, username: "invitee", email: "invitee@example.test" })
      .expect(201);

    await invitedAgent
      .post("/api/auth/verify-code")
      .send({ username: "invitee", code: "123456", deviceName: "phone" })
      .expect(200);
    const invitedCsrf = await fetchCsrf(invitedAgent);

    const sessionsResponse = await invitedAgent.get("/api/auth/sessions").expect(200);
    expect(sessionsResponse.body.sessions).toHaveLength(1);
    await invitedAgent
      .delete(`/api/auth/sessions/${sessionsResponse.body.sessions[0].id}`)
      .set(CSRF_HEADER, invitedCsrf)
      .expect(200)
      .expect((response) => {
        expect(response.body.revokedCurrent).toBe(true);
      });

    expect(invite.body.inviteCode.usedCount).toBe(0);
    await adminAgent
      .delete(`/api/admin/users/${invited.body.user.id}`)
      .set(CSRF_HEADER, adminCsrf)
      .expect(204);
    await request(started!.app).post("/api/auth/request-code").send({ username: "invitee" }).expect(202);

    await request(started!.app)
      .get("/api/settings")
      .expect(200)
      .expect((response) => {
        expect(response.body.settings.appName).toBe("Hermes Test");
        expect(response.body.settings.themeAdminColor).toBe("#2563eb");
      });

    await adminAgent.post("/api/admin/backup").set(CSRF_HEADER, adminCsrf).expect(200);

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
