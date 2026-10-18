import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CSRF_HEADER } from "../auth/csrf";
import { auditActions, del, pizzaState, post, startPizzaTestEnv, type PizzaTestEnv } from "./pizza-test-helpers";

let env: PizzaTestEnv;

beforeEach(async () => {
  env = await startPizzaTestEnv();
}, 60_000);

afterEach(async () => {
  await env.close();
});

type Category = { id: string; name: string; sortOrder: number; active: boolean; itemCount: number };

async function adminCategories() {
  const response = await env.manager.agent.get("/api/pizza/admin/menu").expect(200);
  return response.body.categories as Category[];
}

describe("Pizza-Kategorien", () => {
  it("liefert die migrierten Kategorien Pizza und Pasta mit Artikelzahl", async () => {
    const categories = await adminCategories();
    expect(categories.map((category) => [category.id, category.name, category.itemCount])).toEqual([
      ["cat-pizza", "Pizza", 62],
      ["cat-pasta", "Pasta", 28]
    ]);
    const state = await pizzaState(env.guest);
    expect(state.categories.map((category: Category) => category.name)).toEqual(["Pizza", "Pasta"]);
    expect(state.menu.find((item: { id: string }) => item.id === "pa-041").categoryId).toBe("cat-pasta");
  });

  it("erlaubt die Pflege nur ab manager und nur mit CSRF", async () => {
    for (const actor of [env.guest, env.organizer]) {
      await post(actor, "/api/pizza/admin/categories", { name: "Getränke" }).expect(403);
      await post(actor, "/api/pizza/admin/categories/order", { ids: ["cat-pasta"] }).expect(403);
      await post(actor, "/api/pizza/admin/categories/cat-pasta/active", { active: false }).expect(403);
      await del(actor, "/api/pizza/admin/categories/cat-pasta").expect(403);
    }
    await env.manager.agent.post("/api/pizza/admin/categories").send({ name: "Getränke" }).expect(403);
    await env.manager.agent.delete("/api/pizza/admin/categories/cat-pasta").expect(403);
    expect((await adminCategories()).map((category) => category.name)).toEqual(["Pizza", "Pasta"]);
  });

  it("legt an, benennt um, sortiert und prüft Namen ohne Groß-/Kleinschreibung", async () => {
    const created = await post(env.manager, "/api/pizza/admin/categories", { name: "  Getränke " }).expect(200);
    const id = created.body.id as string;
    let categories = await adminCategories();
    expect(categories.at(-1)).toMatchObject({ id, name: "Getränke", sortOrder: 3, active: true, itemCount: 0 });

    for (const name of ["getränke", "GETRÄNKE", "pizza"]) {
      const clash = await post(env.manager, "/api/pizza/admin/categories", { name }).expect(409);
      expect(clash.body.error).toBe("pizza_kategorie_existiert");
    }
    await post(env.manager, "/api/pizza/admin/categories", { name: "" }).expect(400);
    await post(env.manager, "/api/pizza/admin/categories", { name: "x".repeat(61) }).expect(400);
    await post(env.manager, "/api/pizza/admin/categories", { id: "gibts-nicht", name: "Neu" }).expect(404);

    // Umbenennen der eigenen Kategorie nur in der Schreibweise ist erlaubt
    await post(env.manager, "/api/pizza/admin/categories", { id: "cat-pasta", name: "PASTA & Aufläufe" }).expect(200);
    await post(env.manager, "/api/pizza/admin/categories/order", { ids: [id, "cat-pizza"] }).expect(204);
    await post(env.manager, "/api/pizza/admin/categories/order", { ids: ["cat-pizza", "cat-pizza"] }).expect(400);
    await post(env.manager, "/api/pizza/admin/categories/order", { ids: ["unbekannt"] }).expect(404);
    categories = await adminCategories();
    expect(categories.map((category) => category.name)).toEqual(["Getränke", "Pizza", "PASTA & Aufläufe"]);

    // Gäste sehen die neue Reihenfolge; leere Kategorien liefern keine Artikel
    const state = await pizzaState(env.guest);
    expect(state.categories.map((category: Category) => category.name)).toEqual([
      "Getränke",
      "Pizza",
      "PASTA & Aufläufe"
    ]);

    const actions = await auditActions(env.admin);
    expect(actions).toEqual(
      expect.arrayContaining(["pizza.menu.category.create", "pizza.menu.category.update", "pizza.menu.category.reorder"])
    );
  });

  it("blendet inaktive Kategorien für Gäste aus und sperrt deren Artikel", async () => {
    await post(env.manager, "/api/pizza/transitions", { transition: "open" }).expect(200);
    await post(env.manager, "/api/pizza/admin/categories/cat-pasta/active", { active: false }).expect(204);

    let state = await pizzaState(env.guest);
    expect(state.categories.map((category: Category) => category.id)).toEqual(["cat-pizza"]);
    expect(state.menu.some((item: { categoryId: string }) => item.categoryId === "cat-pasta")).toBe(false);
    const blocked = await post(env.guest, "/api/pizza/lines", { variantId: "v-pa-055", qty: 1 }).expect(404);
    expect(blocked.body.error).toBe("variant_missing");

    // Menüpflege sieht sie weiterhin
    expect((await adminCategories()).find((category) => category.id === "cat-pasta")?.active).toBe(false);

    await post(env.manager, "/api/pizza/admin/categories/cat-pasta/active", { active: true }).expect(204);
    state = await pizzaState(env.guest);
    expect(state.categories).toHaveLength(2);
    await post(env.guest, "/api/pizza/lines", { variantId: "v-pa-055", qty: 1 }).expect(201);
  });

  it("löscht nur leere Kategorien und verschiebt Artikel", async () => {
    const blocked = await del(env.manager, "/api/pizza/admin/categories/cat-pasta").expect(409);
    expect(blocked.body.error).toBe("pizza_kategorie_nicht_leer");

    const created = await post(env.manager, "/api/pizza/admin/categories", { name: "Salate" }).expect(200);
    const salads = created.body.id as string;
    // Artikel in die neue Kategorie verschieben; unbekannte Kategorie wird abgelehnt
    await post(env.manager, "/api/pizza/admin/items", {
      id: "pa-041",
      name: "Amore (Nudeln)",
      categoryId: "gibts-nicht"
    }).expect(404);
    await post(env.manager, "/api/pizza/admin/items", { id: "pa-041", name: "Amore (Nudeln)", categoryId: salads }).expect(200);
    await del(env.manager, `/api/pizza/admin/categories/${salads}`).expect(409);
    await post(env.manager, "/api/pizza/admin/items", { id: "pa-041", name: "Amore (Nudeln)", categoryId: "cat-pasta" }).expect(200);
    await del(env.manager, `/api/pizza/admin/categories/${salads}`).expect(204);
    await del(env.manager, `/api/pizza/admin/categories/${salads}`).expect(404);

    expect(await auditActions(env.admin)).toContain("pizza.menu.category.delete");
  });

  it("übernimmt alte JSON-Exporte mit category pizza/pasta", async () => {
    const exported = (await env.manager.agent.get("/api/pizza/admin/menu/export").expect(200)).body;
    expect(exported.categories.map((category: Category) => category.name)).toEqual(["Pizza", "Pasta"]);
    expect(exported.items[0]).toMatchObject({ categoryId: "cat-pizza", category: "Pizza" });

    const legacy = exported.items.map((item: Record<string, unknown>) => {
      const { categoryId: _id, ...rest } = item;
      return { ...rest, category: item.categoryId === "cat-pasta" ? "pasta" : "pizza" };
    });
    await env.manager.agent
      .put("/api/pizza/admin/menu/import")
      .set(CSRF_HEADER, env.manager.csrf)
      .send({ items: legacy })
      .expect(200);
    const categories = await adminCategories();
    expect(categories.map((category) => [category.id, category.itemCount])).toEqual([
      ["cat-pizza", 62],
      ["cat-pasta", 28]
    ]);
  });
});
