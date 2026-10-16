/* @vitest-environment jsdom */
import React, { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { AdminPanelBetrieb } from "./AdminPanelBetrieb";
import { requestJson } from "../api/request";
import { I18nProvider } from "../i18n/I18nContext";
import type { AppSettings } from "../types/core";

vi.mock("../api/request", () => ({ requestJson: vi.fn().mockResolvedValue({ bindings: [], suggestions: [], instances: [] }) }));

const settings: AppSettings = {
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
  themePrimaryColor: "#0f766e",
  themeLoginColor: "#be123c",
  themeManagerColor: "#b7791f",
  themeAdminColor: "#2563eb",
  themeSurfaceColor: "#f6f8f4",
  gameCatalog: [],
  infosEnabled: false,
  infosMarkdown: "",
  s3SnapshotEnabled: true,
  defaultLocale: "de",
  kioskStreamEnabled: false,
  kioskStreamPath: "stream",
  kioskStreamSecret: "",
  featuresPizzaEnabled: false,
  pizzaPaypalHandle: "",
  pizzaPaypalName: "",
  pizzaCashRecipient: "",
  ampIntegrationEnabled: true,
  ampBaseUrl: "https://amp-ctl.example.test",
  ampAutoStartOnReady: false,
  ampAutoStopIdleMinutes: 0
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
});

async function render(
  onSettingsChange: (next: AppSettings) => void,
  overrides: Partial<AppSettings> = {},
  savedOverrides: Partial<AppSettings> = overrides
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale="de">
        <AdminPanelBetrieb
          settings={{ ...settings, ...overrides }}
          savedSettings={{ ...settings, ...savedOverrides }}
          gameCatalogDraft=""
          storage={null}
          restoreDiagnostics={null}
          restoreRecovery={null}
          opsBusy={false}
          dateTag="2026-10-16"
          settingsImportRef={createRef<HTMLInputElement>()}
          onSettingsChange={onSettingsChange}
          onGameCatalogDraftChange={vi.fn()}
          onSaveSettings={vi.fn()}
          onMessage={vi.fn()}
          onError={vi.fn()}
          onDownloadJsonAttachment={vi.fn()}
          onRunSettingsImport={vi.fn()}
          onRunBackup={vi.fn()}
          onRunRestore={vi.fn()}
        />
      </I18nProvider>
    );
  });
  return container;
}

function findLabel(root: HTMLElement, text: string) {
  return Array.from(root.querySelectorAll("label")).find((label) => label.textContent?.includes(text));
}

describe("AdminPanelBetrieb AMP automation", () => {
  it("shows auto-start and idle-stop controls when AMP is enabled", async () => {
    const onChange = vi.fn();
    const view = await render(onChange);

    const autoStart = findLabel(view, "Server automatisch starten")?.querySelector("input");
    expect(autoStart?.type).toBe("checkbox");
    await act(async () => {
      autoStart!.click();
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ampAutoStartOnReady: true }));

    const idle = findLabel(view, "Leerlauf-Stopp")?.querySelector("input") as HTMLInputElement;
    expect(idle.type).toBe("number");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(idle, "5000");
      idle.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ampAutoStopIdleMinutes: 1440 }));
  });

  it("hides the automation controls while AMP is disabled", async () => {
    const view = await render(vi.fn(), { ampIntegrationEnabled: false });
    expect(findLabel(view, "Server automatisch starten")).toBeUndefined();
    expect(findLabel(view, "Leerlauf-Stopp")).toBeUndefined();
  });

  it("shows the binding admin only once AMP is enabled in the saved settings", async () => {
    const requestMock = requestJson as unknown as ReturnType<typeof vi.fn>;
    requestMock.mockClear();

    // Entwurf: angekreuzt, aber noch nicht gespeichert -> keine AMP-Anfragen, Hinweis statt Fehler
    const draftView = await render(vi.fn(), { ampIntegrationEnabled: true }, { ampIntegrationEnabled: false });
    expect(draftView.textContent).toContain("Einstellungen speichern, um danach Server-Bindungen anzulegen.");
    expect(draftView.querySelector('[aria-label="Server-Bindungen"]')).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
    await act(async () => {
      root?.unmount();
    });
    container?.remove();

    // Gespeichert -> Bindungsverwaltung lädt Instanzen
    const savedView = await render(vi.fn());
    await act(async () => {
      await Promise.resolve();
    });
    expect(savedView.querySelector('[aria-label="Server-Bindungen"]')).not.toBeNull();
    expect(savedView.textContent).not.toContain("Einstellungen speichern, um danach Server-Bindungen anzulegen.");
    const urls = requestMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toContain("/api/integrations/amp/instances");
  });

  it("offers a retry when loading instances from AMP fails", async () => {
    const requestMock = requestJson as unknown as ReturnType<typeof vi.fn>;
    requestMock.mockClear();
    requestMock.mockImplementation(async (url: string) => {
      if (url === "/api/integrations/amp/instances") {
        throw new Error("amp_http_fehler");
      }
      return { bindings: [], suggestions: [], instances: [] };
    });
    const view = await render(vi.fn());
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    const retry = Array.from(view.querySelectorAll("button")).find((b) => b.textContent === "Neu aus AMP laden");
    expect(retry).toBeDefined();

    requestMock.mockImplementation(async () => ({ bindings: [], suggestions: [], instances: [] }));
    await act(async () => {
      retry!.click();
    });
    const instanceCalls = requestMock.mock.calls.filter((call) => call[0] === "/api/integrations/amp/instances");
    expect(instanceCalls).toHaveLength(2);
    requestMock.mockReset();
    requestMock.mockResolvedValue({ bindings: [], suggestions: [], instances: [] });
  });
});
