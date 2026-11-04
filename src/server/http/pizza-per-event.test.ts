import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { del, post, startPizzaTestEnv, type PizzaTestEnv } from "./pizza-test-helpers";

let env: PizzaTestEnv;

beforeEach(async () => {
  env = await startPizzaTestEnv();
}, 30_000);

afterEach(async () => {
  await env.close();
});

async function createRunningEvent(name: string) {
  const created = await post(env.admin, "/api/main-events", { name }).expect(201);
  const id = created.body.mainEvent.id as string;
  await post(env.admin, `/api/main-events/${id}/start`).expect(200);
  return id;
}

describe("Pizza-Bestellrunden pro Event", () => {
  it("keeps one current round per event and one without event", async () => {
    const lan = await createRunningEvent("LAN Herbst");
    await post(env.manager, `/api/pizza/transitions?mainEventId=${lan}`, { transition: "open" }).expect(200);

    const lanState = (await env.manager.agent.get(`/api/pizza/state?mainEventId=${lan}`).expect(200)).body;
    expect(lanState).toMatchObject({ mainEventId: lan, mainEventName: "LAN Herbst", canManage: true });
    expect(lanState.session.state).toBe("open");

    // Die Runde ohne Event ist davon unberührt.
    const none = (await env.manager.agent.get("/api/pizza/state?mainEventId=none").expect(200)).body;
    expect(none.session).toBeNull();
    await post(env.manager, "/api/pizza/transitions?mainEventId=none", { transition: "open" }).expect(200);
    const noneAfter = (await env.manager.agent.get("/api/pizza/state").expect(200)).body;
    expect(noneAfter.mainEventId).toBeNull();
    expect(noneAfter.session.id).not.toBe(lanState.session.id);
  });

  it("lets only participants order in an event round", async () => {
    const lan = await createRunningEvent("LAN Herbst");
    await post(env.manager, `/api/pizza/transitions?mainEventId=${lan}`, { transition: "open" }).expect(200);

    const before = (await env.guest.agent.get(`/api/pizza/state?mainEventId=${lan}`).expect(200)).body;
    expect(before.canOrder).toBe(false);
    const refused = await post(env.guest, `/api/pizza/lines?mainEventId=${lan}`, { variantId: "v-001-30", qty: 1 });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("pizza_nur_teilnehmer");

    await post(env.guest, `/api/main-events/${lan}/participation`, { status: "joined" }).expect(200);
    await post(env.guest, `/api/pizza/lines?mainEventId=${lan}`, { variantId: "v-001-30", qty: 1 }).expect(201);
    const after = (await env.guest.agent.get(`/api/pizza/state?mainEventId=${lan}`).expect(200)).body;
    expect(after.canOrder).toBe(true);
    expect(after.myOrder.lines).toHaveLength(1);

    // Die Runde ohne Event bekommt die Bestellung nicht.
    await post(env.manager, "/api/pizza/transitions?mainEventId=none", { transition: "open" }).expect(200);
    const none = (await env.guest.agent.get("/api/pizza/state?mainEventId=none").expect(200)).body;
    expect(none.myOrder).toBeNull();
  });

  it("uses the current event from the global switcher when no event is given", async () => {
    const lan = await createRunningEvent("LAN Herbst");
    await env.manager.agent
      .put("/api/main-events/current")
      .set("X-Matchdesk-CSRF", env.manager.csrf)
      .send({ mainEventId: lan })
      .expect(200);
    await post(env.manager, "/api/pizza/transitions", { transition: "open" }).expect(200);
    const state = (await env.manager.agent.get(`/api/pizza/state?mainEventId=${lan}`).expect(200)).body;
    expect(state.session.state).toBe("open");
  });

  it("lets an event-only pizza manager run just that event's round", async () => {
    const lan = await createRunningEvent("LAN Herbst");
    const cup = await createRunningEvent("Turnier");
    await post(env.admin, `/api/admin/users/${env.guest.id}/grants`, { permissionKey: "pizza.manage", mainEventId: lan }).expect(201);

    await post(env.guest, `/api/pizza/transitions?mainEventId=${lan}`, { transition: "open" }).expect(200);
    await post(env.guest, `/api/pizza/transitions?mainEventId=${cup}`, { transition: "open" }).expect(403);
    await post(env.guest, "/api/pizza/transitions?mainEventId=none", { transition: "open" }).expect(403);
    await env.guest.agent.get("/api/pizza/admin/menu").expect(403);

    await post(env.guest, `/api/pizza/lines?mainEventId=${lan}`, { variantId: "v-001-30", qty: 1 }).expect(201);
    await post(env.guest, `/api/pizza/transitions?mainEventId=${lan}`, { transition: "lock" }).expect(200);
    const state = (await env.guest.agent.get(`/api/pizza/state?mainEventId=${lan}`).expect(200)).body;
    await post(env.guest, `/api/pizza/orders/${state.myOrder.id}/payment`, { method: "cash" }).expect(204);
    await env.guest.agent.get(`/api/pizza/print/kassenliste.pdf?mainEventId=${lan}`).expect(200);
    await env.guest.agent.get(`/api/pizza/print/kassenliste.pdf?mainEventId=${cup}`).expect(403);

    await post(env.guest, `/api/pizza/sessions/${state.session.id}/archive`).expect(200);
    const archived = (await env.guest.agent.get("/api/pizza/sessions/archived").expect(200)).body.sessions;
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ mainEventId: lan, mainEventName: "LAN Herbst" });
    await del(env.guest, `/api/pizza/sessions/${state.session.id}`).expect(204);
  });

  it("refuses unknown events and opening a round for an ended event", async () => {
    await env.manager.agent.get("/api/pizza/state?mainEventId=gibt-es-nicht").expect(404);
    const lan = await createRunningEvent("LAN Herbst");
    await post(env.admin, `/api/main-events/${lan}/end`).expect(200);
    const refused = await post(env.manager, `/api/pizza/transitions?mainEventId=${lan}`, { transition: "open" });
    expect(refused.status).toBe(409);
  });
});
