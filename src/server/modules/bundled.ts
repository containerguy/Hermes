import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseContext } from "../db/client";
import { readEnv } from "../env";
import type { ModuleManager } from "./manager";

/**
 * Umstieg von fest eingebauten Funktionen auf Module (Matchdesk 0.17).
 *
 * Pizza und „Spielt gerade“ waren bis 0.16 Teil des Kerns und ließen sich in den
 * Einstellungen einschalten. Beim ersten Start nach dem Update installiert der Kern das Modul aus
 * einem mitgelieferten Paket, wenn die Funktion eingeschaltet war – auch ohne Internet. Daten
 * bleiben in ihren Tabellen, die alten Einstellungen wandern in die Modul-Einstellungen. Danach
 * entfernt der Kern die alten Einträge aus `app_settings`, damit der Umstieg genau einmal läuft
 * (ein später deinstalliertes Modul kommt also nicht wieder).
 */

export type BundledTransition = {
  moduleId: string;
  /** Dateiname im Ordner der Startpakete. */
  file: string;
  /** Alter Schalter in `app_settings`; nur wenn er `true` war, wird installiert. */
  featureKey: string;
  /** Alte Einstellung in `app_settings` → Schlüssel in den Modul-Einstellungen. */
  settings: Record<string, string>;
};

export const BUNDLED_TRANSITIONS: BundledTransition[] = [
  {
    moduleId: "pizza",
    file: "pizza-1.0.0.tgz",
    featureKey: "featuresPizzaEnabled",
    settings: {
      pizzaPaymentMethods: "paymentMethods",
      pizzaPaypalHandle: "paypalHandle",
      pizzaPaypalName: "paypalName",
      pizzaCashRecipient: "cashRecipient"
    }
  },
  {
    moduleId: "presence",
    file: "presence-1.0.0.tgz",
    featureKey: "featuresGamePresenceEnabled",
    settings: {}
  }
];

export function bundledModulesDir() {
  const configured = readEnv("BUNDLED_MODULES_DIR");
  if (configured) return configured;
  // Quellcode: src/server/modules/bundled-modules; Build: dist-server/bundled-modules.
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "bundled-modules");
}

function readOldSetting(context: DatabaseContext, key: string): unknown {
  const row = context.sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as unknown;
  } catch {
    return undefined;
  }
}

export async function runBundledTransitions(
  context: DatabaseContext,
  modules: Pick<ModuleManager, "getModule" | "installBundled">,
  options: { directory?: string; transitions?: BundledTransition[] } = {}
) {
  const directory = options.directory ?? bundledModulesDir();
  for (const transition of options.transitions ?? BUNDLED_TRANSITIONS) {
    const oldKeys = [transition.featureKey, ...Object.keys(transition.settings)];
    const hasOldRows = oldKeys.some((key) => readOldSetting(context, key) !== undefined);
    if (!hasOldRows) continue;

    if (readOldSetting(context, transition.featureKey) === true && !modules.getModule(transition.moduleId)) {
      const settings: Record<string, unknown> = {};
      for (const [oldKey, newKey] of Object.entries(transition.settings)) {
        const value = readOldSetting(context, oldKey);
        if (value !== undefined) settings[newKey] = value;
      }
      try {
        const buffer = fs.readFileSync(path.join(directory, transition.file));
        await modules.installBundled(buffer, { settings });
        console.log(`[Matchdesk] Modul ${transition.moduleId} aus dem Startpaket installiert (Umstieg auf Module).`);
      } catch (error) {
        // Alte Einträge bleiben stehen, damit der nächste Start es erneut versucht.
        console.error(`[Matchdesk] Modul ${transition.moduleId} konnte nicht aus dem Startpaket installiert werden`, error);
        continue;
      }
    }

    const remove = context.sqlite.prepare("DELETE FROM app_settings WHERE key = ?");
    context.sqlite.transaction(() => {
      for (const key of oldKeys) remove.run(key);
    })();
  }
}
