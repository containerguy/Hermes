import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CSRF_HEADER } from "../auth/csrf";
import { bootstrapAdmin } from "../db/bootstrap-admin";
import { createMatchdeskApp } from "../app";
import { bundledModulesDir } from "../modules/bundled";

type StartedApp = Awaited<ReturnType<typeof createMatchdeskApp>>;

let started: StartedApp | undefined;
let databasePath: string;
let modulesDir: string;

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

describe("Spielt gerade (presence)", () => {
  beforeEach(
    async () => {
      databasePath = path.join(os.tmpdir(), `matchdesk-test-${randomUUID()}.sqlite`);
      process.env.MATCHDESK_DB_PATH = databasePath;
      process.env.MATCHDESK_ADMIN_PHONE = "+491701234567";
      process.env.MATCHDESK_ADMIN_USERNAME = "hauptadmin";
      process.env.MATCHDESK_ADMIN_EMAIL = "hauptadmin@example.test";
      process.env.MATCHDESK_MAIL_MODE = "console";
      process.env.MATCHDESK_DEV_LOGIN_CODE = "123456";
      delete process.env.MATCHDESK_STORAGE_BACKEND;
      delete process.env.MATCHDESK_VAPID_PUBLIC_KEY;
      delete process.env.MATCHDESK_VAPID_PRIVATE_KEY;
      await bootstrapAdmin();
      modulesDir = fs.mkdtempSync(path.join(os.tmpdir(), "matchdesk-modules-"));
      started = await createMatchdeskApp({ modules: { modulesDir } });
    },
    30_000
  );

  afterEach(async () => {
    await started?.close();
    started = undefined;
    fs.rmSync(modulesDir, { recursive: true, force: true });

    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  });

  /**
   * „Spielt gerade“ ist seit 0.17 ein Modul: einschalten = aus dem eingebauten Startpaket
   * installieren bzw. wieder einschalten, ausschalten = Modul abschalten. Die Tests laufen über die
   * alten Pfade /api/presence, die der Kern auf /api/m/presence umschreibt.
   */
  async function enablePresence(agent: ReturnType<typeof request.agent>, csrf: string, enabled: boolean) {
    if (enabled && !started!.modules.getModule("presence")) {
      await started!.modules.installBundled(fs.readFileSync(path.join(bundledModulesDir(), "presence-1.0.0.tgz")));
      return;
    }
    await agent
      .post(`/api/admin/modules/presence/${enabled ? "enable" : "disable"}`)
      .set(CSRF_HEADER, csrf)
      .expect(200);
  }

  it("is hidden while the feature is off", async () => {
    const admin = request.agent(started!.app);
    await login(admin, "hauptadmin");
    await admin.get("/api/presence").expect(404);
    await admin.get("/api/m/presence").expect(404);
  });

  it("accepts agent reports with a full API token and lists them for logged-in users", async () => {
    const admin = request.agent(started!.app);
    await login(admin, "hauptadmin");
    const csrf = await fetchCsrf(admin);
    await enablePresence(admin, csrf, true);

    const full = await admin
      .post("/api/auth/api-tokens")
      .set(CSRF_HEADER, csrf)
      .send({ scope: "full", label: "game-agent" })
      .expect(201);
    const token = full.body.token as string;

    await request(started!.app).get("/api/presence").expect(401);
    await request(started!.app).post("/api/presence/game").send({ playing: [] }).expect(401);

    await request(started!.app)
      .post("/api/presence/game")
      .set("Authorization", `Bearer ${token}`)
      .send({
        host: "DESKTOP-M4PJL0I",
        playing: [{ title: "Counter-Strike 2", launcher: "steam", appId: "730", exe: "", source: "steam-registry" }]
      })
      .expect(204);

    const list = await admin.get("/api/presence").expect(200);
    expect(list.body.players).toHaveLength(1);
    expect(list.body.players[0]).toMatchObject({
      username: "hauptadmin",
      games: [{ title: "Counter-Strike 2", launcher: "steam", appId: "730" }]
    });
    expect(JSON.stringify(list.body)).not.toContain("DESKTOP");

    await request(started!.app)
      .post("/api/presence/game")
      .set("Authorization", `Bearer ${token}`)
      .send({ playing: "kaputt" })
      .expect(400);

    await request(started!.app).delete("/api/presence/game").set("Authorization", `Bearer ${token}`).expect(204);
    const after = await admin.get("/api/presence").expect(200);
    expect(after.body.players).toEqual([]);
    // Das Startpaket bringt den Windows-Agenten mit.
    expect(after.body.agentAvailable).toBe(true);
    const download = await admin.get("/api/presence/agent/download").expect(200);
    expect(download.headers["content-disposition"]).toContain("matchdesk-game-agent.exe");
  });

  it("rejects read-only tokens and session writes without CSRF", async () => {
    const admin = request.agent(started!.app);
    await login(admin, "hauptadmin");
    const csrf = await fetchCsrf(admin);
    await enablePresence(admin, csrf, true);

    const ro = await admin
      .post("/api/auth/api-tokens")
      .set(CSRF_HEADER, csrf)
      .send({ scope: "read_only" })
      .expect(201);

    await request(started!.app)
      .post("/api/presence/game")
      .set("Authorization", `Bearer ${ro.body.token}`)
      .send({ playing: [{ title: "Valheim", launcher: "steam" }] })
      .expect(403);
    await request(started!.app)
      .get("/api/presence")
      .set("Authorization", `Bearer ${ro.body.token}`)
      .expect(200);

    await admin.post("/api/presence/game").send({ playing: [] }).expect(403);
    await admin.post("/api/presence/game").set(CSRF_HEADER, csrf).send({ playing: [] }).expect(204);
  });

  it("issues an agent key that only works for reporting games", async () => {
    const admin = request.agent(started!.app);
    await login(admin, "hauptadmin");
    const csrf = await fetchCsrf(admin);
    await enablePresence(admin, csrf, true);

    await admin.post("/api/presence/agent-key").expect(403); // ohne CSRF
    const first = await admin.post("/api/presence/agent-key").set(CSRF_HEADER, csrf).expect(201);
    const key = first.body.key as string;
    expect(key.startsWith("md_ga_")).toBe(true);

    await request(started!.app)
      .post("/api/presence/game")
      .set("Authorization", `Bearer ${key}`)
      .send({ playing: [{ title: "Valheim", launcher: "steam", appId: "892970" }] })
      .expect(204);
    const list = await admin.get("/api/presence").expect(200);
    expect(list.body.players[0].games[0].title).toBe("Valheim");
    expect(list.body.agentKey.createdAt).toBe(first.body.createdAt);
    expect(list.body.agentKey.lastUsedAt).toBeTruthy();

    // Nur /game: alles andere sieht den Schlüssel nicht als Anmeldung.
    await request(started!.app).get("/api/presence").set("Authorization", `Bearer ${key}`).expect(401);
    await request(started!.app).get("/api/events").set("Authorization", `Bearer ${key}`).expect(401);
    await request(started!.app).post("/api/presence/agent-key").set("Authorization", `Bearer ${key}`).expect(401);

    // Neuer Schlüssel macht den alten ungültig.
    const second = await admin.post("/api/presence/agent-key").set(CSRF_HEADER, csrf).expect(201);
    await request(started!.app)
      .post("/api/presence/game")
      .set("Authorization", `Bearer ${key}`)
      .send({ playing: [] })
      .expect(401);

    // Widerrufen entfernt auch den Eintrag.
    await admin.delete("/api/presence/agent-key").set(CSRF_HEADER, csrf).expect(204);
    await request(started!.app)
      .delete("/api/presence/game")
      .set("Authorization", `Bearer ${second.body.key}`)
      .expect(401);
    const after = await admin.get("/api/presence").expect(200);
    expect(after.body.players).toEqual([]);
    expect(after.body.agentKey).toBeNull();

    // Abgeschaltet: auch der Agent bekommt 404.
    const third = await admin.post("/api/presence/agent-key").set(CSRF_HEADER, csrf).expect(201);
    await enablePresence(admin, csrf, false);
    await request(started!.app)
      .post("/api/presence/game")
      .set("Authorization", `Bearer ${third.body.key}`)
      .send({ playing: [] })
      .expect(404);
  });

  it("takes over the Steam account from the agent and lets users maintain the rest", async () => {
    const admin = request.agent(started!.app);
    await login(admin, "hauptadmin");
    const csrf = await fetchCsrf(admin);
    await enablePresence(admin, csrf, true);
    const { body } = await admin.post("/api/presence/agent-key").set(CSRF_HEADER, csrf).expect(201);
    const report = (steamAccount: unknown) =>
      request(started!.app)
        .post("/api/presence/game")
        .set("Authorization", `Bearer ${body.key}`)
        .send({ playing: [], steamAccount })
        .expect(204);

    const empty = await admin.get("/api/presence/accounts/me").expect(200);
    expect(empty.body.missing).toEqual(["steam", "ea", "battlenet", "epic", "ubisoft"]);
    expect(empty.body.promptDismissed).toBe(false);

    // Kein Steam-Konto hinterlegt: automatisch übernommen. Ungültige Angaben stören den Bericht nicht.
    await report({ steamId: "nope" });
    await report({ steamId: "76561198000000001", personaName: "René" });
    let me = await admin.get("/api/presence/accounts/me").expect(200);
    expect(me.body.accounts.steam).toEqual({ accountId: "76561198000000001", displayName: "René", source: "agent" });

    // Anderes Konto auf dem PC: nur Vorschlag, bis man „übernehmen“ drückt.
    await report({ steamId: "76561198000000002", personaName: "Zweitkonto" });
    me = await admin.get("/api/presence/accounts/me").expect(200);
    expect(me.body.accounts.steam.accountId).toBe("76561198000000001");
    expect(me.body.accounts.steam.pending).toEqual({ accountId: "76561198000000002", displayName: "Zweitkonto" });
    await admin.post("/api/presence/accounts/me/steam/accept").expect(403);
    me = await admin.post("/api/presence/accounts/me/steam/accept").set(CSRF_HEADER, csrf).expect(200);
    expect(me.body.accounts.steam).toEqual({ accountId: "76561198000000002", displayName: "Zweitkonto", source: "agent" });
    await admin.post("/api/presence/accounts/me/steam/accept").set(CSRF_HEADER, csrf).expect(404);

    // Rest manuell; Steam auch als Profil-Link.
    await admin
      .put("/api/presence/accounts/me")
      .set(CSRF_HEADER, csrf)
      .send({ steam: "kein-link" })
      .expect(400, { error: "steam_id_ungueltig" });
    me = await admin
      .put("/api/presence/accounts/me")
      .set(CSRF_HEADER, csrf)
      .send({ steam: "https://steamcommunity.com/profiles/76561198000000003/", battlenet: "Rene#2345", ea: "  " })
      .expect(200);
    expect(me.body.accounts.steam).toEqual({ accountId: "76561198000000003", displayName: null, source: "manual" });
    expect(me.body.accounts.battlenet.accountId).toBe("Rene#2345");
    expect(me.body.missing).toEqual(["ea", "epic", "ubisoft"]);

    await admin.post("/api/presence/accounts/me/prompt-dismiss").set(CSRF_HEADER, csrf).expect(204);
    me = await admin.get("/api/presence/accounts/me").expect(200);
    expect(me.body.promptDismissed).toBe(true);

    const all = await admin.get("/api/presence/accounts").expect(200);
    expect(all.body.users).toHaveLength(1);
    expect(all.body.users[0].username).toBe("hauptadmin");
    expect(all.body.users[0].accounts.battlenet).toEqual({ accountId: "Rene#2345", displayName: null });

    // Der Agent-Schlüssel reicht nicht für die Spielkonten.
    await request(started!.app).get("/api/presence/accounts/me").set("Authorization", `Bearer ${body.key}`).expect(401);
    await enablePresence(admin, csrf, false);
    await admin.get("/api/presence/accounts").expect(404);
  });
});
