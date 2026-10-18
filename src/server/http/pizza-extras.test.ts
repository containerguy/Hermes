import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  auditActions,
  del,
  patch,
  pizzaState,
  post,
  startPizzaTestEnv,
  type Actor,
  type PizzaTestEnv
} from "./pizza-test-helpers";

let env: PizzaTestEnv;

beforeEach(async () => {
  env = await startPizzaTestEnv();
}, 60_000);

afterEach(async () => {
  await env.close();
});

async function createExtra(actor: Actor, name: string, priceCents: number, categoryIds = ["cat-pizza"]) {
  const response = await post(actor, "/api/pizza/admin/extras", { name, priceCents, categoryIds }).expect(200);
  return response.body.id as string;
}

describe("Pizza-Extras – Pflege", () => {
  it("erlaubt die Pflege nur ab manager, mit CSRF und Validierung", async () => {
    for (const actor of [env.guest, env.organizer]) {
      await post(actor, "/api/pizza/admin/extras", { name: "Käse", priceCents: 100, categoryIds: [] }).expect(403);
    }
    await env.manager.agent
      .post("/api/pizza/admin/extras")
      .send({ name: "Käse", priceCents: 100, categoryIds: [] })
      .expect(403);

    const ham = await createExtra(env.manager, "extra Schinken", 150);
    const clash = await post(env.manager, "/api/pizza/admin/extras", {
      name: "EXTRA schinken",
      priceCents: 100,
      categoryIds: []
    }).expect(409);
    expect(clash.body.error).toBe("pizza_extra_existiert");
    await post(env.manager, "/api/pizza/admin/extras", { name: "Oliven", priceCents: -1, categoryIds: [] }).expect(400);
    await post(env.manager, "/api/pizza/admin/extras", { name: "Oliven", priceCents: 1.5, categoryIds: [] }).expect(400);
    await post(env.manager, "/api/pizza/admin/extras", { name: "", priceCents: 100, categoryIds: [] }).expect(400);
    const unknown = await post(env.manager, "/api/pizza/admin/extras", {
      name: "Oliven",
      priceCents: 100,
      categoryIds: ["gibts-nicht"]
    }).expect(404);
    expect(unknown.body.error).toBe("pizza_kategorie_nicht_gefunden");

    const menu = await env.manager.agent.get("/api/pizza/admin/menu").expect(200);
    expect(menu.body.extras).toEqual([
      { id: ham, name: "extra Schinken", priceCents: 150, active: true, sortOrder: 1, categoryIds: ["cat-pizza"] }
    ]);
    // Gäste sehen aktive Extras mit ihren Kategorien
    const state = await pizzaState(env.guest);
    expect(state.extras).toEqual([expect.objectContaining({ id: ham, categoryIds: ["cat-pizza"] })]);

    // Inaktive Kategorien fallen aus der Gast-Sicht der Extras
    await post(env.manager, "/api/pizza/admin/categories/cat-pizza/active", { active: false }).expect(204);
    expect((await pizzaState(env.guest)).extras).toEqual([]);

    expect(await auditActions(env.admin)).toContain("pizza.menu.extra.create");
  });
});

describe("Pizza-Extras – Bestellen", () => {
  it("berechnet Positionspreise mit Extras und friert Snapshots ein", async () => {
    const ham = await createExtra(env.manager, "extra Schinken", 150);
    const garlic = await createExtra(env.manager, "Knoblauch", 50, ["cat-pizza", "cat-pasta"]);
    await post(env.manager, "/api/pizza/transitions", { transition: "open" }).expect(200);

    const added = await post(env.guest, "/api/pizza/lines", { variantId: "v-001-30", qty: 2, extraIds: [ham] }).expect(201);
    const lineId = added.body.lineId as string;
    let state = await pizzaState(env.guest);
    expect(state.myOrder.lines[0]).toMatchObject({
      priceCentsSnapshot: 700,
      categoryId: "cat-pizza",
      extras: [{ extraId: ham, name: "extra Schinken", priceCentsSnapshot: 150 }]
    });
    expect(state.guestTotals[0].totalCents).toBe(2 * (700 + 150));

    // Nicht passend, doppelt, unbekannt → abgelehnt
    const wrongCategory = await post(env.guest, "/api/pizza/lines", { variantId: "v-pa-055", qty: 1, extraIds: [ham] }).expect(400);
    expect(wrongCategory.body.error).toBe("pizza_extra_nicht_verfuegbar");
    const twice = await post(env.guest, "/api/pizza/lines", { variantId: "v-001-30", qty: 1, extraIds: [ham, ham] }).expect(400);
    expect(twice.body.error).toBe("pizza_extra_doppelt");
    await post(env.guest, "/api/pizza/lines", { variantId: "v-001-30", qty: 1, extraIds: ["gibts-nicht"] }).expect(400);
    await post(env.guest, "/api/pizza/lines", { variantId: "v-001-30", qty: 1, extraIds: "x" }).expect(400);
    state = await pizzaState(env.guest);
    expect(state.myOrder.lines).toHaveLength(1);

    // Preisänderung wirkt nur auf neue Extras; behaltene Extras behalten ihren Snapshot
    await post(env.manager, "/api/pizza/admin/extras", {
      id: ham,
      name: "extra Schinken",
      priceCents: 200,
      categoryIds: ["cat-pizza"]
    }).expect(200);
    await patch(env.guest, `/api/pizza/lines/${lineId}`, { extraIds: [ham, garlic] }).expect(204);
    state = await pizzaState(env.guest);
    expect(state.myOrder.lines[0].extras).toEqual([
      { extraId: ham, name: "extra Schinken", priceCentsSnapshot: 150 },
      { extraId: garlic, name: "Knoblauch", priceCentsSnapshot: 50 }
    ]);
    expect(state.guestTotals[0].totalCents).toBe(2 * (700 + 150 + 50));
    await patch(env.guest, `/api/pizza/lines/${lineId}`, { extraIds: [garlic] }).expect(204);
    state = await pizzaState(env.guest);
    expect(state.myOrder.lines[0].extras.map((extra: { extraId: string }) => extra.extraId)).toEqual([garlic]);

    // Fremde Position nicht änderbar
    await patch(env.manager, `/api/pizza/lines/${lineId}`, { extraIds: [] }).expect(403);

    // Deaktiviertes Extra: nicht neu wählbar, bleibt aber an bestehender Position
    await post(env.manager, `/api/pizza/admin/extras/${garlic}/active`, { active: false }).expect(204);
    await post(env.guest, "/api/pizza/lines", { variantId: "v-003-30", qty: 1, extraIds: [garlic] }).expect(400);
    await patch(env.guest, `/api/pizza/lines/${lineId}`, { qty: 3, extraIds: [garlic] }).expect(204);
    state = await pizzaState(env.guest);
    expect(state.guestTotals[0].totalCents).toBe(3 * (700 + 50));

    // Bestelltes Extra wird beim Entfernen nur deaktiviert, unbestelltes gelöscht
    const removed = await del(env.manager, `/api/pizza/admin/extras/${garlic}`).expect(200);
    expect(removed.body.result).toBe("deactivated");
    const unused = await createExtra(env.manager, "Rucola", 80);
    expect((await del(env.manager, `/api/pizza/admin/extras/${unused}`).expect(200)).body.result).toBe("deleted");
  });

  it("sperrt Extras in geschlossenen und archivierten Runden und zeigt Summen im Archiv", async () => {
    const ham = await createExtra(env.manager, "extra Schinken", 150);
    await post(env.manager, "/api/pizza/transitions", { transition: "open", label: "Extras-Runde" }).expect(200);
    const added = await post(env.guest, "/api/pizza/lines", { variantId: "v-001-30", qty: 1, extraIds: [ham] }).expect(201);
    const lineId = added.body.lineId as string;
    await post(env.manager, "/api/pizza/transitions", { transition: "lock" }).expect(200);

    const locked = await patch(env.guest, `/api/pizza/lines/${lineId}`, { extraIds: [] }).expect(400);
    expect(locked.body.error).toBe("session_not_open");
    await post(env.guest, "/api/pizza/lines", { variantId: "v-001-30", qty: 1, extraIds: [ham] }).expect(400);

    // PDFs mit Extras
    for (const pdf of ["pizzeria", "kassenliste"]) {
      const response = await env.manager.agent.get(`/api/pizza/print/${pdf}.pdf`).expect(200);
      expect(response.headers["content-type"]).toContain("application/pdf");
    }

    const sessionId = (await pizzaState(env.guest)).session.id as string;
    await post(env.manager, `/api/pizza/sessions/${sessionId}/archive`).expect(200);
    const archived = await patch(env.guest, `/api/pizza/lines/${lineId}`, { extraIds: [] }).expect(409);
    expect(archived.body.error).toBe("pizza_runde_archiviert");

    const list = await env.manager.agent.get("/api/pizza/sessions/archived").expect(200);
    expect(list.body.sessions[0]).toMatchObject({ id: sessionId, totalCents: 850, orderCount: 1 });
    await env.manager.agent.get(`/api/pizza/print/kassenliste.pdf?sessionId=${sessionId}`).expect(200);

    // Extra mit Historie bleibt, bis die archivierte Runde gelöscht ist
    expect((await del(env.manager, `/api/pizza/admin/extras/${ham}`).expect(200)).body.result).toBe("deactivated");
    await del(env.manager, `/api/pizza/sessions/${sessionId}`).expect(204);
    expect((await del(env.manager, `/api/pizza/admin/extras/${ham}`).expect(200)).body.result).toBe("deleted");
  });
});
