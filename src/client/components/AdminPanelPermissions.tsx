import React, { FormEvent, useState } from "react";
import { requestJson } from "../api/request";
import { getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/catalog";
import type { MainEvent, PermissionDefinition, RoleDefinition, User, UserGrant } from "../types/core";

export type PermissionCatalog = { permissions: PermissionDefinition[]; roles: RoleDefinition[] };

function groupByModule(permissions: PermissionDefinition[]) {
  const groups = new Map<string, PermissionDefinition[]>();
  for (const permission of permissions) {
    const key = permission.moduleId ?? "";
    groups.set(key, [...(groups.get(key) ?? []), permission]);
  }
  // Kern zuerst, dann Module alphabetisch.
  return Array.from(groups.entries()).sort(([left], [right]) => (left === "" ? -1 : right === "" ? 1 : left.localeCompare(right)));
}

function roleLabel(t: (key: MessageKey) => string, role: { key: string; label: string; builtin: boolean }) {
  return role.builtin ? t(`admin.role.${role.key}` as MessageKey) : role.label;
}

/**
 * Rechte und Rollen eines Benutzers zum Anklicken: zusätzlich zur Grundrolle, global oder nur
 * für ein Event. Rechte von Modulen stehen gruppiert unter ihrem Modul.
 */
export function AdminUserPermissions({
  user,
  catalog,
  openEvents,
  onError,
  onSaved,
  embedded = false,
  onGrantsChange
}: {
  user: User;
  catalog: PermissionCatalog;
  openEvents: MainEvent[];
  onError: (message: string) => void;
  onSaved: (message: string) => void;
  /** Im Seitenpanel: immer offen, ohne Aufklapp-Zeile. */
  embedded?: boolean;
  /** Meldet geänderte Vergaben, z. B. für die Zählung in der Benutzertabelle. */
  onGrantsChange?: (grants: UserGrant[]) => void;
}) {
  const { t, locale } = useI18n();
  const [grants, setGrantsState] = useState<UserGrant[]>(user.grants ?? []);
  const setGrants = (next: UserGrant[]) => {
    setGrantsState(next);
    onGrantsChange?.(next);
  };
  const [scope, setScope] = useState("");
  const [busy, setBusy] = useState(false);

  const scopeEventId = scope || null;
  const baseRole = catalog.roles.find((role) => role.key === user.role);
  const basePermissions = new Set(user.role === "admin" ? catalog.permissions.map((entry) => entry.key) : (baseRole?.permissions ?? []));
  const inScope = (grant: UserGrant) => (grant.mainEventId ?? null) === scopeEventId;
  const roleGrant = (key: string) => grants.find((grant) => inScope(grant) && grant.roleKey === key);
  const permissionGrant = (key: string) => grants.find((grant) => inScope(grant) && grant.permissionKey === key);

  async function toggle(target: { roleKey?: string; permissionKey?: string }, existing: UserGrant | undefined) {
    setBusy(true);
    try {
      const result = existing
        ? await requestJson<{ grants: UserGrant[] }>(`/api/admin/users/${user.id}/grants/${existing.id}`, {
            method: "DELETE"
          })
        : await requestJson<{ grants: UserGrant[] }>(`/api/admin/users/${user.id}/grants`, {
            method: "POST",
            body: JSON.stringify({ ...target, mainEventId: scopeEventId })
          });
      setGrants(result?.grants ?? []);
      onSaved(t("admin.perm.saved"));
    } catch (caught) {
      onError(getErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  async function remove(grant: UserGrant) {
    setBusy(true);
    try {
      const result = await requestJson<{ grants: UserGrant[] }>(`/api/admin/users/${user.id}/grants/${grant.id}`, {
        method: "DELETE"
      });
      setGrants(result?.grants ?? []);
      onSaved(t("admin.perm.saved"));
    } catch (caught) {
      onError(getErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  const assignableRoles = catalog.roles.filter((role) => role.key !== "user" && !(scopeEventId && role.key === "admin"));

  const Wrapper = embedded ? "div" : "details";
  return (
    <Wrapper className={`admin-user-permissions${embedded ? " admin-user-permissions--embedded" : ""}`}>
      {embedded ? null : (
        <summary>
          {grants.length > 0 ? t("admin.perm.toggleCount", { count: grants.length }) : t("admin.perm.toggle")}
        </summary>
      )}
      <p className="muted">{t("admin.perm.baseRole", { role: t(`admin.role.${user.role}` as MessageKey) })}</p>
      <label>
        {t("admin.perm.scope")}
        <select value={scope} onChange={(event) => setScope(event.target.value)} disabled={busy}>
          <option value="">{t("admin.perm.scopeGlobal")}</option>
          {openEvents.map((event) => (
            <option key={event.id} value={event.id}>
              {t("admin.perm.scopeEvent", { name: event.name })}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>{t("admin.perm.roles")}</legend>
        {assignableRoles.map((role) => {
          const existing = roleGrant(role.key);
          const viaBase = !scopeEventId && role.key === user.role;
          return (
            <label key={role.id} className="checkbox-row">
              <input
                type="checkbox"
                checked={Boolean(existing) || viaBase}
                disabled={busy || viaBase}
                onChange={() => toggle({ roleKey: role.key }, existing)}
              />
              {roleLabel(t, role)}
              {viaBase ? <span className="muted"> ({t("admin.perm.fromBaseRole")})</span> : null}
            </label>
          );
        })}
      </fieldset>

      <fieldset>
        <legend>{t("admin.perm.permissions")}</legend>
        {groupByModule(catalog.permissions).map(([moduleId, entries]) => (
          <div key={moduleId || "core"} className="admin-permission-group">
            <p className="muted">
              {moduleId ? t("admin.perm.moduleNamed", { module: moduleId }) : t("admin.perm.moduleCore")}
            </p>
            {entries.map((permission) => {
              const existing = permissionGrant(permission.key);
              const viaBase = basePermissions.has(permission.key);
              const notScopable = Boolean(scopeEventId) && !permission.scopable;
              return (
                <label key={permission.key} className="checkbox-row" title={permission.description ?? undefined}>
                  <input
                    type="checkbox"
                    checked={Boolean(existing) || viaBase}
                    disabled={busy || viaBase || (notScopable && !existing)}
                    onChange={() => toggle({ permissionKey: permission.key }, existing)}
                  />
                  {permission.label}
                  {viaBase ? <span className="muted"> ({t("admin.perm.fromBaseRole")})</span> : null}
                  {!viaBase && notScopable ? <span className="muted"> ({t("admin.perm.globalOnly")})</span> : null}
                </label>
              );
            })}
          </div>
        ))}
      </fieldset>

      <p className="muted">{t("admin.perm.active")}</p>
      {grants.length === 0 ? (
        <p className="empty-state">{t("admin.perm.none")}</p>
      ) : (
        <ul className="admin-grant-list">
          {grants.map((grant) => (
            <li key={grant.id}>
              <span>
                {grant.roleKey
                  ? roleLabel(t, {
                      key: grant.roleKey,
                      label: grant.roleLabel ?? grant.roleKey,
                      builtin: Boolean(catalog.roles.find((role) => role.key === grant.roleKey)?.builtin)
                    })
                  : (grant.permissionLabel ?? grant.permissionKey)}
                {" · "}
                {grant.mainEventId
                  ? t("admin.perm.grantEvent", { name: grant.mainEventName ?? grant.mainEventId })
                  : t("admin.perm.grantGlobal")}
              </span>
              <button type="button" className="secondary" disabled={busy} onClick={() => remove(grant)}>
                {t("admin.perm.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Wrapper>
  );
}

/** Rollen bearbeiten: Rechte je Rolle anklicken, eigene Rollen anlegen und löschen. */
export function AdminRoleEditor({
  catalog,
  onCatalogChange,
  onError,
  onSaved
}: {
  catalog: PermissionCatalog;
  onCatalogChange: (next: PermissionCatalog) => void;
  onError: (message: string) => void;
  onSaved: (message: string) => void;
}) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ key: "", label: "" });

  async function run(action: () => Promise<PermissionCatalog | undefined>) {
    setBusy(true);
    try {
      const next = await action();
      if (next) {
        onCatalogChange(next);
      }
      onSaved(t("admin.roles.saved"));
    } catch (caught) {
      onError(getErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  function togglePermission(role: RoleDefinition, key: string) {
    const permissions = role.permissions.includes(key)
      ? role.permissions.filter((entry) => entry !== key)
      : [...role.permissions, key];
    return run(() =>
      requestJson<PermissionCatalog>(`/api/admin/roles/${role.id}`, {
        method: "PATCH",
        body: JSON.stringify({ permissions })
      })
    );
  }

  function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return run(async () => {
      const next = await requestJson<PermissionCatalog>("/api/admin/roles", {
        method: "POST",
        body: JSON.stringify({ key: draft.key.trim(), label: draft.label.trim(), permissions: [] })
      });
      setDraft({ key: "", label: "" });
      return next;
    });
  }

  function deleteRole(role: RoleDefinition) {
    return run(async () => {
      await requestJson(`/api/admin/roles/${role.id}`, { method: "DELETE" });
      return requestJson<PermissionCatalog>("/api/admin/rbac");
    });
  }

  const editable = catalog.permissions.filter((permission) => permission.key !== "admin.access");

  return (
    <details className="admin-role-editor">
      <summary>{t("admin.roles.toggle")}</summary>
      <p className="muted">{t("admin.roles.intro")}</p>
      {catalog.roles
        .filter((role) => role.key !== "admin")
        .map((role) => (
          <fieldset key={role.id}>
            <legend>
              {roleLabel(t, role)}
              {role.builtin ? <span className="muted"> ({t("admin.roles.builtin")})</span> : null}
            </legend>
            {groupByModule(editable).map(([moduleId, entries]) => (
              <div key={moduleId || "core"} className="admin-permission-group">
                <p className="muted">
                  {moduleId ? t("admin.perm.moduleNamed", { module: moduleId }) : t("admin.perm.moduleCore")}
                </p>
                {entries.map((permission) => (
                  <label key={permission.key} className="checkbox-row" title={permission.description ?? undefined}>
                    <input
                      type="checkbox"
                      checked={role.permissions.includes(permission.key)}
                      disabled={busy}
                      onChange={() => togglePermission(role, permission.key)}
                    />
                    {permission.label}
                  </label>
                ))}
              </div>
            ))}
            {!role.builtin ? (
              <button type="button" className="secondary danger" disabled={busy} onClick={() => deleteRole(role)}>
                {t("admin.roles.delete")}
              </button>
            ) : null}
          </fieldset>
        ))}
      <form className="admin-form inline-form" onSubmit={createRole}>
        <label>
          {t("admin.roles.newKey")}
          <input
            value={draft.key}
            onChange={(event) => setDraft({ ...draft, key: event.target.value })}
            pattern="[a-z][a-z0-9_-]*"
            required
            minLength={2}
            maxLength={40}
          />
        </label>
        <label>
          {t("admin.roles.newLabel")}
          <input
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            required
            maxLength={60}
          />
        </label>
        <button type="submit" disabled={busy}>
          {t("admin.roles.create")}
        </button>
      </form>
    </details>
  );
}
