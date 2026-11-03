import { pizzaModule } from "../pizza/module";
import { createCoreModule } from "./core-module";
import { collectAdminSections, collectPages, type AppModule } from "./registry";

/**
 * Alle eingebauten Module. Ein neues Modul trägt sich hier ein und liefert Menüpunkte
 * (`pages`) und optional Admin-Unterpunkte (`adminSections`).
 */
export const featureModules: AppModule[] = [pizzaModule];

export const appModules: AppModule[] = [createCoreModule(collectAdminSections(featureModules)), ...featureModules];

export const appPages = collectPages(appModules);
