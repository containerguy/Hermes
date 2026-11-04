import type { DatabaseContext } from "../db/client";
import type { UserRole } from "../domain/users";
import type { ModulePermissionDef } from "./manifest";

/**
 * Übergangs-Anbindung der Modulrechte.
 *
 * Das gemeinsame Rollen- und Rechtesystem (RBAC, `src/server/domain/permissions.ts`) entsteht
 * parallel. Es bietet `registerModulePermissions`, `removeModulePermissions` und `can` mit genau
 * diesen Signaturen. Bis es auf main ist, bildet diese Datei Modulrechte auf die festen Rollen ab:
 * ein Recht gilt für die niedrigste Rolle in `defaultRoles` und alle darüber (user < organizer <
 * manager), Admins dürfen alles — genau wie die Standardrollen im RBAC. Danach wird diese Datei
 * zur dünnen Weiterleitung auf das RBAC, die Module merken davon nichts.
 */

export type PermissionActor = { id: string; role: UserRole } | null | undefined;

export type CanOptions = { mainEventId?: string | null };

const ROLE_RANK: Record<UserRole, number> = { user: 0, organizer: 1, manager: 2, admin: 3 };

const registered = new Map<string, ModulePermissionDef[]>();

export function registerModulePermissions(
  _context: DatabaseContext,
  moduleId: string,
  defs: ModulePermissionDef[]
) {
  for (const def of defs) {
    if (!def.key.startsWith(`${moduleId}.`)) {
      throw new Error(`Recht ${def.key} gehört nicht zu Modul ${moduleId}`);
    }
  }
  registered.set(moduleId, defs);
}

export function removeModulePermissions(_context: DatabaseContext, moduleId: string) {
  registered.delete(moduleId);
}

export function listModulePermissions(moduleId: string) {
  return registered.get(moduleId) ?? [];
}

export function can(_context: DatabaseContext, actor: PermissionActor, key: string, _options: CanOptions = {}) {
  if (!actor) return false;
  if (actor.role === "admin") return true;
  const moduleId = key.split(".", 1)[0];
  const def = registered.get(moduleId)?.find((entry) => entry.key === key);
  if (!def || def.defaultRoles.length === 0) return false;
  const lowest = Math.min(...def.defaultRoles.map((role) => ROLE_RANK[role]));
  return ROLE_RANK[actor.role] >= lowest;
}

/** Nur für Tests. */
export function resetModulePermissions() {
  registered.clear();
}
