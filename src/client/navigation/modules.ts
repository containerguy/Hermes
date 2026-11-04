import { presenceModule } from "../presence/module";
import { moduleManagerModule } from "../modules/admin-module";
import { createCoreModule } from "./core-module";
import { collectAdminSections, collectPages, type AppModule } from "./registry";

/**
 * Alle eingebauten Module. Ein neues Modul trägt sich hier ein und liefert Menüpunkte
 * (`pages`) und optional Admin-Unterpunkte (`adminSections`).
 */
export const featureModules: AppModule[] = [presenceModule, moduleManagerModule];

export const appModules: AppModule[] = [createCoreModule(collectAdminSections(featureModules)), ...featureModules];

export const appPages = collectPages(appModules);
