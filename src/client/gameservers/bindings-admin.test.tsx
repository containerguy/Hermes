/* @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { BindingsAdmin } from "./BindingsAdmin";
import { I18nProvider } from "../i18n/I18nContext";
import { requestJson } from "../api/request";
import type { GameServerBinding } from "../types/core";

vi.mock("../api/request", () => ({ requestJson: vi.fn() }));

const existing: GameServerBinding = {
  id: "b-ut",
  gameTitleNorm: "ut2004",
  displayTitle: "UT2004",
  ampInstanceId: "i-ut",
  ampInstanceName: "UT200401",
  host: "retro.lanparty.example",
  port: 7777,
  connectScheme: "copy",
  enabled: true,
  autoStopEnabled: false,
  createdAt: "",
  updatedAt: ""
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  vi.clearAllMocks();
});

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("BindingsAdmin idle-stop opt-in", () => {
  it("defaults to off, explains why, and sends autoStopEnabled when switched on", async () => {
    const mock = requestJson as unknown as ReturnType<typeof vi.fn>;
    mock.mockImplementation(async (url: string) => {
      if (url === "/api/integrations/amp/bindings/all") return { bindings: [existing] };
      if (url === "/api/integrations/amp/instances") return { instances: [] };
      if (url === "/api/integrations/amp/bindings/suggestions") return { suggestions: [] };
      return { binding: existing };
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <I18nProvider locale="de">
          <BindingsAdmin gameCatalog={["UT2004"]} />
        </I18nProvider>
      );
    });
    await flush();

    // Tabelle: Spalte Leerlauf-Stopp, bestehende Bindung ohne Freischaltung
    expect(container.textContent).toContain("Leerlauf-Stopp");
    const editButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Bearbeiten")!;
    await act(async () => {
      editButton.click();
    });

    const label = Array.from(container.querySelectorAll("label")).find((l) =>
      l.textContent?.includes("Leerlauf-Stopp erlauben")
    )!;
    const checkbox = label.querySelector("input") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(container.textContent).toContain("Bei Soldat, UT2004 und Call of Duty 4");

    await act(async () => {
      checkbox.click();
    });
    const portInput = Array.from(container.querySelectorAll("label"))
      .find((l) => l.textContent?.startsWith("Port"))!
      .querySelector("input") as HTMLInputElement;
    await act(async () => {
      setValue(portInput, "7777");
    });
    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();

    const put = mock.mock.calls.find((call) => call[0] === "/api/integrations/amp/bindings/b-ut");
    expect(put).toBeDefined();
    const body = JSON.parse(String((put![1] as RequestInit).body)) as Record<string, unknown>;
    expect(body).toMatchObject({ displayTitle: "UT2004", autoStopEnabled: true });
  });
});
