/* @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { AdminUserPermissions, type PermissionCatalog } from "./AdminPanelPermissions";
import { I18nProvider } from "../i18n/I18nContext";
import { requestJson } from "../api/request";
import type { MainEvent, User } from "../types/core";

vi.mock("../api/request", () => ({ requestJson: vi.fn() }));

const catalog: PermissionCatalog = {
  permissions: [
    { key: "rounds.create", moduleId: null, label: "Runden anlegen", description: null, scopable: true },
    { key: "pizza.manage", moduleId: null, label: "Pizza verwalten", description: null, scopable: false },
    { key: "polls.manage", moduleId: "polls", label: "Abstimmungen verwalten", description: null, scopable: true }
  ],
  roles: [
    { id: "role-user", key: "user", label: "Benutzer", builtin: true, permissions: [] },
    { id: "role-organizer", key: "organizer", label: "Organisator", builtin: true, permissions: ["rounds.create"] },
    { id: "role-admin", key: "admin", label: "Admin", builtin: true, permissions: [] }
  ]
};

const user: User = {
  id: "u-1",
  phoneNumber: "+49",
  username: "helfer",
  displayName: "helfer",
  email: "helfer@example.test",
  role: "user",
  notificationsEnabled: true,
  grants: []
};

function change(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("Rechte und Rollen pro Benutzer", () => {
  it("vergibt eine Rolle nur für ein Event und gruppiert Modulrechte", async () => {
    vi.mocked(requestJson).mockResolvedValue({
      grants: [
        {
          id: "g-1",
          userId: "u-1",
          roleKey: "organizer",
          roleLabel: "Organisator",
          permissionKey: null,
          permissionLabel: null,
          mainEventId: "m-1",
          mainEventName: "LAN Winter",
          createdAt: "2026-11-03T00:00:00.000Z"
        }
      ]
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const events = [{ id: "m-1", name: "LAN Winter", status: "planned" }] as MainEvent[];
    await act(async () => {
      root.render(
        <I18nProvider locale="de">
          <AdminUserPermissions user={user} catalog={catalog} openEvents={events} onError={vi.fn()} onSaved={vi.fn()} />
        </I18nProvider>
      );
    });

    expect(container.textContent).toContain("Modul polls");
    expect(container.textContent).toContain("Kern");

    await act(async () => change(container.querySelector("select") as HTMLSelectElement, "m-1"));
    const labels = Array.from(container.querySelectorAll("label.checkbox-row"));
    // Pro Event: keine Admin-Rolle, globale Rechte gesperrt.
    expect(labels.map((label) => label.textContent)).not.toContain("Admin");
    const pizza = labels.find((label) => label.textContent?.includes("Pizza verwalten"))!;
    expect((pizza.querySelector("input") as HTMLInputElement).disabled).toBe(true);
    expect(pizza.textContent).toContain("nur global");

    const organizer = labels.find((label) => label.textContent?.startsWith("Organisator"))!;
    await act(async () => {
      (organizer.querySelector("input") as HTMLInputElement).click();
    });
    expect(requestJson).toHaveBeenCalledWith(
      "/api/admin/users/u-1/grants",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ roleKey: "organizer", mainEventId: "m-1" }) })
    );
    expect(container.textContent).toContain("Organisator · nur LAN Winter");

    act(() => root.unmount());
    container.remove();
  });
});
