import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditActions, pizzaState, post, startPizzaTestEnv, type PizzaTestEnv } from "./pizza-test-helpers";

let env: PizzaTestEnv;

beforeEach(async () => {
  env = await startPizzaTestEnv();
}, 60_000);

afterEach(async () => {
  await env.close();
});

function text(response: { text?: string; body: unknown }) {
  return typeof response.text === "string" && response.text ? response.text : Buffer.from(response.body as Buffer).toString("utf8");
}

describe("Pizza-Menü Import/Export (YAML, CSV)", () => {
  it("erlaubt Export, Vorschau und Übernehmen nur ab manager und schreibend nur mit CSRF", async () => {
    for (const actor of [env.guest, env.organizer]) {
      await actor.agent.get("/api/pizza/admin/menu/export.yaml").expect(403);
      await actor.agent.get("/api/pizza/admin/menu/export.csv").expect(403);
      await actor.agent.get("/api/pizza/admin/menu/extras-export.csv").expect(403);
      await post(actor, "/api/pizza/admin/menu/transfer/preview", { format: "csv", content: "x" }).expect(403);
      await post(actor, "/api/pizza/admin/menu/transfer/apply", { format: "csv", content: "x" }).expect(403);
    }
    await env.manager.agent.post("/api/pizza/admin/menu/transfer/apply").send({ format: "csv", content: "x" }).expect(403);
    await post(env.manager, "/api/pizza/admin/menu/transfer/preview", { format: "xml", content: "x" }).expect(400);
    await post(env.manager, "/api/pizza/admin/menu/transfer/preview", { format: "csv", content: "" }).expect(400);
    const tooLarge = await post(env.manager, "/api/pizza/admin/menu/transfer/preview", {
      format: "yaml",
      content: "#".repeat(300 * 1024)
    }).expect(413);
    expect(tooLarge.body.error).toBe("pizza_import_zu_gross");
  });

  it("liefert Downloads mit passenden Headern, BOM und Umlauten", async () => {
    const yaml = await env.manager.agent.get("/api/pizza/admin/menu/export.yaml").buffer(true).expect(200);
    expect(yaml.headers["content-type"]).toContain("application/yaml");
    expect(yaml.headers["content-disposition"]).toMatch(/attachment; filename="pizza-menu-\d{4}-\d{2}-\d{2}\.yaml"/);
    expect(text(yaml)).toContain("Tomatensauce & Oregano belegt mit Käse");

    const csv = await env.manager.agent.get("/api/pizza/admin/menu/export.csv").buffer(true).expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const csvText = text(csv);
    expect(csvText.charCodeAt(0)).toBe(0xfeff);
    expect(csvText.split("\r\n")[1]).toBe("Pizza;01;Margherita;Tomatensauce & Oregano belegt mit Käse;1,AC;24cm;4,00;ja");

    const extras = await env.manager.agent.get("/api/pizza/admin/menu/extras-export.csv").buffer(true).expect(200);
    expect(text(extras)).toBe("﻿extra;preis_eur;kategorien;aktiv\r\n");
  });

  it("zeigt eine Vorschau und übernimmt erst danach, mit Audit und Live-Signal", async () => {
    const csv = (await env.manager.agent.get("/api/pizza/admin/menu/export.csv").buffer(true).expect(200)).text;
    const changed = csv.replace("Pizza;01;Margherita;Tomatensauce & Oregano belegt mit Käse;1,AC;24cm;4,00;ja", "Pizza;01;Margherita;Tomatensauce & Oregano belegt mit Käse;1,AC;24cm;4.50;ja");

    const preview = await post(env.manager, "/api/pizza/admin/menu/transfer/preview", { format: "csv", content: changed }).expect(200);
    expect(preview.body.errors).toEqual([]);
    expect(preview.body.counts.variants.changed).toBe(1);
    expect(preview.body.counts.items).toMatchObject({ new: 0, changed: 0, unchanged: 90, removed: 0 });
    let state = await pizzaState(env.guest);
    expect(state.menu[0].variants[0].priceCents).toBe(400);

    const applied = await post(env.manager, "/api/pizza/admin/menu/transfer/apply", { format: "csv", content: changed }).expect(200);
    expect(applied.body.counts.variants.changed).toBe(1);
    state = await pizzaState(env.guest);
    expect(state.menu[0].variants[0].priceCents).toBe(450);
    expect(await auditActions(env.admin)).toContain("pizza.menu.import");

    const broken = await post(env.manager, "/api/pizza/admin/menu/transfer/apply", {
      format: "csv",
      content: "kategorie;nummer;artikel;zutaten;allergene;variante;preis_eur;aktiv\nPizza;01;Margherita;;;24cm;teuer;ja"
    }).expect(400);
    expect(broken.body.error).toBe("pizza_import_fehlerhaft");
    expect(broken.body.result.errors).toEqual([{ line: 2, code: "invalid_price", params: { value: "teuer" } }]);
    state = await pizzaState(env.guest);
    expect(state.menu).toHaveLength(90);
  });

  it("importiert Extras per YAML und bietet sie Gästen an", async () => {
    const yaml = (await env.manager.agent.get("/api/pizza/admin/menu/export.yaml").buffer(true).expect(200)).text;
    const withExtras = yaml.replace(/extras: \[\]\s*$/, "extras:\n  - name: extra Schinken\n    preis_eur: 1,50\n    kategorien: [Pizza]\n    aktiv: true\n");
    expect(withExtras).toContain("extra Schinken");
    const applied = await post(env.manager, "/api/pizza/admin/menu/transfer/apply", { format: "yaml", content: withExtras }).expect(200);
    expect(applied.body.counts.extras).toEqual({ new: 1, changed: 0, unchanged: 0, removed: 0 });
    expect(applied.body.counts.items.unchanged).toBe(90);
    const state = await pizzaState(env.guest);
    expect(state.extras).toEqual([expect.objectContaining({ name: "extra Schinken", priceCents: 150, categoryIds: ["cat-pizza"] })]);
  });
});
