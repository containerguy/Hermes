import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
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

function openDb() {
  return new Database(databasePath);
}

const ANDROID_CHROME_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

function getAdminId() {
  const sqlite = openDb();
  const row = sqlite.prepare("SELECT id FROM users WHERE username = ?").get("hauptadmin") as
    | { id: string }
    | undefined;
  sqlite.close();
  if (!row) throw new Error("admin not bootstrapped");
  return row.id;
}

function countActiveSessions(userId: string) {
  const sqlite = openDb();
  const row = sqlite
    .prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND revoked_at IS NULL")
    .get(userId) as { count: number };
  sqlite.close();
  return row.count;
}

describe("auth device pairing", () => {
  beforeEach(async () => {
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
  }, 30_000);

  afterEach(async () => {
    await started?.close();
    started = undefined;

    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  });

  it("mint requires authentication", async () => {
    await request(started!.app)
      .post("/api/auth/pair-token")
      .send({})
      .expect(401)
      .expect((response) => {
        expect(response.body).toEqual({ error: "nicht_angemeldet" });
      });
  });

  it("mint requires CSRF", async () => {
    const agent = request.agent(started!.app);
    await login(agent, "hauptadmin");

    await agent
      .post("/api/auth/pair-token")
      .send({})
      .expect(403)
      .expect((response) => {
        expect(response.body).toEqual({ error: "csrf_token_ungueltig" });
      });
  });

  it("happy path: mint then redeem creates a second session, original session intact", async () => {
    const agentA = request.agent(started!.app);
    const admin = await login(agentA, "hauptadmin");
    const csrf = await fetchCsrf(agentA);

    const mint = await agentA
      .post("/api/auth/pair-token")
      .set(CSRF_HEADER, csrf)
      .send({})
      .expect(201);

    expect(typeof mint.body.token).toBe("string");
    expect(typeof mint.body.expiresAt).toBe("string");
    expect(mint.headers["cache-control"] ?? "").toContain("no-store");
    const token = mint.body.token as string;

    const agentB = request.agent(started!.app);
    const redeem = await agentB
      .post("/api/auth/pair-redeem")
      .send({ token, deviceName: "phone", deviceKey: "BBBBBBBBBBBBBBBBBBBBBB" })
      .expect(201);

    expect(redeem.body.user.id).toBe(admin.id);
    const setCookie = redeem.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    expect(cookieHeader.some((value) => value.startsWith("hermes_session="))).toBe(true);
    expect(redeem.headers["cache-control"] ?? "").toContain("no-store");

    const sqlite = openDb();
    const sessionRows = sqlite
      .prepare(
        "SELECT id, device_key_hash, revoked_at FROM sessions WHERE user_id = ? ORDER BY created_at ASC"
      )
      .all(admin.id) as Array<{ id: string; device_key_hash: string | null; revoked_at: string | null }>;
    expect(sessionRows).toHaveLength(2);
    expect(sessionRows.every((row) => row.revoked_at === null)).toBe(true);
    const newestSession = sessionRows[sessionRows.length - 1];
    expect(newestSession.device_key_hash).not.toBeNull();

    const pairingRow = sqlite
      .prepare(
        "SELECT consumed_at, consumed_session_id FROM pairing_tokens WHERE user_id = ?"
      )
      .get(admin.id) as { consumed_at: string | null; consumed_session_id: string | null };
    expect(pairingRow.consumed_at).not.toBeNull();
    expect(pairingRow.consumed_session_id).toBe(newestSession.id);

    const created = sqlite
      .prepare("SELECT summary, metadata FROM audit_logs WHERE action = ? AND actor_user_id = ?")
      .all("device_pair_created", admin.id) as Array<{ summary: string; metadata: string | null }>;
    expect(created).toHaveLength(1);

    const redeemed = sqlite
      .prepare("SELECT summary, metadata FROM audit_logs WHERE action = ? AND actor_user_id = ?")
      .all("device_pair_redeemed", admin.id) as Array<{ summary: string; metadata: string | null }>;
    expect(redeemed).toHaveLength(1);
    sqlite.close();

    for (const row of [...created, ...redeemed]) {
      expect(JSON.stringify(row)).not.toContain(token);
    }
  });

  it("pair redemption derives a human-meaningful Android label when no manual device name is submitted", async () => {
    const agentA = request.agent(started!.app);
    const admin = await login(agentA, "hauptadmin");
    const csrf = await fetchCsrf(agentA);

    const mint = await agentA
      .post("/api/auth/pair-token")
      .set(CSRF_HEADER, csrf)
      .send({})
      .expect(201);
    const token = mint.body.token as string;

    await request.agent(started!.app)
      .post("/api/auth/pair-redeem")
      .set("User-Agent", ANDROID_CHROME_UA)
      .send({ token, deviceKey: "BBBBBBBBBBBBBBBBBBBBBB" })
      .expect(201);

    const sqlite = openDb();
    const sessionRows = sqlite
      .prepare(
        "SELECT id, device_name, revoked_at FROM sessions WHERE user_id = ? ORDER BY created_at ASC"
      )
      .all(admin.id) as Array<{ id: string; device_name: string; revoked_at: string | null }>;

    const redeemed = sqlite
      .prepare("SELECT metadata FROM audit_logs WHERE action = ? AND actor_user_id = ? ORDER BY created_at DESC LIMIT 1")
      .get("device_pair_redeemed", admin.id) as { metadata: string | null } | undefined;
    sqlite.close();

    expect(sessionRows).toHaveLength(2);
    expect(sessionRows[1]?.revoked_at).toBeNull();
    expect(sessionRows[1]?.device_name).toBe("Android-Smartphone · Chrome");
    expect(redeemed?.metadata ?? "").not.toContain(token);
  });

  it("double-redemption returns pair_token_consumed", async () => {
    const agentA = request.agent(started!.app);
    const admin = await login(agentA, "hauptadmin");
    const csrf = await fetchCsrf(agentA);

    const mint = await agentA
      .post("/api/auth/pair-token")
      .set(CSRF_HEADER, csrf)
      .send({})
      .expect(201);
    const token = mint.body.token as string;

    await request.agent(started!.app)
      .post("/api/auth/pair-redeem")
      .send({ token, deviceName: "first" })
      .expect(201);

    await request.agent(started!.app)
      .post("/api/auth/pair-redeem")
      .send({ token, deviceName: "second" })
      .expect(400)
      .expect((response) => {
        expect(response.body).toEqual({ error: "pair_token_consumed" });
      });

    expect(countActiveSessions(admin.id)).toBe(2);
  });

  it("expired token returns pair_token_expired", async () => {
    const agentA = request.agent(started!.app);
    await login(agentA, "hauptadmin");
    const csrf = await fetchCsrf(agentA);

    const mint = await agentA
      .post("/api/auth/pair-token")
      .set(CSRF_HEADER, csrf)
      .send({})
      .expect(201);
    const token = mint.body.token as string;

    const sqlite = openDb();
    sqlite
      .prepare("UPDATE pairing_tokens SET expires_at = ? WHERE token_hash IS NOT NULL")
      .run(new Date(Date.now() - 60_000).toISOString());
    sqlite.close();

    await request.agent(started!.app)
      .post("/api/auth/pair-redeem")
      .send({ token })
      .expect(400)
      .expect((response) => {
        expect(response.body).toEqual({ error: "pair_token_expired" });
      });
  });

  it("origin-revoked token returns pair_origin_revoked", async () => {
    const agentA = request.agent(started!.app);
    const admin = await login(agentA, "hauptadmin");
    const csrf = await fetchCsrf(agentA);

    const mint = await agentA
      .post("/api/auth/pair-token")
      .set(CSRF_HEADER, csrf)
      .send({})
      .expect(201);
    const token = mint.body.token as string;

    const sessionsResponse = await agentA.get("/api/auth/sessions").expect(200);
    const currentSessionId = (
      sessionsResponse.body.sessions as Array<{ id: string; current: boolean }>
    ).find((entry) => entry.current)?.id;
    expect(currentSessionId).toBeTruthy();

    await agentA
      .delete(`/api/auth/sessions/${currentSessionId}`)
      .set(CSRF_HEADER, csrf)
      .expect(200);

    await request.agent(started!.app)
      .post("/api/auth/pair-redeem")
      .send({ token })
      .expect(401)
      .expect((response) => {
        expect(response.body).toEqual({ error: "pair_origin_revoked" });
      });

    expect(countActiveSessions(admin.id)).toBe(0);
  });

  it("malformed token returns pair_token_invalid", async () => {
    await request(started!.app)
      .post("/api/auth/pair-redeem")
      .send({ token: "short" })
      .expect(400)
      .expect((response) => {
        expect(response.body).toEqual({ error: "pair_token_invalid" });
      });
  });

  it("rate limit fires after 5 mints in a window", async () => {
    const agent = request.agent(started!.app);
    await login(agent, "hauptadmin");
    const csrf = await fetchCsrf(agent);

    for (let i = 0; i < 5; i += 1) {
      await agent
        .post("/api/auth/pair-token")
        .set(CSRF_HEADER, csrf)
        .send({})
        .expect(201);
    }

    await agent
      .post("/api/auth/pair-token")
      .set(CSRF_HEADER, csrf)
      .send({})
      .expect(429)
      .expect((response) => {
        expect(response.body.error).toBe("rate_limit_aktiv");
        expect(typeof response.body.retryAfterSeconds).toBe("number");
      });
  });

  it("audit log never carries the raw pairing token", async () => {
    const agentA = request.agent(started!.app);
    const admin = await login(agentA, "hauptadmin");
    const csrf = await fetchCsrf(agentA);

    const mint = await agentA
      .post("/api/auth/pair-token")
      .set(CSRF_HEADER, csrf)
      .send({})
      .expect(201);
    const token = mint.body.token as string;

    await request.agent(started!.app)
      .post("/api/auth/pair-redeem")
      .send({ token, deviceName: "audit-check" })
      .expect(201);

    const sqlite = openDb();
    const rows = sqlite
      .prepare(
        "SELECT action, summary, metadata FROM audit_logs WHERE action IN (?, ?) AND actor_user_id = ?"
      )
      .all("device_pair_created", "device_pair_redeemed", admin.id) as Array<{
      action: string;
      summary: string;
      metadata: string | null;
    }>;
    sqlite.close();

    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toContain(token);
    }
  });
});
