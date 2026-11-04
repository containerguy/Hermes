/* @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { AdminPanelAudit } from "./AdminPanelAudit";
import { I18nProvider } from "../i18n/I18nContext";
import { requestJson } from "../api/request";

vi.mock("../api/request", () => ({ requestJson: vi.fn() }));
const requestJsonMock = vi.mocked(requestJson);

function entry(index: number, extra: Record<string, unknown> = {}) {
  return {
    id: `a-${index}`,
    actorUserId: null,
    actorUsername: index % 2 === 0 ? null : "anna",
    action: "user.create",
    entityType: "user",
    entityId: null,
    summary: `Eintrag ${index}`,
    metadata: null,
    createdAt: "2026-11-04T10:00:00.000Z",
    ...extra
  };
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

afterEach(() => {
  vi.useRealTimers();
  requestJsonMock.mockReset();
});

describe("Audit-Tabelle", () => {
  it("lädt seitenweise und schickt Suche und Filter an den Server", async () => {
    vi.useFakeTimers();
    requestJsonMock.mockImplementation(async (path: string) => {
      const params = new URL(path, "http://x").searchParams;
      const offset = Number(params.get("offset"));
      return {
        auditLogs: [entry(offset + 1, { metadata: { role: "admin" } }), entry(offset + 2)],
        total: params.get("action") ? 2 : 120,
        actions: ["settings.update", "user.create"],
        actors: ["anna"]
      } as never;
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider locale="de">
          <AdminPanelAudit dateTag="de-DE" />
        </I18nProvider>
      );
    });

    const lastPath = () => String(requestJsonMock.mock.calls.at(-1)?.[0]);
    expect(lastPath()).toBe("/api/admin/audit-log?limit=50&offset=0");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.textContent).toContain("120 Einträge");
    expect(container.textContent).toContain("Seite 1 von 3");
    expect(container.querySelector("details pre")?.textContent).toContain('"role": "admin"');

    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Weiter")!;
    await act(async () => next.click());
    expect(lastPath()).toBe("/api/admin/audit-log?limit=50&offset=50");
    expect(container.textContent).toContain("Seite 2 von 3");

    const actionFilter = container.querySelector('select[aria-label="Nach Aktion filtern"]') as HTMLSelectElement;
    await act(async () => setValue(actionFilter, "settings.update"));
    expect(lastPath()).toBe("/api/admin/audit-log?limit=50&offset=0&action=settings.update");
    expect(container.textContent).toContain("2 passende Einträge");
    expect(container.querySelector(".data-pager")).toBeNull();

    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => setValue(search, "Invite"));
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    expect(lastPath()).toBe("/api/admin/audit-log?limit=50&offset=0&q=Invite&action=settings.update");

    const reset = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Filter zurücksetzen")!;
    await act(async () => reset.click());
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    expect(lastPath()).toBe("/api/admin/audit-log?limit=50&offset=0");

    act(() => root.unmount());
    container.remove();
  });
});
