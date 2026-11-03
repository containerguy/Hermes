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

async function login(agent: Agent, identifier: string) {
  await agent.post("/api/auth/request-code").send({ username: identifier }).expect(202);
  const response = await agent
    .post("/api/auth/verify-code")
    .send({ username: identifier, code: "123456", deviceName: "test" })
    .expect(200);
  return response.body.user as { id: string; username: string };
}

async function adminWithCsrf() {
  const agent = request.agent(started!.app);
  await login(agent, "hauptadmin");
  const csrf = (await agent.get("/api/auth/csrf").expect(200)).body.token as string;
  return { agent, csrf };
}

async function createUser(username: string, email: string) {
  const { agent, csrf } = await adminWithCsrf();
  const response = await agent
    .post("/api/admin/users")
    .send({ username, email, role: "user" })
    .set(CSRF_HEADER, csrf);
  return response;
}

function countChallenges(username: string) {
  const sqlite = new Database(databasePath);
  try {
    const row = sqlite
      .prepare("SELECT COUNT(*) AS count FROM login_challenges WHERE username = ?")
      .get(username) as { count: number };
    return row.count;
  } finally {
    sqlite.close();
  }
}

/** Simuliert Altbestand: ein zweites Konto, das sich nur in der Schreibweise unterscheidet. */
function insertCaseTwin(sourceUsername: string, username: string, email: string) {
  const sqlite = new Database(databasePath);
  try {
    const row = sqlite.prepare("SELECT * FROM users WHERE username = ?").get(sourceUsername) as Record<
      string,
      unknown
    >;
    const id = randomUUID();
    const copy = { ...row, id, username, email, phone_number: `+49999${Date.now() % 1_000_000}` };
    const columns = Object.keys(copy);
    sqlite
      .prepare(`INSERT INTO users (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
      .run(...columns.map((column) => copy[column as keyof typeof copy] as never));
  } finally {
    sqlite.close();
  }
}

describe("login by username or email, case-insensitive", () => {
  beforeEach(
    async () => {
      databasePath = path.join(os.tmpdir(), `hermes-login-identifier-${randomUUID()}.sqlite`);
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

  it("logs in with a username typed in different case", async () => {
    await createUser("Spieler", "spieler@example.test").then((response) => expect(response.status).toBe(201));

    const user = await login(request.agent(started!.app), "sPIELER");
    expect(user.username).toBe("Spieler");
  });

  it("logs in with the email address, case-insensitive", async () => {
    await createUser("Spieler", "Spieler@Example.test").then((response) => expect(response.status).toBe(201));

    const user = await login(request.agent(started!.app), "  spieler@example.TEST ");
    expect(user.username).toBe("Spieler");
  });

  it("answers unknown identifiers neutrally and issues no code", async () => {
    await createUser("Spieler", "spieler@example.test");
    const before = countChallenges("Spieler");

    await request(started!.app)
      .post("/api/auth/request-code")
      .send({ username: "niemand@example.test" })
      .expect(202)
      .expect((response) => expect(response.body).toEqual({ ok: true }));
    await request(started!.app)
      .post("/api/auth/verify-code")
      .send({ username: "niemand@example.test", code: "123456" })
      .expect(401);
    expect(countChallenges("Spieler")).toBe(before);
  });

  it("prefers the exact match and refuses ambiguous case-only matches from legacy data", async () => {
    await createUser("Max", "max@example.test").then((response) => expect(response.status).toBe(201));
    insertCaseTwin("Max", "max", "max2@example.test");

    expect((await login(request.agent(started!.app), "Max")).username).toBe("Max");
    expect((await login(request.agent(started!.app), "max")).username).toBe("max");

    const agent = request.agent(started!.app);
    await agent.post("/api/auth/request-code").send({ username: "MAX" }).expect(202);
    await agent.post("/api/auth/verify-code").send({ username: "MAX", code: "123456" }).expect(401);
  });

  it("rejects new accounts whose username or email differs only in case", async () => {
    await createUser("Spieler", "spieler@example.test").then((response) => expect(response.status).toBe(201));

    const sameName = await createUser("SPIELER", "anders@example.test");
    expect(sameName.status).toBe(409);
    expect(sameName.body.error).toBe("username_existiert_bereits");

    const sameMail = await createUser("anders", "SPIELER@example.test");
    expect(sameMail.status).toBe(409);
    expect(sameMail.body.error).toBe("email_existiert_bereits");
  });

  it("rejects invite registrations with a case-variant of an existing username", async () => {
    await createUser("Spieler", "spieler@example.test");
    const { agent, csrf } = await adminWithCsrf();
    await agent
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
    const invite = (
      await agent.post("/api/admin/invite-codes").send({ label: "LAN" }).set(CSRF_HEADER, csrf).expect(201)
    ).body.inviteCode as { code: string };

    await request(started!.app)
      .post("/api/auth/register")
      .send({ inviteCode: invite.code, username: "spieler", email: "neu@example.test" })
      .expect(409)
      .expect((response) => expect(response.body.error).toBe("user_existiert_bereits"));
  });

  it("still lets an admin edit a legacy case-twin without touching the username", async () => {
    await createUser("Max", "max@example.test");
    insertCaseTwin("Max", "max", "max2@example.test");
    const sqlite = new Database(databasePath);
    const twin = sqlite.prepare("SELECT id FROM users WHERE username = 'max'").get() as { id: string };
    sqlite.close();

    const { agent, csrf } = await adminWithCsrf();
    const response = await agent
      .patch(`/api/admin/users/${twin.id}`)
      .send({ displayName: "Max Zwei" })
      .set(CSRF_HEADER, csrf);
    expect(response.status).toBe(200);
  });
});
