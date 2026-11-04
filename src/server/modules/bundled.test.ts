import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrate";
import type { DatabaseContext } from "../db/client";
import { runBundledTransitions, type BundledTransition } from "./bundled";

const transition: BundledTransition = {
  moduleId: "pizza",
  file: "pizza-1.0.0.tgz",
  featureKey: "featuresPizzaEnabled",
  settings: { pizzaPaypalHandle: "paypalHandle", pizzaPaymentMethods: "paymentMethods" }
};

function setup(values: Record<string, unknown>) {
  const sqlite = new Database(":memory:");
  runMigrations(sqlite);
  const insert = sqlite.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)");
  for (const [key, value] of Object.entries(values)) insert.run(key, JSON.stringify(value), "2026-11-04T00:00:00.000Z");
  const context = { sqlite } as unknown as DatabaseContext;
  const keys = () => (sqlite.prepare("SELECT key FROM app_settings ORDER BY key").all() as Array<{ key: string }>).map((row) => row.key);
  return { sqlite, context, keys };
}

describe("Umstieg auf Module (Startpakete)", () => {
  it("installiert das Modul mit den alten Einstellungen, wenn die Funktion an war, und räumt auf", async () => {
    const { context, keys } = setup({ featuresPizzaEnabled: true, pizzaPaypalHandle: "lanpizza", appName: "LAN" });
    const installBundled = vi.fn(async () => true);
    await runBundledTransitions(context, { getModule: () => undefined, installBundled }, { transitions: [transition] });
    expect(installBundled).toHaveBeenCalledTimes(1);
    expect(installBundled.mock.calls[0]).toEqual([expect.any(Buffer), { settings: { paypalHandle: "lanpizza" } }]);
    expect(keys()).toEqual(["appName"]);
  });

  it("installiert nichts, wenn die Funktion aus war, entfernt aber die alten Einträge", async () => {
    const { context, keys } = setup({ featuresPizzaEnabled: false, pizzaPaymentMethods: "cash_only" });
    const installBundled = vi.fn(async () => true);
    await runBundledTransitions(context, { getModule: () => undefined, installBundled }, { transitions: [transition] });
    expect(installBundled).not.toHaveBeenCalled();
    expect(keys()).toEqual([]);
  });

  it("läuft ohne alte Einträge nicht erneut (auch nicht nach Deinstallation)", async () => {
    const { context } = setup({});
    const installBundled = vi.fn(async () => true);
    await runBundledTransitions(context, { getModule: () => undefined, installBundled }, { transitions: [transition] });
    expect(installBundled).not.toHaveBeenCalled();
  });

  it("behält die alten Einträge, wenn das Startpaket fehlt, damit der nächste Start es erneut versucht", async () => {
    const { context, keys } = setup({ featuresPizzaEnabled: true });
    const installBundled = vi.fn(async () => true);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await runBundledTransitions(
      context,
      { getModule: () => undefined, installBundled },
      { transitions: [transition], directory: "/gibt/es/nicht" }
    );
    error.mockRestore();
    expect(installBundled).not.toHaveBeenCalled();
    expect(keys()).toEqual(["featuresPizzaEnabled"]);
  });
});
