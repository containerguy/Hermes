/* @vitest-environment jsdom */
import React, { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { AdminPanelBetrieb } from "./AdminPanelBetrieb";
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

async function render(onSettingsChange: (next: AppSettings) => void, overrides: Partial<AppSettings> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale="de">
        <AdminPanelBetrieb
          settings={{ ...settings, ...overrides }}
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
});
