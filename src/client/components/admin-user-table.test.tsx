/* @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { AdminUserTable } from "./AdminUserTable";
import type { PermissionCatalog } from "./AdminPanelPermissions";
import { I18nProvider } from "../i18n/I18nContext";
import type { User } from "../types/core";

vi.mock("../api/request", () => ({ requestJson: vi.fn() }));

const catalog: PermissionCatalog = {
  permissions: [{ key: "rounds.create", moduleId: null, label: "Runden anlegen", description: null, scopable: true }],
  roles: [{ id: "role-user", key: "user", label: "Benutzer", builtin: true, permissions: [] }]
};

function makeUser(id: string, username: string, role: User["role"], extra: Partial<User> = {}): User {
  return {
    id,
    phoneNumber: "+49",
    username,
    displayName: username,
    email: `${username}@example.test`,
    role,
    notificationsEnabled: true,
    grants: [],
    ...extra
  };
}

const users: User[] = [
  makeUser("u-1", "zora", "user"),
  makeUser("u-2", "anna", "manager", { registeredViaMainEventName: "LAN Winter" }),
  makeUser("u-3", "bert", "user", {
    grants: [
      {
        id: "g-1",
        userId: "u-3",
        roleKey: null,
        roleLabel: null,
        permissionKey: "rounds.create",
        permissionLabel: "Runden anlegen",
        mainEventId: null,
        mainEventName: null,
        createdAt: "2026-11-04T00:00:00.000Z"
      }
    ]
  })
];

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

function rowNames(container: HTMLElement) {
  return Array.from(container.querySelectorAll("tbody tr td:first-child strong")).map((cell) => cell.textContent);
}

describe("Benutzertabelle", () => {
  it("sortiert, sucht, filtert und öffnet Rechte im Seitenpanel", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider locale="de">
          <AdminUserTable
            users={users}
            currentUser={users[0]}
            catalog={catalog}
            openEvents={[]}
            onUpdateRole={vi.fn()}
            onDeleteUser={vi.fn()}
            onPermissionMessage={vi.fn()}
            onPermissionError={vi.fn()}
          />
        </I18nProvider>
      );
    });

    expect(rowNames(container)).toEqual(["anna", "bert", "zora"]);
    expect(container.textContent).toContain("3 Benutzer");

    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => setValue(search, "ZOR"));
    expect(rowNames(container)).toEqual(["zora"]);
    expect(container.textContent).toContain("1 von 3 Benutzern");

    await act(async () => setValue(search, ""));
    const roleFilter = container.querySelector('select[aria-label="Nach Grundrolle filtern"]') as HTMLSelectElement;
    await act(async () => setValue(roleFilter, "manager"));
    expect(rowNames(container)).toEqual(["anna"]);

    await act(async () => setValue(roleFilter, ""));
    const onlyExtra = Array.from(container.querySelectorAll("label")).find((label) =>
      label.textContent?.includes("Nur mit Zusatzrechten")
    )!;
    await act(async () => (onlyExtra.querySelector("input") as HTMLInputElement).click());
    expect(rowNames(container)).toEqual(["bert"]);
    expect(container.textContent).toContain("1 zusätzlich");

    const rightsButton = container.querySelector('button[aria-label="Rechte und Rollen von bert"]') as HTMLButtonElement;
    await act(async () => rightsButton.click());
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("bert@example.test");
    expect(dialog.textContent).toContain("Runden anlegen");

    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    // Eigenes Konto lässt sich nicht löschen.
    await act(async () => (onlyExtra.querySelector("input") as HTMLInputElement).click());
    expect((container.querySelector('button[aria-label="zora löschen"]') as HTMLButtonElement).disabled).toBe(true);

    act(() => root.unmount());
    container.remove();
  });
});
