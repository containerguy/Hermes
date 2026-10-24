/* @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { EventBoard } from "./EventBoard";
import { MainEventsPanel } from "./MainEventsPanel";
import { I18nProvider } from "../i18n/I18nContext";
import { requestJson } from "../api/request";
import type { GameEvent, MainEvent, User } from "../types/core";

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

function mainEvent(overrides: Partial<MainEvent>): MainEvent {
  return {
    id: "m-1",
    name: "LAN Herbst",
    description: null,
    status: "running",
    plannedStartAt: null,
    plannedEndAt: null,
    startedAt: "2026-11-06T16:00:00.000Z",
    endedAt: null,
    createdByUserId: "u-mgr",
    createdByUsername: "mgr",
    roundCount: 1,
    ...overrides
  };
}

function round(id: string, title: string, mainEventId: string | null): GameEvent {
  return {
    id,
    mainEventId,
    mainEventName: mainEventId ? "LAN Herbst" : null,
    gameTitle: title,
    startMode: "scheduled",
    startsAt: new Date(Date.now() + 3_600_000).toISOString(),
    minPlayers: 2,
    maxPlayers: 8,
    details: null,
    serverBindingId: null,
    status: "open",
    createdByUserId: "u-mgr",
    createdByUsername: "mgr",
    joinedCount: 0,
    myParticipation: null
  };
}

function installRequests(mainEvents: MainEvent[]) {
  const posted: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  requestMock.mockImplementation(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST" || options?.method === "DELETE") {
      posted.push({ url, body: options.body ? (JSON.parse(String(options.body)) as Record<string, unknown>) : null });
      return { event: { id: "e-new" }, mainEvent: mainEvents[0] };
    }
    if (url === "/api/events") return { events: [round("e-1", "Quake", "m-1"), round("e-2", "Solo", null)] };
    if (url === "/api/main-events") return { mainEvents };
    throw new Error(`unexpected ${url}`);
  });
  return posted;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("Events mit Start und Ende – Oberfläche", () => {
  it("shows only rounds of the running event by default and can switch to all rounds", async () => {
    installRequests([mainEvent({})]);
    const rendered = await render(<EventBoard currentUser={manager} mode="events" />);

    expect(rendered.container.textContent).toContain("Läuft gerade: LAN Herbst");
    expect(rendered.container.textContent).toContain("Quake");
    expect(rendered.container.textContent).not.toContain("Solo");

    const filter = rendered.container.querySelector(".board-filter select") as HTMLSelectElement;
    await act(async () => {
      setInputValue(filter, "all");
      await flush();
    });
    expect(rendered.container.textContent).toContain("Solo");

    await act(async () => {
      setInputValue(filter, "none");
      await flush();
    });
    expect(rendered.container.textContent).toContain("Solo");
    expect(rendered.container.textContent).not.toContain("Quake");
    await rendered.cleanup();
  });

  it("leaves mainEventId to the server by default and sends null for 'Kein Event'", async () => {
    const posted = installRequests([mainEvent({})]);
    const rendered = await render(<EventBoard currentUser={manager} mode="manager" />);

    const title = rendered.container.querySelector("form.event-form input") as HTMLInputElement;
    const form = rendered.container.querySelector("form.event-form") as HTMLFormElement;
    await act(async () => {
      setInputValue(title, "Quake");
      await flush();
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(posted.at(-1)?.body).not.toHaveProperty("mainEventId");

    const mainEventSelect = Array.from(rendered.container.querySelectorAll("form.event-form select")).find((select) =>
      Array.from((select as HTMLSelectElement).options).some((option) => option.value === "m-1")
    ) as HTMLSelectElement;
    expect(mainEventSelect.value).toBe("m-1");
    await act(async () => {
      setInputValue(title, "Solo");
      setInputValue(mainEventSelect, "");
      await flush();
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(posted.at(-1)?.body).toMatchObject({ gameTitle: "Solo", mainEventId: null });
    await rendered.cleanup();
  });

  it("starts a planned event and blocks starting while another one runs", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const posted = installRequests([mainEvent({ id: "m-2", name: "Tag 2", status: "planned", roundCount: 0 })]);
    const rendered = await render(<MainEventsPanel />);

    const start = Array.from(rendered.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Starten"
    ) as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    await act(async () => {
      start.click();
      await flush();
    });
    expect(posted).toEqual([{ url: "/api/main-events/m-2/start", body: null }]);
    await rendered.cleanup();

    installRequests([mainEvent({}), mainEvent({ id: "m-2", name: "Tag 2", status: "planned" })]);
    const second = await render(<MainEventsPanel />);
    const blocked = Array.from(second.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Starten"
    ) as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
    expect(second.container.textContent).toContain("Beenden");
    await second.cleanup();
  });
});
