import type { DatabaseContext } from "../db/client";
import {
  can as coreCan,
  registerModulePermissions as coreRegister,
  removeModulePermissions as coreRemove
} from "../domain/permissions";
import { localize, type ModulePermissionDef } from "./manifest";

/**
 * Anbindung der Modulrechte an das Rollen- und Rechtesystem des Kerns (domain/permissions.ts).
 *
 * Beim Aktivieren meldet der Kern die Rechte aus dem Manifest an (idempotent: bestehende Rechte,
 * Rollenzuordnungen und Vergaben bleiben). Beim Deinstallieren entfernt er sie samt Vergaben.
 * `defaultRoles` nennt die niedrigste Rolle, höhere erben das Recht; Admins dürfen alles.
 */

export type PermissionActor = { id: string; role: string } | null | undefined;

export type CanOptions = { mainEventId?: string | null };

export function registerModulePermissions(context: DatabaseContext, moduleId: string, defs: ModulePermissionDef[]) {
  coreRegister(
    context,
    moduleId,
    defs.map((def) => ({
      key: def.key,
      label: localize(def.label, "de"),
      description: def.description ? localize(def.description, "de") : undefined,
      scopable: def.scopable,
      defaultRoles: def.defaultRoles.filter((role): role is "user" | "organizer" | "manager" => role !== "admin")
    }))
  );
}

export function removeModulePermissions(context: DatabaseContext, moduleId: string) {
  coreRemove(context, moduleId);
}

export function can(context: DatabaseContext, actor: PermissionActor, key: string, options: CanOptions = {}) {
  if (!actor) return false;
  return coreCan(context, actor, key, options);
}
