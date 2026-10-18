import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { CSRF_HEADER } from "../auth/csrf";
import { bootstrapAdmin } from "../db/bootstrap-admin";
import { createHermesApp } from "../app";

type StartedApp = Awaited<ReturnType<typeof createHermesApp>>;
type Agent = ReturnType<typeof request.agent>;

export type Actor = { agent: Agent; csrf: string; id: string };

export interface PizzaTestEnv {
  started: StartedApp;
  databasePath: string;
  admin: Actor;
  manager: Actor;
  organizer: Actor;
  guest: Actor;
  close: () => Promise<void>;
}

async function login(app: StartedApp["app"], username: string): Promise<Actor> {
  const agent = request.agent(app);
  await agent.post("/api/auth/request-code").send({ username }).expect(202);
  const response = await agent
    .post("/api/auth/verify-code")
    .send({ username, code: "123456", deviceName: "test" })
    .expect(200);
  const csrf = (await agent.get("/api/auth/csrf").expect(200)).body.token as string;
  return { agent, csrf, id: (response.body.user as { id: string }).id };
}

/** Frische Test-DB mit Pizza-Modul an, Rollen admin/manager/organizer/user (wie pizza-management.test). */
export async function startPizzaTestEnv(): Promise<PizzaTestEnv> {
  const databasePath = path.join(os.tmpdir(), `hermes-test-${randomUUID()}.sqlite`);
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
  const started = await createHermesApp();
  const admin = await login(started.app, "hauptadmin");
  const current = await admin.agent.get("/api/admin/settings").expect(200);
  await admin.agent
    .put("/api/admin/settings")
    .set(CSRF_HEADER, admin.csrf)
    .send({
      ...current.body.settings,
      featuresPizzaEnabled: true,
      pizzaPaypalHandle: "lanpizza",
      pizzaPaymentMethods: "cash_and_paypal"
    })
    .expect(200);
  const createUser = async (username: string, role: string) => {
    await admin.agent
      .post("/api/admin/users")
      .set(CSRF_HEADER, admin.csrf)
      .send({ username, email: `${username}@example.test`, role })
      .expect(201);
    return login(started.app, username);
  };
  const manager = await createUser("pizzachef", "manager");
  const organizer = await createUser("orga", "organizer");
  const guest = await createUser("gast", "user");
  return {
    started,
    databasePath,
    admin,
    manager,
    organizer,
    guest,
    close: async () => {
      await started.close();
      for (const suffix of ["", "-wal", "-shm"]) {
        fs.rmSync(`${databasePath}${suffix}`, { force: true });
      }
    }
  };
}

export function post(actor: Actor, url: string, body: unknown = {}) {
  return actor.agent.post(url).set(CSRF_HEADER, actor.csrf).send(body as object);
}

export function patch(actor: Actor, url: string, body: unknown = {}) {
  return actor.agent.patch(url).set(CSRF_HEADER, actor.csrf).send(body as object);
}

export function del(actor: Actor, url: string) {
  return actor.agent.delete(url).set(CSRF_HEADER, actor.csrf);
}

export async function pizzaState(actor: Actor) {
  return (await actor.agent.get("/api/pizza/state").expect(200)).body;
}

export async function auditActions(admin: Actor) {
  const audit = await admin.agent.get("/api/admin/audit-log").expect(200);
  return (audit.body.auditLogs as Array<{ action: string }>).map((entry) => entry.action);
}
