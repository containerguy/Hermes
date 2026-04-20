/* @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { EventBoard } from "./EventBoard";
import { AdminPanel } from "./AdminPanel";
import { I18nProvider } from "../i18n/I18nContext";

import type { AppSettings, User } from "../types/core";

vi.mock("../api/request", () => {
  return {
    requestJson: vi.fn()
  };
});

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function stubEventSource() {
  class StubEventSource {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_url: string, _init?: unknown) {}
    close() {}
    addEventListener(_type: string, _listener: () => void) {}
  }

  (globalThis as unknown as { EventSource: typeof StubEventSource }).EventSource = StubEventSource;
}

async function renderIntoDocument(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(<I18nProvider locale="de">{element}</I18nProvider>);
    await flushMicrotasks();
  });

  return {
    container,
    root,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
        await flushMicrotasks();
      });
      container.remove();
    }
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("ui correctness structure contracts", () => {
  it("EventBoard exposes stable action-row/manage-row hooks", async () => {
    vi.useFakeTimers();
    stubEventSource();

    const { requestJson } = await import("../api/request");
    const requestJsonMock = requestJson as unknown as ReturnType<typeof vi.fn>;

    requestJsonMock.mockImplementation(async (path: string) => {
      if (path === "/api/events") {
        return {
          events: [
            {
              id: "evt_1",
              gameTitle: "Test Event",
              status: "open",
              startMode: "scheduled",
              startsAt: "2026-04-16T10:00:00.000Z",
              minPlayers: 2,
              maxPlayers: 8,
              joinedCount: 1,
              myParticipation: null,
              createdByUserId: "u_manager",
              createdByUsername: "manager",
              details: null
            }
          ]
        };
      }
      return {};
    });

    const currentUser: User = {
      id: "u_manager",
      phoneNumber: "+4900000000",
      username: "manager",
      displayName: "Manager",
      email: "m@example.test",
      role: "manager",
      notificationsEnabled: true
    };

    const rendered = await renderIntoDocument(<EventBoard currentUser={currentUser} mode="events" />);

    expect(rendered.container.textContent).toContain("1 Runde im Board");

    const expandTile = rendered.container.querySelector(".event-compact-tile") as HTMLButtonElement | null;
    expect(expandTile).toBeTruthy();
    await act(async () => {
      expandTile!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });

    expect(rendered.container.textContent).toContain("Noch keine Details hinterlegt");
    expect(rendered.container.querySelector(".event-capacity-track")).toBeTruthy();
    expect(rendered.container.textContent).toContain("Runde von");
    expect(rendered.container.textContent).toContain("manager");

    const actionRow = rendered.container.querySelector(".action-row");
    expect(actionRow).toBeTruthy();
    expect(actionRow?.textContent).toContain("Dabei");
    expect(actionRow?.textContent).toContain("Nicht dabei");

    const manageRow = rendered.container.querySelector(".manage-row");
    expect(manageRow).toBeTruthy();
    expect(manageRow?.querySelector('input[type="datetime-local"]')).toBeTruthy();
    expect(manageRow?.textContent).toContain("Start speichern");
    expect(manageRow?.textContent).toContain("Archivieren");
    expect(manageRow?.textContent).toContain("Stornieren");

    await rendered.cleanup();
    vi.runOnlyPendingTimers();
  });

  it("AdminPanel exposes stable audit log structure hooks", async () => {
    stubEventSource();

    const { requestJson } = await import("../api/request");
    const requestJsonMock = requestJson as unknown as ReturnType<typeof vi.fn>;

    const defaultSettings: AppSettings = {
      appName: "",
      brandMark: "mitspiel",
      projectTemplate: "lan_party",
      defaultNotificationsEnabled: true,
      eventAutoArchiveHours: 8,
      publicRegistrationEnabled: false,
      shellStartTitle: "",
      shellStartDescription: "",
      shellEventsEmptyTitle: "",
      shellEventsEmptyBody: "",
      gameCatalog: [],
      themePrimaryColor: "#0f766e",
      themeLoginColor: "#be123c",
      themeManagerColor: "#b7791f",
      themeAdminColor: "#2563eb",
      themeSurfaceColor: "#f6f8f4",
      infosEnabled: false,
      infosMarkdown: "",
      s3SnapshotEnabled: true,
      defaultLocale: "de",
      kioskStreamEnabled: false,
      kioskStreamPath: "stream",
      kioskStreamSecret: ""
    };

    requestJsonMock.mockImplementation(async (path: string) => {
      if (path === "/api/admin/users") {
        return { users: [] };
      }
      if (path === "/api/admin/settings") {
        return { settings: defaultSettings, storage: { backend: "disabled", envS3Configured: false } };
      }
      if (path.startsWith("/api/admin/audit-log")) {
        return {
          auditLogs: [
            {
              id: "a_1",
              actorUserId: null,
              createdAt: "2026-04-16T10:00:00.000Z",
              summary: "Test entry",
              action: "test",
              actorUsername: "system",
              entityType: "test",
              entityId: null,
              metadata: null
            }
          ]
        };
      }
      if (path === "/api/admin/invite-codes") {
        return { inviteCodes: [] };
      }
      if (path === "/api/admin/rate-limits") {
        return { rateLimits: [] };
      }
      if (path === "/api/admin/rate-limits/allowlist") {
        return { allowlist: [] };
      }
      return {};
    });

    const currentUser: User = {
      id: "u_admin",
      phoneNumber: "+4900000001",
      username: "admin",
      displayName: "Admin",
      email: "a@example.test",
      role: "admin",
      notificationsEnabled: true
    };

    const rendered = await renderIntoDocument(
      <AdminPanel
        currentUser={currentUser}
        adminSection="audit"
        onSettingsChanged={() => undefined}
      />
    );

    const auditPanel = rendered.container.querySelector('section[aria-label="Audit-Log"]');
    expect(auditPanel).toBeTruthy();
    expect(auditPanel?.querySelector(".section-title-row")).toBeTruthy();
    expect(auditPanel?.querySelector(".audit-list")).toBeTruthy();

    expect(rendered.container.textContent).toContain(
      "Das Audit-Log hilft dir beim Nachvollziehen von Änderungen"
    );

    await rendered.cleanup();
  });
});

