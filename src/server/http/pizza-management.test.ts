import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
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
  const response = await agent
    .post("/api/auth/verify-code")
    .send({ username, code: "123456", deviceName: "test" })
    .expect(200);
  return response.body.user as { id: string; role: string };
}

async function fetchCsrf(agent: Agent) {
  const response = await agent.get("/api/auth/csrf").expect(200);
  return response.body.token as string;
}

type Actor = { agent: Agent; csrf: string; id: string };

async function actorFor(username: string): Promise<Actor> {
  const agent = request.agent(started!.app);
  const user = await login(agent, username);
  return { agent, csrf: await fetchCsrf(agent), id: user.id };
}

async function updateSettings(admin: Actor, patch: Record<string, unknown>) {
  const current = await admin.agent.get("/api/admin/settings").expect(200);
  await admin.agent
    .put("/api/admin/settings")
    .set(CSRF_HEADER, admin.csrf)
    .send({ ...current.body.settings, ...patch })
    .expect(200);
}

async function createUser(admin: Actor, username: string, role: string) {
  await admin.agent
    .post("/api/admin/users")
    .set(CSRF_HEADER, admin.csrf)
    .send({ username, email: `${username}@example.test`, role })
    .expect(201);
  return actorFor(username);
}

function post(actor: Actor, url: string, body: unknown = {}) {
  return actor.agent.post(url).set(CSRF_HEADER, actor.csrf).send(body as object);
}

async function state(actor: Actor) {
  const response = await actor.agent.get("/api/pizza/state").expect(200);
  return response.body;
}

describe("Pizza-Verwaltung ab manager", () => {
  let admin: Actor;
  let manager: Actor;
  let organizer: Actor;
  let guest: Actor;

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

    admin = await actorFor("hauptadmin");
    await updateSettings(admin, {
      featuresPizzaEnabled: true,
      pizzaPaypalHandle: "lanpizza",
      pizzaPaymentMethods: "cash_and_paypal"
    });
    manager = await createUser(admin, "pizzachef", "manager");
    organizer = await createUser(admin, "orga", "organizer");
    guest = await createUser(admin, "gast", "user");
  }, 60_000);

  afterEach(async () => {
    await started?.close();
    started = undefined;
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  });

  it("erlaubt Menüpflege und Archiv nur ab manager", async () => {
    for (const actor of [guest, organizer]) {
      await actor.agent.get("/api/pizza/admin/menu").expect(403);
      await post(actor, "/api/pizza/admin/items", { name: "Test", category: "pizza" }).expect(403);
      await post(actor, "/api/pizza/admin/variants", {
        itemId: "pi-001",
        sizeLabel: "30cm",
        priceCents: 100
      }).expect(403);
      await actor.agent.delete("/api/pizza/admin/variants/v-001-30").set(CSRF_HEADER, actor.csrf).expect(403);
      await actor.agent.get("/api/pizza/sessions/archived").expect(403);
      await post(actor, "/api/pizza/transitions", { transition: "open" }).expect(403);
    }

    const menu = await manager.agent.get("/api/pizza/admin/menu").expect(200);
    expect(menu.body.items.length).toBeGreaterThan(0);
    const created = await post(manager, "/api/pizza/admin/items", {
      number: "99",
      name: "Hausspezial",
      category: "pizza"
    }).expect(200);
    await post(manager, "/api/pizza/admin/variants", {
      itemId: created.body.id,
      sizeLabel: "30cm",
      priceCents: 1100
    }).expect(200);
    await manager.agent.get("/api/pizza/sessions/archived").expect(200);

    const audit = await admin.agent.get("/api/admin/audit-log").expect(200);
    const actions = (audit.body.auditLogs as Array<{ action: string }>).map((entry) => entry.action);
    expect(actions).toContain("pizza.menu.item.create");
    expect(actions).toContain("pizza.menu.variant.create");
  });

  it("verlangt CSRF für schreibende Pizza-Routen", async () => {
    await manager.agent.post("/api/pizza/transitions").send({ transition: "open" }).expect(403);
    await guest.agent.post("/api/pizza/lines").send({ variantId: "v-001-30", qty: 1 }).expect(403);
  });

  it("behält Preis-Snapshots und deaktiviert referenzierte Varianten statt sie zu löschen", async () => {
    await post(manager, "/api/pizza/transitions", { transition: "open" }).expect(200);
    await post(guest, "/api/pizza/lines", { variantId: "v-001-30", qty: 2 }).expect(201);

    // Preis ändern: bestehende Zeile behält 7,00 €
    await post(manager, "/api/pizza/admin/variants", {
      id: "v-001-30",
      itemId: "pi-001",
      sizeLabel: "30cm",
      priceCents: 900
    }).expect(200);
    let current = await state(guest);
    expect(current.myOrder.lines[0].priceCentsSnapshot).toBe(700);
    expect(current.guestTotals[0].totalCents).toBe(1400);

    // Referenzierte Variante "entfernen" → deaktiviert, Bestellung bleibt vollständig
    const removed = await manager.agent
      .delete("/api/pizza/admin/variants/v-001-30")
      .set(CSRF_HEADER, manager.csrf)
      .expect(200);
    expect(removed.body.result).toBe("deactivated");
    current = await state(guest);
    expect(current.myOrder.lines[0]).toMatchObject({
      variantId: "v-001-30",
      priceCentsSnapshot: 700,
      itemName: "Margherita",
      sizeLabel: "30cm"
    });
    const margherita = current.menu.find((item: { id: string }) => item.id === "pi-001");
    expect(margherita.variants.map((variant: { id: string }) => variant.id)).not.toContain("v-001-30");
    await post(guest, "/api/pizza/lines", { variantId: "v-001-30", qty: 1 }).expect(404);

    // Nicht referenzierte Variante wird wirklich gelöscht
    const deleted = await manager.agent
      .delete("/api/pizza/admin/variants/v-001-45")
      .set(CSRF_HEADER, manager.csrf)
      .expect(200);
    expect(deleted.body.result).toBe("deleted");

    // Artikel mit Bestellhistorie → deaktiviert; ohne Historie → gelöscht
    const itemRemoved = await manager.agent
      .delete("/api/pizza/admin/items/pi-001")
      .set(CSRF_HEADER, manager.csrf)
      .expect(200);
    expect(itemRemoved.body.result).toBe("deactivated");
    const itemDeleted = await manager.agent
      .delete("/api/pizza/admin/items/pi-002")
      .set(CSRF_HEADER, manager.csrf)
      .expect(200);
    expect(itemDeleted.body.result).toBe("deleted");
    const all = await manager.agent.get("/api/pizza/admin/menu").expect(200);
    const ids = (all.body.items as Array<{ id: string; active: boolean }>).map((item) => item.id);
    expect(ids).toContain("pi-001");
    expect(ids).not.toContain("pi-002");

    // Variante reaktivieren
    await post(manager, "/api/pizza/admin/variants/v-001-30/active", { active: true }).expect(204);
    await post(manager, "/api/pizza/admin/items/pi-001/active", { active: true }).expect(204);
    current = await state(guest);
    expect(
      current.menu
        .find((item: { id: string }) => item.id === "pi-001")
        .variants.map((variant: { id: string; priceCents: number }) => [variant.id, variant.priceCents])
    ).toContainEqual(["v-001-30", 900]);
  });

  it("archiviert eine Runde und beginnt danach eine leere neue Runde", async () => {
    await post(manager, "/api/pizza/transitions", { transition: "open", label: "Freitag" }).expect(200);
    await post(guest, "/api/pizza/lines", { variantId: "v-003-30", qty: 1 }).expect(201);
    await post(manager, "/api/pizza/transitions", { transition: "lock" }).expect(200);
    await post(manager, "/api/pizza/transitions", { transition: "deliver" }).expect(200);
    // Doppelklick: zweites „deliver“ scheitert, ohne die Runde zu archivieren oder einen Entwurf anzulegen
    await post(manager, "/api/pizza/transitions", { transition: "deliver" }).expect(409);

    let current = await state(guest);
    const firstSessionId = current.session.id as string;
    expect(current.session.state).toBe("delivered");
    expect(current.orders).toHaveLength(1);

    await post(guest, `/api/pizza/sessions/${firstSessionId}/archive`).expect(403);
    await post(organizer, `/api/pizza/sessions/${firstSessionId}/archive`).expect(403);
    await post(manager, `/api/pizza/sessions/${firstSessionId}/archive`).expect(200);
    await post(manager, `/api/pizza/sessions/${firstSessionId}/archive`).expect(409);

    current = await state(guest);
    expect(current.session).toBeNull();
    expect(current.orders).toEqual([]);
    expect(current.myOrder).toBeNull();

    const archived = await manager.agent.get("/api/pizza/sessions/archived").expect(200);
    expect(archived.body.sessions).toHaveLength(1);
    expect(archived.body.sessions[0]).toMatchObject({
      id: firstSessionId,
      label: "Freitag",
      state: "delivered",
      orderCount: 1,
      unpaidCount: 1,
      totalCents: 700
    });

    // Kassenliste einer archivierten Runde bleibt abrufbar
    const pdf = await manager.agent
      .get(`/api/pizza/print/kassenliste.pdf?sessionId=${firstSessionId}`)
      .expect(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");

    // Neue Runde ist leer
    await post(manager, "/api/pizza/transitions", { transition: "open" }).expect(200);
    current = await state(guest);
    expect(current.session.id).not.toBe(firstSessionId);
    expect(current.session.state).toBe("open");
    expect(current.orders).toEqual([]);

    // Laufende Runde kann nicht endgültig gelöscht werden, archivierte schon
    await manager.agent
      .delete(`/api/pizza/sessions/${current.session.id}`)
      .set(CSRF_HEADER, manager.csrf)
      .expect(409);
    await organizer.agent
      .delete(`/api/pizza/sessions/${firstSessionId}`)
      .set(CSRF_HEADER, organizer.csrf)
      .expect(403);
    await manager.agent
      .delete(`/api/pizza/sessions/${firstSessionId}`)
      .set(CSRF_HEADER, manager.csrf)
      .expect(204);
    const afterDelete = await manager.agent.get("/api/pizza/sessions/archived").expect(200);
    expect(afterDelete.body.sessions).toEqual([]);

    // Variante aus gelöschter Runde ist nicht mehr referenziert und kann gelöscht werden
    const removed = await manager.agent
      .delete("/api/pizza/admin/variants/v-003-30")
      .set(CSRF_HEADER, manager.csrf)
      .expect(200);
    expect(removed.body.result).toBe("deleted");

    const audit = await admin.agent.get("/api/admin/audit-log").expect(200);
    const actions = (audit.body.auditLogs as Array<{ action: string }>).map((entry) => entry.action);
    expect(actions).toContain("pizza.session.archive");
    expect(actions).toContain("pizza.session.delete");
  });

  it("archiviert eine gelieferte Runde automatisch beim Öffnen einer neuen", async () => {
    await post(manager, "/api/pizza/transitions", { transition: "open" }).expect(200);
    await post(guest, "/api/pizza/lines", { variantId: "v-003-30", qty: 1 }).expect(201);
    await post(manager, "/api/pizza/transitions", { transition: "lock" }).expect(200);
    await post(manager, "/api/pizza/transitions", { transition: "deliver" }).expect(200);
    await post(manager, "/api/pizza/transitions", { transition: "open" }).expect(200);

    const current = await state(guest);
    expect(current.session.state).toBe("open");
    expect(current.orders).toEqual([]);
    const archived = await manager.agent.get("/api/pizza/sessions/archived").expect(200);
    expect(archived.body.sessions).toHaveLength(1);
  });

  it("lässt Gäste Bargeld oder PayPal wählen und respektiert das Setting", async () => {
    await post(manager, "/api/pizza/transitions", { transition: "open" }).expect(200);
    let current = await state(guest);
    expect(current.paymentMethods).toEqual(["cash", "paypal"]);

    await post(guest, "/api/pizza/orders/mine/payment-method", { method: "cash" }).expect(404);
    await post(guest, "/api/pizza/lines", { variantId: "v-003-30", qty: 1 }).expect(201);
    current = await state(guest);
    expect(current.myOrder.paymentMethod).toBeNull();

    await post(guest, "/api/pizza/orders/mine/payment-method", { method: "cash" }).expect(204);
    current = await state(guest);
    expect(current.myOrder.paymentMethod).toBe("cash");
    expect(current.orders[0].paymentMethod).toBe("cash");
    await post(guest, "/api/pizza/orders/mine/payment-method", { method: "paypal" }).expect(204);
    await post(guest, "/api/pizza/orders/mine/payment-method", { method: "bitcoin" }).expect(400);

    // Nur Bargeld: PayPal nicht mehr wählbar, neue Bestellungen sind vorausgewählt
    await updateSettings(admin, { pizzaPaymentMethods: "cash_only" });
    current = await state(manager);
    expect(current.paymentMethods).toEqual(["cash"]);
    await post(guest, "/api/pizza/orders/mine/payment-method", { method: "paypal" }).expect(400);
    await post(manager, "/api/pizza/lines", { variantId: "v-004-30", qty: 1 }).expect(201);
    current = await state(manager);
    expect(current.myOrder.paymentMethod).toBe("cash");

    // Ohne PayPal-Handle wird PayPal auch bei "beides" nicht angeboten
    await updateSettings(admin, { pizzaPaymentMethods: "cash_and_paypal", pizzaPaypalHandle: "" });
    current = await state(guest);
    expect(current.paymentMethods).toEqual(["cash"]);

    // Bezahlt markieren ab manager; danach keine Änderung der Bezahlart durch den Gast
    await post(manager, "/api/pizza/transitions", { transition: "lock" }).expect(200);
    const guestOrderId = current.myOrder.id as string;
    await post(organizer, `/api/pizza/orders/${guestOrderId}/payment`, { method: "cash" }).expect(403);
    await post(manager, `/api/pizza/orders/${guestOrderId}/payment`, { method: "cash" }).expect(204);
    current = await state(guest);
    expect(current.myOrder).toMatchObject({ paymentStatus: "paid_cash", paymentMethod: "cash" });
    await post(guest, "/api/pizza/orders/mine/payment-method", { method: "cash" }).expect(409);

    const pdf = await manager.agent.get("/api/pizza/print/kassenliste.pdf").expect(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
  });

  it("lässt manager die Bezahlarten im Pizza-Panel ändern, aber keine anderen Einstellungen", async () => {
    const put = (actor: Actor, body: unknown) =>
      actor.agent.put("/api/pizza/payment-mode").set(CSRF_HEADER, actor.csrf).send(body as object);

    expect((await state(manager)).paymentMode).toBe("cash_and_paypal");
    await put(guest, { pizzaPaymentMethods: "cash_only" }).expect(403);
    await put(organizer, { pizzaPaymentMethods: "cash_only" }).expect(403);
    await manager.agent.put("/api/pizza/payment-mode").send({ pizzaPaymentMethods: "cash_only" }).expect(403);
    await put(manager, { pizzaPaymentMethods: "bitcoin" }).expect(400);

    const before = (await admin.agent.get("/api/admin/settings").expect(200)).body.settings;
    const changed = await put(manager, { pizzaPaymentMethods: "cash_only", appName: "Gekapert" }).expect(200);
    expect(changed.body).toEqual({ paymentMode: "cash_only", paymentMethods: ["cash"] });
    const after = (await admin.agent.get("/api/admin/settings").expect(200)).body.settings;
    expect(after).toEqual({ ...before, pizzaPaymentMethods: "cash_only" });
    expect((await state(guest)).paymentMethods).toEqual(["cash"]);

    // Admin-Einstellungen bleiben für manager gesperrt
    await manager.agent.put("/api/admin/settings").set(CSRF_HEADER, manager.csrf).send(after).expect(403);

    const audit = await admin.agent.get("/api/admin/audit-log").expect(200);
    const entry = (audit.body.auditLogs as Array<{ action: string; metadata: unknown }>).find(
      (log) => log.action === "pizza.payment_mode"
    );
    expect(entry?.metadata).toEqual({ from: "cash_and_paypal", to: "cash_only" });
  });
});
