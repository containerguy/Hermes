/* @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { EventBoard } from "./EventBoard";
import { I18nProvider } from "../i18n/I18nContext";
import { requestJson } from "../api/request";
import type { GameServerBinding, User } from "../types/core";

vi.mock("../api/request", () => ({ requestJson: vi.fn() }));
vi.mock("../lib/BrandingContext", () => ({ useBrandIconSrc: () => "/icon.svg" }));
vi.mock("../lib/useCompactTouchShell", () => ({ useCompactTouchShell: () => false }));

const requestMock = vi.mocked(requestJson);

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

class StubEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string, _init?: unknown) {}
  close() {}
  addEventListener(_type: string, _listener: () => void) {}
}
(globalThis as unknown as { EventSource: typeof StubEventSource }).EventSource = StubEventSource;

const manager: User = {
  id: "u-mgr",
  phoneNumber: "+491700000000",
  username: "mgr",
  displayName: null,
  email: "mgr@example.test",
  role: "manager",
  notificationsEnabled: false,
  locale: "de",
  deletedAt: null
} as unknown as User;

const minecraft: GameServerBinding = {
  id: "b-mc",
  gameTitleNorm: "minecraft",
  displayTitle: "Minecraft",
  ampInstanceId: "i-mc",
  ampInstanceName: "Minecraft01",
  host: "minecraft.lanparty.example",
  port: 25565,
  connectScheme: "minecraft",
  enabled: true,
  autoStopEnabled: false,
  createdAt: "",
  updatedAt: ""
};

function installRequests() {
  const posted: Array<{ url: string; body: Record<string, unknown> }> = [];
  requestMock.mockImplementation(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      posted.push({ url, body: JSON.parse(String(options.body)) as Record<string, unknown> });
      return { event: { id: "e-1" } };
    }
    if (url === "/api/events") return { events: [] };
    if (url === "/api/integrations/amp/bindings") return { bindings: [minecraft] };
    if (url.startsWith("/api/integrations/amp/status")) return { servers: [] };
    throw new Error(`unexpected ${url}`);
  });
  return posted;
}

async function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<I18nProvider locale="de">{element}</I18nProvider>);
    await flush();
  });
  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
        await flush();
      });
      container.remove();
    }
  };
}

function setInputValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("EventBoard – Server-Bindung im Formular (Phase 15-03)", () => {
  it("shows the server hint for a bound title and sends serverBindingId on create", async () => {
    const posted = installRequests();
    const rendered = await render(
      <EventBoard currentUser={manager} mode="manager" gameCatalog={["Minecraft", "Factorio"]} ampIntegrationEnabled />
    );

    const select = rendered.container.querySelector("form.event-form select") as HTMLSelectElement;
    expect(select).toBeTruthy();
    await act(async () => {
      setInputValue(select, "Minecraft");
      await flush();
    });

    expect(rendered.container.textContent).toContain("minecraft.lanparty.example:25565");
    const checkbox = rendered.container.querySelector(".event-form-server input[type=checkbox]") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    const form = rendered.container.querySelector("form.event-form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });

    const created = posted.find((p) => p.url === "/api/events");
    expect(created?.body).toMatchObject({ gameTitle: "Minecraft", serverBindingId: "b-mc" });
    await rendered.cleanup();
  });

  it("sends serverBindingId: null when the link checkbox is unticked", async () => {
    const posted = installRequests();
    const rendered = await render(
      <EventBoard currentUser={manager} mode="manager" gameCatalog={["Minecraft"]} ampIntegrationEnabled />
    );
    const select = rendered.container.querySelector("form.event-form select") as HTMLSelectElement;
    await act(async () => {
      setInputValue(select, "Minecraft");
      await flush();
    });
    const checkbox = rendered.container.querySelector(".event-form-server input[type=checkbox]") as HTMLInputElement;
    await act(async () => {
      checkbox.click();
      await flush();
    });
    const form = rendered.container.querySelector("form.event-form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });
    const created = posted.find((p) => p.url === "/api/events");
    expect(created?.body.serverBindingId).toBeNull();
    await rendered.cleanup();
  });

  it("does not request bindings when the module is disabled", async () => {
    installRequests();
    const rendered = await render(<EventBoard currentUser={manager} mode="manager" gameCatalog={["Minecraft"]} />);
    expect(requestMock.mock.calls.some(([url]) => String(url).includes("/api/integrations/amp/"))).toBe(false);
    await rendered.cleanup();
  });
});
