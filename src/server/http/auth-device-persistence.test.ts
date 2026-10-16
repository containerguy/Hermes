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
type Agent = ReturnType<typeof request.agent>;

const DEVICE_KEY_A = "AAAAAAAAAAAAAAAAAAAAAA";
const DEVICE_KEY_B = "BBBBBBBBBBBBBBBBBBBBBB";
const CHROME_WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let started: StartedApp | undefined;
let databasePath: string;

function openDb() {
  return new Database(databasePath);
}

async function fetchCsrf(agent: Agent) {
  const response = await agent.get("/api/auth/csrf").expect(200);
  return response.body.token as string;
}

async function login(
  agent: Agent,
  body: { deviceName?: string; deviceKey?: string } = {},
  username = "hauptadmin"
) {
  await agent.post("/api/auth/request-code").send({ username }).expect(202);
  return agent
    .post("/api/auth/verify-code")
    .set("User-Agent", CHROME_WINDOWS_UA)
    .send({ username, code: "123456", ...body })
    .expect(200);
}

async function logout(agent: Agent) {
  const csrf = await fetchCsrf(agent);
  await agent.post("/api/auth/logout").set(CSRF_HEADER, csrf).expect(204);
}

function cookieNames(response: request.Response) {
  const header = response.headers["set-cookie"] as unknown as string[] | undefined;
  return (header ?? []).map((value) => value.split("=", 1)[0]);
}

function findSetCookie(response: request.Response, name: string) {
  const header = response.headers["set-cookie"] as unknown as string[] | undefined;
  return (header ?? []).find((value) => value.startsWith(`${name}=`));
}

function devicesFor(username: string) {
  const sqlite = openDb();
  const rows = sqlite
    .prepare(
      "SELECT id, name, forgotten_at FROM devices WHERE user_id = (SELECT id FROM users WHERE username = ?) ORDER BY created_at"
    )
    .all(username) as Array<{ id: string; name: string; forgotten_at: string | null }>;
  sqlite.close();
  return rows;
}

function currentSessionRow(username: string) {
  const sqlite = openDb();
  const row = sqlite
    .prepare(
      "SELECT id, device_name, device_id FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?) AND revoked_at IS NULL ORDER BY last_seen_at DESC"
    )
    .get(username) as { id: string; device_name: string; device_id: string | null } | undefined;
  sqlite.close();
  return row;
}

describe("persistent sessions and devices", () => {
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
    delete process.env.HERMES_SESSION_TTL_DAYS;
    await bootstrapAdmin();
    started = await createHermesApp();
  }, 30_000);

  afterEach(async () => {
    await started?.close();
    started = undefined;
    delete process.env.HERMES_SESSION_TTL_DAYS;

    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  });

  it("sets a long-lived httpOnly device cookie and a session cookie with the idle TTL", async () => {
    const agent = request.agent(started!.app);
    const response = await login(agent, { deviceName: "Gaming-PC", deviceKey: DEVICE_KEY_A });

    const deviceCookie = findSetCookie(response, "hermes_device");
    const sessionCookie = findSetCookie(response, "hermes_session");
    expect(deviceCookie).toContain("HttpOnly");
    expect(deviceCookie).toContain(`Max-Age=${400 * 24 * 60 * 60}`);
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain(`Max-Age=${180 * 24 * 60 * 60}`);
    expect(response.body.device).toEqual({ name: "Gaming-PC", recognized: false });
    expect(JSON.stringify(response.body)).not.toContain(DEVICE_KEY_A);
  });

  it("keeps a custom device name on re-login without a submitted name", async () => {
    const agent = request.agent(started!.app);
    await login(agent, { deviceName: "Gaming-PC", deviceKey: DEVICE_KEY_A });
    const second = await login(agent, { deviceKey: DEVICE_KEY_A });

    expect(second.body.device).toEqual({ name: "Gaming-PC", recognized: true });
    expect(currentSessionRow("hauptadmin")?.device_name).toBe("Gaming-PC");
    expect(devicesFor("hauptadmin")).toHaveLength(1);
  });

  it("recognizes the device after logout and keeps its name", async () => {
    const agent = request.agent(started!.app);
    await login(agent, { deviceName: "Gaming-PC", deviceKey: DEVICE_KEY_A });
    await logout(agent);
    await agent.get("/api/auth/me").expect(401);

    const relogin = await login(agent, { deviceKey: DEVICE_KEY_A });
    expect(relogin.body.device).toEqual({ name: "Gaming-PC", recognized: true });

    const devices = devicesFor("hauptadmin");
    expect(devices).toHaveLength(1);
    const session = currentSessionRow("hauptadmin");
    expect(session?.device_name).toBe("Gaming-PC");
    expect(session?.device_id).toBe(devices[0].id);
  });

  it("recognizes the device via cookie when localStorage (deviceKey) was wiped", async () => {
    const agent = request.agent(started!.app);
    await login(agent, { deviceName: "Laptop", deviceKey: DEVICE_KEY_A });
    await logout(agent);

    // Client lost localStorage and generated a fresh key; the server cookie still identifies it.
    const relogin = await login(agent, { deviceKey: DEVICE_KEY_B });
    expect(relogin.body.device).toEqual({ name: "Laptop", recognized: true });
    expect(devicesFor("hauptadmin")).toHaveLength(1);
  });

  it("recognizes the device via localStorage key when the cookie was cleared", async () => {
    const firstBrowser = request.agent(started!.app);
    await login(firstBrowser, { deviceName: "Laptop", deviceKey: DEVICE_KEY_A });

    const cookieless = request.agent(started!.app);
    const relogin = await login(cookieless, { deviceKey: DEVICE_KEY_A });
    expect(relogin.body.device).toEqual({ name: "Laptop", recognized: true });
    expect(findSetCookie(relogin, "hermes_device")).toContain(`hermes_device=${DEVICE_KEY_A}`);
  });

  it("assigns a server-generated device key when the client sends none", async () => {
    const agent = request.agent(started!.app);
    const first = await login(agent, { deviceName: "Ohne Key" });
    expect(findSetCookie(first, "hermes_device")).toMatch(/^hermes_device=[A-Za-z0-9_-]{22,44};/);

    await logout(agent);
    const second = await login(agent);
    expect(second.body.device).toEqual({ name: "Ohne Key", recognized: true });
  });

  it("does not share device names between users on the same browser", async () => {
    const admin = request.agent(started!.app);
    await login(admin, { deviceName: "Admins Rechner", deviceKey: DEVICE_KEY_A });
    const csrf = await fetchCsrf(admin);
    await admin
      .post("/api/admin/users")
      .set(CSRF_HEADER, csrf)
      .send({ username: "spieler", email: "spieler@example.test", role: "user" })
      .expect(201);
    await logout(admin);

    // Same browser (cookie jar + localStorage key), different account.
    const other = await login(admin, { deviceKey: DEVICE_KEY_A }, "spieler");
    expect(other.body.device.recognized).toBe(false);
    expect(other.body.device.name).toBe("Windows-Desktop · Chrome");
    expect(devicesFor("spieler")).toHaveLength(1);
    expect(devicesFor("hauptadmin")[0].name).toBe("Admins Rechner");
  });

  it("renaming a session renames the device for future logins", async () => {
    const agent = request.agent(started!.app);
    await login(agent, { deviceKey: DEVICE_KEY_A });
    const sessionId = currentSessionRow("hauptadmin")!.id;
    const csrf = await fetchCsrf(agent);
    await agent
      .patch(`/api/auth/sessions/${sessionId}`)
      .set(CSRF_HEADER, csrf)
      .send({ deviceName: "Wohnzimmer-PC" })
      .expect(200);
    await logout(agent);

    const relogin = await login(agent, { deviceKey: DEVICE_KEY_A });
    expect(relogin.body.device.name).toBe("Wohnzimmer-PC");
  });

  it("forget-device revokes the device's sessions, clears both cookies and drops the name", async () => {
    const agent = request.agent(started!.app);
    await login(agent, { deviceName: "Altes Handy", deviceKey: DEVICE_KEY_A });
    const csrf = await fetchCsrf(agent);

    const forgotten = await agent
      .post("/api/auth/device/forget")
      .set(CSRF_HEADER, csrf)
      .expect(200);
    expect(forgotten.body).toEqual({ forgotten: true });
    expect(findSetCookie(forgotten, "hermes_session")).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(findSetCookie(forgotten, "hermes_device")).toMatch(/Expires=Thu, 01 Jan 1970/);
    await agent.get("/api/auth/me").expect(401);

    const devices = devicesFor("hauptadmin");
    expect(devices).toHaveLength(1);
    expect(devices[0].forgotten_at).not.toBeNull();

    // Even if the client still sent the old key, the forgotten device is not revived.
    const relogin = await login(agent, { deviceKey: DEVICE_KEY_A });
    expect(relogin.body.device).toEqual({ name: "Windows-Desktop · Chrome", recognized: false });
    expect(devicesFor("hauptadmin")).toHaveLength(2);
  });

  it("forget-device requires a CSRF token", async () => {
    const agent = request.agent(started!.app);
    await login(agent, { deviceKey: DEVICE_KEY_A });
    await agent.post("/api/auth/device/forget").expect(403);
    await agent.get("/api/auth/me").expect(200);
  });

  it("rejects sessions that were idle longer than the TTL", async () => {
    const agent = request.agent(started!.app);
    await login(agent, { deviceKey: DEVICE_KEY_A });
    await agent.get("/api/auth/me").expect(200);

    const sqlite = openDb();
    const stale = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000).toISOString();
    sqlite.prepare("UPDATE sessions SET last_seen_at = ?").run(stale);
    sqlite.close();

    await agent.get("/api/auth/me").expect(401);
  });

  it("honors HERMES_SESSION_TTL_DAYS", async () => {
    process.env.HERMES_SESSION_TTL_DAYS = "7";
    const agent = request.agent(started!.app);
    const response = await login(agent, { deviceKey: DEVICE_KEY_A });
    expect(findSetCookie(response, "hermes_session")).toContain(`Max-Age=${7 * 24 * 60 * 60}`);

    const sqlite = openDb();
    const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    sqlite.prepare("UPDATE sessions SET last_seen_at = ?").run(stale);
    sqlite.close();
    await agent.get("/api/auth/me").expect(401);
  });

  it("re-issues the session and device cookie once the renew interval has passed", async () => {
    const agent = request.agent(started!.app);
    await login(agent, { deviceKey: DEVICE_KEY_A });

    const fresh = await agent.get("/api/auth/me").expect(200);
    expect(cookieNames(fresh)).not.toContain("hermes_session");

    const sqlite = openDb();
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    sqlite.prepare("UPDATE sessions SET renewed_at = ?").run(old);
    sqlite.close();

    const renewed = await agent.get("/api/auth/me").expect(200);
    expect(findSetCookie(renewed, "hermes_session")).toContain(`Max-Age=${180 * 24 * 60 * 60}`);
    expect(findSetCookie(renewed, "hermes_device")).toContain(`hermes_device=${DEVICE_KEY_A}`);

    const again = await agent.get("/api/auth/me").expect(200);
    expect(cookieNames(again)).not.toContain("hermes_session");
  });

  it("soft-deleting a user removes their devices", async () => {
    const admin = request.agent(started!.app);
    await login(admin, { deviceKey: DEVICE_KEY_A });
    const csrf = await fetchCsrf(admin);
    const created = await admin
      .post("/api/admin/users")
      .set(CSRF_HEADER, csrf)
      .send({ username: "weg", email: "weg@example.test", role: "user" })
      .expect(201);

    const player = request.agent(started!.app);
    await login(player, { deviceName: "Persönliches Handy", deviceKey: DEVICE_KEY_B }, "weg");
    expect(devicesFor("weg")).toHaveLength(1);

    await admin.delete(`/api/admin/users/${created.body.user.id}`).set(CSRF_HEADER, csrf).expect(204);

    const sqlite = openDb();
    const count = sqlite
      .prepare("SELECT COUNT(*) AS count FROM devices WHERE user_id = ?")
      .get(created.body.user.id) as { count: number };
    sqlite.close();
    expect(count.count).toBe(0);
  });
});
