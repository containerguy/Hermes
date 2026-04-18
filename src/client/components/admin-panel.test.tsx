/* @vitest-environment jsdom */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { AdminPanel } from "./AdminPanel";

import type { AppSettings, BulkImportResult, User } from "../types/core";
import { requestJson } from "../api/request";

vi.mock("../api/request", () => {
  return {
    requestJson: vi.fn()
  };
});

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

async function renderIntoDocument(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(element);
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

const defaultSettings: AppSettings = {
  appName: "Hermes",
  defaultNotificationsEnabled: true,
  eventAutoArchiveHours: 8,
  publicRegistrationEnabled: false,
  shellStartTitle: "",
  shellStartDescription: "",
  shellEventsEmptyTitle: "",
  shellEventsEmptyBody: "",
  themePrimaryColor: "#0f766e",
  themeLoginColor: "#be123c",
  themeManagerColor: "#b7791f",
  themeAdminColor: "#2563eb",
  themeSurfaceColor: "#f6f8f4",
  gameCatalog: [],
  infosEnabled: false,
  infosMarkdown: "",
  s3SnapshotEnabled: true
};

const adminUser: User = {
  id: "u_admin",
  phoneNumber: "+4900000001",
  username: "admin",
  displayName: "Admin",
  email: "a@example.test",
  role: "admin",
  notificationsEnabled: true
};

const baseUsers: User[] = [
  adminUser,
  {
    id: "u_existing",
    phoneNumber: "+4900000002",
    username: "existing",
    displayName: "Existing",
    email: "existing@example.test",
    role: "user",
    notificationsEnabled: true
  }
];

const baseAuditLogs = [
  {
    id: "audit_1",
    actorUserId: adminUser.id,
    actorUsername: adminUser.username,
    action: "user.create",
    entityType: "user",
    entityId: adminUser.id,
    summary: "Admin hat User angelegt.",
    metadata: null,
    createdAt: "2026-04-17T10:00:00.000Z"
  }
];

function buildImportResult(overrides: Partial<BulkImportResult> = {}): BulkImportResult {
  return {
    format: "csv",
    totalRows: 2,
    acceptedRows: 1,
    blockingIssueCount: 0,
    hasBlockingIssues: false,
    validCandidates: [
      {
        username: "anna",
        displayName: "Anna",
        email: "anna@example.test",
        role: "user"
      }
    ],
    issues: [],
    ...overrides
  };
}

const requestJsonMock = requestJson as unknown as ReturnType<typeof vi.fn>;

function baseAdminDataResponse(path: string) {
  if (path === "/api/admin/users") {
    return { users: baseUsers };
  }
  if (path === "/api/admin/settings") {
    return { settings: defaultSettings, storage: { backend: "disabled", envS3Configured: false } };
  }
  if (path.startsWith("/api/admin/audit-log")) {
    return { auditLogs: baseAuditLogs };
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
  throw new Error(`Unexpected request: ${path}`);
}

function installAdminDataMock() {
  requestJsonMock.mockImplementation(async (path: string) => baseAdminDataResponse(path));
  return requestJsonMock;
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("AdminPanel bulk import UX", () => {
  it("renders the bulk import affordance near admin user creation", async () => {
    installAdminDataMock();

    const rendered = await renderIntoDocument(
      <AdminPanel
        currentUser={adminUser}
        adminSection="users"
        onSettingsChanged={() => undefined}
      />
    );

    expect(rendered.container.textContent || "").toContain("User aus CSV oder JSON importieren");
    expect(rendered.container.querySelector('section[aria-label="Bulk User Import"]')).toBeTruthy();
    expect(rendered.container.querySelector('select[aria-label="Importformat"]')).toBeTruthy();
    expect(rendered.container.querySelector('textarea[aria-label="Importdaten"]')).toBeTruthy();
    expect(rendered.container.textContent || "").toContain("Vorschau zeigt blockierende Konflikte");

    await rendered.cleanup();
  });

  it("renders preview summaries and candidate rows from the backend contract", async () => {
    const requestJsonMock = installAdminDataMock();
    const preview = buildImportResult();

    requestJsonMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/api/admin/users/import/preview") {
        expect(options?.method).toBe("POST");
        return { import: preview };
      }
      return baseAdminDataResponse(path);
    });

    const rendered = await renderIntoDocument(
      <AdminPanel
        currentUser={adminUser}
        adminSection="users"
        onSettingsChanged={() => undefined}
      />
    );

    const textarea = rendered.container.querySelector('textarea[aria-label="Importdaten"]') as HTMLTextAreaElement;
    const form = rendered.container.querySelector('form[aria-label="Bulk Import Formular"]');

    await act(async () => {
      textarea.value = "username,email,role\nanna,anna@example.test,user";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await flushMicrotasks();
    });

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    const text = rendered.container.textContent || "";
    expect(text).toContain("Preview Zusammenfassung");
    expect(text).toContain("Zeilen gesamt: 2");
    expect(text).toContain("Gültige Kandidaten: 1");
    expect(text).toContain("anna · anna@example.test · user");
    expect(text).toContain("Import-Vorschau geladen. Commit kann jetzt ausgeführt werden.");

    await rendered.cleanup();
  });

  it("keeps commit disabled and shows blocking issues when preview reports conflicts", async () => {
    const requestJsonMock = installAdminDataMock();
    const preview = buildImportResult({
      acceptedRows: 0,
      blockingIssueCount: 1,
      hasBlockingIssues: true,
      validCandidates: [],
      issues: [
        {
          row: 2,
          code: "bestehender_user_konflikt",
          field: "email",
          message: "E-Mail anna@example.test existiert bereits als aktiver User.",
          value: "anna@example.test"
        }
      ]
    });

    requestJsonMock.mockImplementation(async (path: string) => {
      if (path === "/api/admin/users/import/preview") {
        return { import: preview };
      }
      if (path === "/api/admin/users/import/commit") {
        throw new Error("commit should stay disabled for blocking preview");
      }
      return baseAdminDataResponse(path);
    });

    const rendered = await renderIntoDocument(
      <AdminPanel
        currentUser={adminUser}
        adminSection="users"
        onSettingsChanged={() => undefined}
      />
    );

    const textarea = rendered.container.querySelector('textarea[aria-label="Importdaten"]') as HTMLTextAreaElement;
    const form = rendered.container.querySelector('form[aria-label="Bulk Import Formular"]');

    await act(async () => {
      textarea.value = "username,email,role\nanna,anna@example.test,user";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await flushMicrotasks();
    });

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    const commitButton = Array.from(rendered.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Import committen"
    ) as HTMLButtonElement | undefined;

    expect(commitButton).toBeTruthy();
    expect(commitButton?.disabled).toBe(true);
    expect(rendered.container.textContent || "").toContain(
      "Import-Vorschau geladen. Bitte blockierende Probleme erst auflösen."
    );
    expect(rendered.container.textContent || "").toContain(
      "Zeile 2: E-Mail anna@example.test existiert bereits als aktiver User."
    );
    expect(rendered.container.textContent || "").toContain(
      "Noch keine importierbaren User in dieser Vorschau."
    );

    await rendered.cleanup();
  });

  it("commits a clean preview, confirms success, and reloads admin data", async () => {
    const { requestJson } = await import("../api/request");
    const requestJsonMock = requestJson as unknown as ReturnType<typeof vi.fn>;
    const preview = buildImportResult();
    let usersLoadCount = 0;
    let auditLoadCount = 0;

    requestJsonMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/api/admin/users") {
        usersLoadCount += 1;
        return {
          users:
            usersLoadCount >= 2
              ? [
                  ...baseUsers,
                  {
                    id: "u_imported",
                    phoneNumber: "user:u_imported",
                    username: "anna",
                    displayName: "Anna",
                    email: "anna@example.test",
                    role: "user",
                    notificationsEnabled: true
                  }
                ]
              : baseUsers
        };
      }
      if (path === "/api/admin/settings") {
        return { settings: defaultSettings, storage: { backend: "disabled", envS3Configured: false } };
      }
      if (path.startsWith("/api/admin/audit-log")) {
        auditLoadCount += 1;
        return {
          auditLogs:
            auditLoadCount >= 2
              ? [
                  {
                    id: "audit_import",
                    actorUserId: adminUser.id,
                    actorUsername: adminUser.username,
                    action: "user_bulk_import",
                    entityType: "user_batch",
                    entityId: null,
                    summary: "admin hat 1 User per Bulk-Import angelegt.",
                    metadata: null,
                    createdAt: "2026-04-17T10:10:00.000Z"
                  },
                  ...baseAuditLogs
                ]
              : baseAuditLogs
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
      if (path === "/api/admin/users/import/preview") {
        return { import: preview };
      }
      if (path === "/api/admin/users/import/commit") {
        expect(options?.method).toBe("POST");
        return {
          importedCount: 1,
          users: [
            {
              id: "u_imported",
              phoneNumber: "user:u_imported",
              username: "anna",
              displayName: "Anna",
              email: "anna@example.test",
              role: "user",
              notificationsEnabled: true
            }
          ],
          import: {
            ...preview,
            totalRows: 1
          }
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const rendered = await renderIntoDocument(
      <AdminPanel
        currentUser={adminUser}
        adminSection="users"
        onSettingsChanged={() => undefined}
      />
    );

    const textarea = rendered.container.querySelector('textarea[aria-label="Importdaten"]') as HTMLTextAreaElement;
    const form = rendered.container.querySelector('form[aria-label="Bulk Import Formular"]');

    await act(async () => {
      textarea.value = "username,email,role\nanna,anna@example.test,user";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await flushMicrotasks();
    });

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    const commitButton = Array.from(rendered.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Import committen"
    ) as HTMLButtonElement;

    expect(commitButton.disabled).toBe(false);

    await act(async () => {
      commitButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });

    const text = rendered.container.textContent || "";
    expect(text).toContain("1 User per Bulk-Import angelegt.");
    expect(text).toContain("anna@example.test");
    expect(usersLoadCount).toBeGreaterThanOrEqual(2);
    expect(auditLoadCount).toBeGreaterThanOrEqual(2);

    await rendered.cleanup();
  });
});
