import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapAdmin } from "../db/bootstrap-admin";
import { createHermesApp } from "../app";

type StartedApp = Awaited<ReturnType<typeof createHermesApp>>;

const DEVICE_KEY_A = "AAAAAAAAAAAAAAAAAAAAAA";
const DEVICE_KEY_B = "BBBBBBBBBBBBBBBBBBBBBB";
const CHROME_WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const ANDROID_CHROME_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

let started: StartedApp | undefined;
let databasePath: string;

async function requestCode(agent: ReturnType<typeof request.agent>, username: string) {
  await agent.post("/api/auth/request-code").send({ username }).expect(202);
}

function openDb() {
  return new Database(databasePath);
}

function countActiveSessionsForAdmin() {
  const sqlite = openDb();
  const row = sqlite
    .prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?) AND revoked_at IS NULL"
    )
    .get("hauptadmin") as { count: number };
  sqlite.close();
  return row.count;
}

describe("auth device recognition", () => {
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

  it("same-device key reuse updates the existing session and logs auth.login_recognized", async () => {
    const agent = request.agent(started!.app);

    await requestCode(agent, "hauptadmin");
    await agent
      .post("/api/auth/verify-code")
      .set("User-Agent", CHROME_WINDOWS_UA)
      .send({
        username: "hauptadmin",
        code: "123456",
        deviceName: "test",
        deviceKey: DEVICE_KEY_A
      })
      .expect(200);

    const beforeCount = countActiveSessionsForAdmin();
    expect(beforeCount).toBe(1);

    await requestCode(agent, "hauptadmin");
    await agent
      .post("/api/auth/verify-code")
      .set("User-Agent", CHROME_WINDOWS_UA)
      .send({
        username: "hauptadmin",
        code: "123456",
        deviceName: "test-renamed",
        deviceKey: DEVICE_KEY_A
      })
      .expect(200);

    const afterCount = countActiveSessionsForAdmin();
    expect(afterCount).toBe(beforeCount);

    const sqlite = openDb();
    const row = sqlite
      .prepare(
        "SELECT device_name, device_key_hash FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?) AND revoked_at IS NULL"
      )
      .get("hauptadmin") as { device_name: string; device_key_hash: string | null };
    expect(row.device_name).toBe("test-renamed");
    expect(row.device_key_hash).not.toBeNull();

    const recognizedLog = sqlite
      .prepare("SELECT summary, metadata FROM audit_logs WHERE action = ?")
      .get("auth.login_recognized") as { summary: string; metadata: string | null } | undefined;
    sqlite.close();

    expect(recognizedLog).toBeTruthy();
    const combined = `${recognizedLog?.summary ?? ""}|${recognizedLog?.metadata ?? ""}`;
    expect(combined.includes(DEVICE_KEY_A)).toBe(false);
  });

  it("derives a human-meaningful Windows label when a recognized session is reused without manual rename", async () => {
    const agent = request.agent(started!.app);

    await requestCode(agent, "hauptadmin");
    await agent
      .post("/api/auth/verify-code")
      .set("User-Agent", CHROME_WINDOWS_UA)
      .send({
        username: "hauptadmin",
        code: "123456",
        deviceKey: DEVICE_KEY_A
      })
      .expect(200);

    expect(countActiveSessionsForAdmin()).toBe(1);

    await requestCode(agent, "hauptadmin");
    await agent
      .post("/api/auth/verify-code")
      .set("User-Agent", CHROME_WINDOWS_UA)
      .send({
        username: "hauptadmin",
        code: "123456",
        deviceKey: DEVICE_KEY_A
      })
      .expect(200);

    const sqlite = openDb();
    const row = sqlite
      .prepare(
        "SELECT device_name, device_key_hash FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?) AND revoked_at IS NULL"
      )
      .get("hauptadmin") as { device_name: string; device_key_hash: string | null };

    const recognizedLog = sqlite
      .prepare("SELECT summary, metadata FROM audit_logs WHERE action = ? ORDER BY created_at DESC LIMIT 1")
      .get("auth.login_recognized") as { summary: string; metadata: string | null } | undefined;
    sqlite.close();

    expect(row.device_name).toBe("Windows-Desktop · Chrome");
    expect(row.device_key_hash).not.toBeNull();
    expect(recognizedLog).toBeTruthy();
    expect(`${recognizedLog?.summary ?? ""}|${recognizedLog?.metadata ?? ""}`).not.toContain(DEVICE_KEY_A);
  });

  it("fallback by signals (no deviceKey, same User-Agent) reuses the existing session", async () => {
    const agent = request.agent(started!.app);

    await requestCode(agent, "hauptadmin");
    await agent
      .post("/api/auth/verify-code")
      .set("User-Agent", CHROME_WINDOWS_UA)
      .send({ username: "hauptadmin", code: "123456", deviceName: "signals-first" })
      .expect(200);

    expect(countActiveSessionsForAdmin()).toBe(1);

    await requestCode(agent, "hauptadmin");
    await agent
      .post("/api/auth/verify-code")
      .set("User-Agent", CHROME_WINDOWS_UA)
      .send({ username: "hauptadmin", code: "123456", deviceName: "signals-second" })
      .expect(200);

    expect(countActiveSessionsForAdmin()).toBe(1);

    const sqlite = openDb();
    const row = sqlite
      .prepare(
        "SELECT device_name, device_signals FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?) AND revoked_at IS NULL"
      )
      .get("hauptadmin") as { device_name: string; device_signals: string | null };
    sqlite.close();

    expect(row.device_name).toBe("signals-second");
    expect(row.device_signals).toBe("windows|chrome|desktop|web");
  });

  it("fresh device path: a different deviceKey creates a new session row", async () => {
    const agent = request.agent(started!.app);

    await requestCode(agent, "hauptadmin");
    await agent
      .post("/api/auth/verify-code")
      .set("User-Agent", CHROME_WINDOWS_UA)
      .send({
        username: "hauptadmin",
        code: "123456",
        deviceName: "first-device",
        deviceKey: DEVICE_KEY_A
      })
      .expect(200);

    const baseline = countActiveSessionsForAdmin();
    expect(baseline).toBe(1);

    await requestCode(agent, "hauptadmin");
    await agent
      .post("/api/auth/verify-code")
      .set("User-Agent", CHROME_WINDOWS_UA)
      .send({
        username: "hauptadmin",
        code: "123456",
        deviceName: "second-device",
        deviceKey: DEVICE_KEY_B
      })
      .expect(200);

    expect(countActiveSessionsForAdmin()).toBe(baseline + 1);

    const sqlite = openDb();
    const rows = sqlite
      .prepare(
        "SELECT revoked_at FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)"
      )
      .all("hauptadmin") as Array<{ revoked_at: string | null }>;
    sqlite.close();

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.revoked_at === null)).toBe(true);
  });

  it("malformed deviceKey is rejected with 400 ungueltiger_code", async () => {
    await request(started!.app)
      .post("/api/auth/verify-code")
      .send({ username: "hauptadmin", code: "123456", deviceKey: "short" })
      .expect(400)
      .expect((response) => {
        expect(response.body).toEqual({ error: "ungueltiger_code" });
      });
  });

  it("sets Cache-Control: no-store on the verify-code response", async () => {
    const agent = request.agent(started!.app);
    await requestCode(agent, "hauptadmin");
    const response = await agent
      .post("/api/auth/verify-code")
      .set("User-Agent", CHROME_WINDOWS_UA)
      .send({
        username: "hauptadmin",
        code: "123456",
        deviceName: "cache-control-test",
        deviceKey: DEVICE_KEY_A
      })
      .expect(200);

    const header = response.headers["cache-control"] ?? "";
    expect(header).toContain("no-store");
  });
});
