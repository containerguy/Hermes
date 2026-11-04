import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** S3 im Speicher: echter Backup- und Restore-Pfad gegen eine echte SQLite-Datei. */
const bucketObjects = new Map<string, Buffer>();

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  class FakeS3Client {
    async send(command: { input: Record<string, unknown> }) {
      const key = String(command.input.Key ?? "");
      if (command instanceof actual.PutObjectCommand) {
        const body = command.input.Body as Readable | Buffer;
        const chunks: Buffer[] = [];
        if (Buffer.isBuffer(body)) chunks.push(body);
        else for await (const chunk of body) chunks.push(Buffer.from(chunk as Buffer));
        bucketObjects.set(key, Buffer.concat(chunks));
        return {};
      }
      if (command instanceof actual.GetObjectCommand) {
        const stored = bucketObjects.get(key);
        if (!stored) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
        return { Body: { transformToByteArray: async () => new Uint8Array(stored) } };
      }
      if (command instanceof actual.ListObjectsV2Command) return { Contents: [] };
      return {};
    }
  }
  return { ...actual, S3Client: FakeS3Client };
});

const { CSRF_HEADER } = await import("../auth/csrf");
const { bootstrapAdmin } = await import("../db/bootstrap-admin");
const { createMatchdeskApp } = await import("../app");

type Agent = ReturnType<typeof request.agent>;
type Actor = { agent: Agent; csrf: string };

let started: Awaited<ReturnType<typeof createMatchdeskApp>> | undefined;
let databasePath: string;

async function actorFor(username: string): Promise<Actor> {
  const agent = request.agent(started!.app);
  await agent.post("/api/auth/request-code").send({ username }).expect(202);
  await agent.post("/api/auth/verify-code").send({ username, code: "123456", deviceName: "test" }).expect(200);
  const csrf = await agent.get("/api/auth/csrf").expect(200);
  return { agent, csrf: csrf.body.token as string };
}

function post(actor: Actor, url: string, body: unknown = {}) {
  return actor.agent.post(url).set(CSRF_HEADER, actor.csrf).send(body as object);
}

describe("Admin-Restore aus S3", () => {
  beforeEach(async () => {
    bucketObjects.clear();
    databasePath = path.join(os.tmpdir(), `matchdesk-test-${randomUUID()}.sqlite`);
    process.env.MATCHDESK_DB_PATH = databasePath;
    process.env.MATCHDESK_ADMIN_PHONE = "+491701234567";
    process.env.MATCHDESK_ADMIN_USERNAME = "hauptadmin";
    process.env.MATCHDESK_ADMIN_EMAIL = "hauptadmin@example.test";
    process.env.MATCHDESK_MAIL_MODE = "console";
    process.env.MATCHDESK_DEV_LOGIN_CODE = "123456";
    process.env.MATCHDESK_STORAGE_BACKEND = "s3";
    process.env.MATCHDESK_S3_BUCKET = "test-bucket";
    process.env.MATCHDESK_S3_DB_KEY = "hermes.sqlite";
    process.env.MATCHDESK_S3_ENDPOINT = "http://s3.invalid";
    process.env.MATCHDESK_S3_ACCESS_KEY_ID = "test-access";
    process.env.MATCHDESK_S3_SECRET_ACCESS_KEY = "test-secret";
    delete process.env.MATCHDESK_S3_CREDS_FILE;
    delete process.env.MATCHDESK_VAPID_PUBLIC_KEY;
    delete process.env.MATCHDESK_VAPID_PRIVATE_KEY;
    await bootstrapAdmin();
    started = await createMatchdeskApp();
  }, 60_000);

  afterEach(async () => {
    await started?.close();
    started = undefined;
    for (const name of [
      "MATCHDESK_STORAGE_BACKEND",
      "MATCHDESK_S3_BUCKET",
      "MATCHDESK_S3_DB_KEY",
      "MATCHDESK_S3_ENDPOINT",
      "MATCHDESK_S3_ACCESS_KEY_ID",
      "MATCHDESK_S3_SECRET_ACCESS_KEY"
    ]) {
      delete process.env[name];
    }
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  });

  it("stellt Pizza-Daten über die echte Route wieder her", async () => {
    const admin = await actorFor("hauptadmin");
    const settings = await admin.agent.get("/api/admin/settings").expect(200);
    await admin.agent
      .put("/api/admin/settings")
      .set(CSRF_HEADER, admin.csrf)
      .send({ ...settings.body.settings, featuresPizzaEnabled: true })
      .expect(200);

    await post(admin, "/api/pizza/transitions", { transition: "open", label: "Backup-Runde" }).expect(200);
    await post(admin, "/api/pizza/lines", { variantId: "v-003-30", qty: 2 }).expect(201);
    const before = (await admin.agent.get("/api/pizza/state").expect(200)).body;
    expect(before.myOrder.lines).toHaveLength(1);

    await post(admin, "/api/admin/backup").expect(200);
    // Der Auto-Snapshot überschreibt denselben Key nach jedem Schreibzugriff: Backup-Stand sichern
    const backup = Buffer.from(bucketObjects.get("hermes.sqlite")!);
    expect(backup.subarray(0, 15).toString()).toBe("SQLite format 3");

    const lineId = before.myOrder.lines[0].id as string;
    await admin.agent.delete(`/api/pizza/lines/${lineId}`).set(CSRF_HEADER, admin.csrf).expect(204);
    expect((await admin.agent.get("/api/pizza/state").expect(200)).body.myOrder.lines).toHaveLength(0);

    bucketObjects.set("hermes.sqlite", backup);
    const restored = await post(admin, "/api/admin/restore");
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);

    const after = (await admin.agent.get("/api/pizza/state").expect(200)).body;
    expect(after.session.label).toBe("Backup-Runde");
    expect(after.myOrder.lines.map((line: { id: string; qty: number }) => [line.id, line.qty])).toEqual([[lineId, 2]]);
  }, 60_000);

  it("stellt Daten installierter Module wieder her und lässt das Modul laufen", async () => {
    const { createTarGz } = await import("../modules/tar");
    const { sha256 } = await import("../modules/source-fetch");
    const pkg = createTarGz([
      {
        path: "manifest.json",
        data: JSON.stringify({
          id: "notiz",
          name: "Notiz",
          version: "1.0.0",
          matchdeskApi: 1,
          server: "server.mjs",
          tables: ["notiz_items"],
          settings: { type: "object", properties: { titel: { type: "string", default: "A" } } }
        })
      },
      {
        path: "server.mjs",
        data: `export function register(ctx) {
          ctx.router.get("/items", (_q, r) => r.json({ items: ctx.db.prepare("SELECT id FROM notiz_items ORDER BY id").all().map((x) => x.id) }));
          ctx.router.post("/items", (q, r) => { if (!ctx.requireWrite(q, r)) return; ctx.db.prepare("INSERT INTO notiz_items (id) VALUES (?)").run(q.body.id); r.status(201).json({}); });
          ctx.router.delete("/items/:id", (q, r) => { if (!ctx.requireWrite(q, r)) return; ctx.db.prepare("DELETE FROM notiz_items WHERE id = ?").run(q.params.id); r.status(204).end(); });
        }`
      },
      { path: "migrations/0001_init.sql", data: "CREATE TABLE notiz_items (id TEXT PRIMARY KEY);" }
    ]);
    const hosted = new Map<string, Buffer>([
      ["https://notiz.example.test/notiz-1.0.0.tgz", pkg],
      [
        "https://notiz.example.test/matchdesk-source.json",
        Buffer.from(
          JSON.stringify({
            matchdeskSource: 1,
            modules: [{ id: "notiz", name: "Notiz", versions: [{ version: "1.0.0", matchdeskApi: 1, url: "notiz-1.0.0.tgz", sha256: sha256(pkg) }] }]
          })
        )
      ]
    ]);
    await started?.close();
    started = await createMatchdeskApp({
      modules: {
        modulesDir: `${databasePath}-modules`,
        fetch: async (url) => {
          const body = hosted.get(url);
          return { ok: Boolean(body), status: body ? 200 : 404, arrayBuffer: async () => new Uint8Array(body ?? []).buffer };
        }
      }
    });
    const admin = await actorFor("hauptadmin");
    const source = await post(admin, "/api/admin/modules/sources", { name: "Notiz", url: "https://notiz.example.test" }).expect(200);
    await post(admin, "/api/admin/modules/install", { sourceId: source.body.source.id, moduleId: "notiz", confirm: true }).expect(200);
    await post(admin, "/api/admin/modules/notiz/enable").expect(200);
    await post(admin, "/api/m/notiz/items", { id: "eins" }).expect(201);

    await post(admin, "/api/admin/backup").expect(200);
    const backup = Buffer.from(bucketObjects.get("hermes.sqlite")!);
    await admin.agent.delete("/api/m/notiz/items/eins").set(CSRF_HEADER, admin.csrf).expect(204);
    await admin.agent
      .put("/api/admin/modules/notiz/settings")
      .set(CSRF_HEADER, admin.csrf)
      .send({ settings: { titel: "B" } })
      .expect(200);

    bucketObjects.set("hermes.sqlite", backup);
    const restored = await post(admin, "/api/admin/restore");
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect((await admin.agent.get("/api/m/notiz/items").expect(200)).body.items).toEqual(["eins"]);
    expect((await admin.agent.get("/api/admin/modules/notiz/settings").expect(200)).body.settings).toEqual({ titel: "A" });
    const status = (await admin.agent.get("/api/admin/modules/notiz").expect(200)).body.module;
    expect(status).toEqual(expect.objectContaining({ state: "enabled", running: true }));
    fs.rmSync(`${databasePath}-modules`, { recursive: true, force: true });
  }, 60_000);
});
