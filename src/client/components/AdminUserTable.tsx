import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/catalog";
import type { MainEvent, User, UserGrant } from "../types/core";
import { AdminUserPermissions, type PermissionCatalog } from "./AdminPanelPermissions";

type SortKey = "name" | "role" | "grants";

const ROLE_ORDER: User["role"][] = ["admin", "manager", "organizer", "user"];

/**
 * Benutzer als Tabelle: Suche nach Name/E-Mail, Filter nach Rolle, Event und Zusatzrechten,
 * sortierbare Spalten. Rechte und Rollen öffnen sich in einem Seitenpanel.
 */
export function AdminUserTable({
  users,
  currentUser,
  catalog,
  openEvents,
  onUpdateRole,
  onDeleteUser,
  onPermissionMessage,
  onPermissionError
}: {
  users: User[];
  currentUser: User | null;
  catalog: PermissionCatalog | null;
  openEvents: MainEvent[];
  onUpdateRole: (userId: string, role: User["role"]) => void;
  onDeleteUser: (user: User) => void;
  onPermissionMessage: (message: string) => void;
  onPermissionError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | User["role"]>("");
  const [eventFilter, setEventFilter] = useState("");
  const [onlyExtra, setOnlyExtra] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [panelUserId, setPanelUserId] = useState<string | null>(null);
  // Vergaben, die im Panel geändert wurden, bis die Liste neu geladen ist.
  const [grantOverrides, setGrantOverrides] = useState<Record<string, UserGrant[]>>({});

  useEffect(() => setGrantOverrides({}), [users]);

  const grantsOf = (user: User) => grantOverrides[user.id] ?? user.grants ?? [];

  const registrationEvents = useMemo(() => {
    const names = new Set(users.map((user) => user.registeredViaMainEventName).filter((name): name is string => Boolean(name)));
    if (eventFilter) {
      names.add(eventFilter);
    }
    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [users, eventFilter]);

  const needle = query.trim().toLocaleLowerCase();
  const visibleUsers = users
    .filter((user) => {
      if (needle) {
        const haystack = `${user.username} ${user.displayName} ${user.email}`.toLocaleLowerCase();
        if (!haystack.includes(needle)) {
          return false;
        }
      }
      if (roleFilter && user.role !== roleFilter) {
        return false;
      }
      if (eventFilter && user.registeredViaMainEventName !== eventFilter) {
        return false;
      }
      if (onlyExtra && grantsOf(user).length === 0) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      let result = 0;
      if (sort.key === "role") {
        result = ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role);
      } else if (sort.key === "grants") {
        result = grantsOf(left).length - grantsOf(right).length;
      }
      if (result === 0) {
        result = left.username.localeCompare(right.username, undefined, { sensitivity: "base" });
      }
      return result * sort.dir;
    });

  const filtersActive = Boolean(needle || roleFilter || eventFilter || onlyExtra);
  const panelUser = panelUserId ? users.find((user) => user.id === panelUserId) ?? null : null;

  function resetFilters() {
    setQuery("");
    setRoleFilter("");
    setEventFilter("");
    setOnlyExtra(false);
  }

  function SortHeader({ column, label }: { column: SortKey; label: string }) {
    const active = sort.key === column;
    return (
      <th scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          className={`data-table__sort${active ? " active" : ""}`}
          onClick={() => setSort(active ? { key: column, dir: sort.dir === 1 ? -1 : 1 } : { key: column, dir: 1 })}
        >
          {label}
          <span aria-hidden="true">{active ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</span>
        </button>
      </th>
    );
  }

  return (
    <section className="admin-user-table" aria-label={t("admin.user.listAria")}>
      <div className="data-toolbar">
        <input
          type="search"
          className="data-toolbar__search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("admin.userTable.searchPlaceholder")}
          aria-label={t("admin.userTable.searchAria")}
        />
        <select
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value as "" | User["role"])}
          aria-label={t("admin.userTable.roleFilterAria")}
        >
          <option value="">{t("admin.userTable.allRoles")}</option>
          {ROLE_ORDER.map((role) => (
            <option key={role} value={role}>
              {t(`admin.role.${role}` as MessageKey)}
            </option>
          ))}
        </select>
        {registrationEvents.length > 0 ? (
          <select
            value={eventFilter}
            onChange={(event) => setEventFilter(event.target.value)}
            aria-label={t("admin.user.filterEvent")}
          >
            <option value="">{t("admin.userTable.allEvents")}</option>
            {registrationEvents.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : null}
        <label className="data-toolbar__check">
          <input type="checkbox" checked={onlyExtra} onChange={(event) => setOnlyExtra(event.target.checked)} />
          {t("admin.userTable.onlyExtra")}
        </label>
        <p className="data-toolbar__count" aria-live="polite">
          {filtersActive
            ? t("admin.userTable.countFiltered", { shown: visibleUsers.length, total: users.length })
            : t("admin.userTable.count", { total: users.length })}
          {filtersActive ? (
            <button type="button" className="link-button" onClick={resetFilters}>
              {t("admin.userTable.reset")}
            </button>
          ) : null}
        </p>
      </div>

      {visibleUsers.length === 0 ? (
        <p className="empty-state">{t("admin.userTable.empty")}</p>
      ) : (
        <div className="data-table__scroll">
          <table className="data-table">
            <thead>
              <tr>
                <SortHeader column="name" label={t("admin.userTable.colName")} />
                <SortHeader column="role" label={t("admin.userTable.colRole")} />
                <SortHeader column="grants" label={t("admin.userTable.colGrants")} />
                <th scope="col">{t("admin.userTable.colEvent")}</th>
                <th scope="col">
                  <span className="visually-hidden">{t("admin.userTable.colActions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => {
                const grantCount = grantsOf(user).length;
                const isSelf = user.id === currentUser?.id;
                return (
                  <tr key={user.id} className={panelUserId === user.id ? "is-selected" : undefined}>
                    <td className="data-table__primary">
                      <strong>{user.username}</strong>
                      <span className="data-table__sub">
                        {user.displayName && user.displayName !== user.username ? `${user.displayName} · ` : ""}
                        {user.email}
                      </span>
                    </td>
                    <td data-label={t("admin.userTable.colRole")}>
                      <select
                        value={user.role}
                        onChange={(event) => onUpdateRole(user.id, event.target.value as User["role"])}
                        aria-label={t("admin.userTable.roleOf", { name: user.username })}
                      >
                        <option value="user">{t("admin.role.user")}</option>
                        <option value="organizer">{t("admin.role.organizer")}</option>
                        <option value="manager">{t("admin.role.manager")}</option>
                        <option value="admin">{t("admin.role.admin")}</option>
                      </select>
                    </td>
                    <td data-label={t("admin.userTable.colGrants")} className={grantCount > 0 ? undefined : "is-empty"}>
                      {grantCount > 0 ? (
                        <span className="pill">{t("admin.userTable.grantCount", { count: grantCount })}</span>
                      ) : (
                        <span className="muted">–</span>
                      )}
                    </td>
                    <td
                      data-label={t("admin.userTable.colEvent")}
                      className={user.registeredViaMainEventName ? undefined : "is-empty"}
                    >
                      {user.registeredViaMainEventName ?? <span className="muted">–</span>}
                    </td>
                    <td className="data-table__actions">
                      {catalog ? (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setPanelUserId(user.id)}
                          aria-label={t("admin.userTable.editRightsOf", { name: user.username })}
                        >
                          {t("admin.userTable.editRights")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="secondary danger"
                        onClick={() => onDeleteUser(user)}
                        disabled={isSelf}
                        aria-label={t("admin.userTable.deleteOf", { name: user.username })}
                      >
                        {t("admin.user.delete")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {panelUser && catalog ? (
        <SidePanel
          title={panelUser.username}
          subtitle={panelUser.email}
          closeLabel={t("admin.userTable.close")}
          onClose={() => setPanelUserId(null)}
        >
          <AdminUserPermissions
            key={`${panelUser.id}-${panelUser.role}`}
            user={{ ...panelUser, grants: grantsOf(panelUser) }}
            catalog={catalog}
            openEvents={openEvents}
            onError={onPermissionError}
            onSaved={onPermissionMessage}
            embedded
            onGrantsChange={(grants) => setGrantOverrides((current) => ({ ...current, [panelUser.id]: grants }))}
          />
        </SidePanel>
      ) : null}
    </section>
  );
}

/** Panel, das von rechts hereinkommt (Handy: Vollbild). Escape oder Klick daneben schließt es. */
function SidePanel({
  title,
  subtitle,
  closeLabel,
  onClose,
  children
}: {
  title: string;
  subtitle: string;
  closeLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    document.body.classList.add("side-panel-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("side-panel-open");
    };
  }, []);

  return (
    <div className="side-panel-layer">
      <div className="side-panel-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="side-panel" role="dialog" aria-modal="true" aria-labelledby="side-panel-title">
        <header className="side-panel__head">
          <div>
            <h2 id="side-panel-title">{title}</h2>
            <p className="muted">{subtitle}</p>
          </div>
          <button ref={closeRef} type="button" className="secondary side-panel__close" onClick={onClose}>
            {closeLabel}
          </button>
        </header>
        <div className="side-panel__body">{children}</div>
      </aside>
    </div>
  );
}
