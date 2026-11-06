/* @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { EventBoard } from "./EventBoard";
import { I18nProvider } from "../i18n/I18nContext";
import { requestJson } from "../api/request";
import { subscribeEventsChanged } from "../realtime/events-changed-bus";
import type { GameEvent, User } from "../types/core";

vi.mock("../api/request", () => ({ requestJson: vi.fn() }));
vi.mock("../lib/BrandingContext", () => ({ useBrandIconSrc: () => "/icon.svg" }));
vi.mock("../lib/useCompactTouchShell", () => ({ useCompactTouchShell: () => false }));

const requestMock = vi.mocked(requestJson);

class CapturingEventSource {
  static instances: CapturingEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, Array<(message: MessageEvent<string>) => void>>();
  constructor(public url: string, _init?: unknown) {
    CapturingEventSource.instances.push(this);
  }
  close() {}
  addEventListener(type: string, listener: (message: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent<string>);
    }
  }
}
(globalThis as unknown as { EventSource: typeof CapturingEventSource }).EventSource = CapturingEventSource;

const user = { id: "u1", username: "gast", role: "user", locale: "de" } as unknown as User;

async function flush() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function gameEvent(overrides: Partial<GameEvent> = {}): GameEvent {
  return {
    id: "e-1",
    mainEventId: null,
    mainEventName: null,
    gameTitle: "Zeilentest",
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
    myParticipation: null,
    ...overrides
  };
}

async function renderBoard(currentUser: User) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider locale="de">
        <EventBoard currentUser={currentUser} mode="events" />
      </I18nProvider>
    );
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

afterEach(() => {
  vi.clearAllMocks();
  CapturingEventSource.instances = [];
});

describe("EventBoard – events_changed an den Bus", () => {
  it("leitet den Grund weiter und meldet nach einem Reconnect einen Abgleich", async () => {
    requestMock.mockImplementation(async (url: string) => (url === "/api/events" ? { events: [] } : undefined));
    const received: Array<string | null> = [];
    const unsubscribe = subscribeEventsChanged(({ reason }) => received.push(reason));

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider locale="de">
          <EventBoard currentUser={user} mode="events" />
        </I18nProvider>
      );
      await flush();
    });

    expect(CapturingEventSource.instances).toHaveLength(1);
    const source = CapturingEventSource.instances[0];
    await act(async () => {
      source.onopen?.();
      source.emit("events_changed", { reason: "pizza_session_open", at: "2026-10-17T18:00:00.000Z" });
      await flush();
    });
    expect(received).toEqual(["pizza_session_open"]);

    // erneutes onopen (nach Verbindungsabbruch) → vollständiger Abgleich
    await act(async () => {
      source.onopen?.();
      await flush();
    });
    expect(received).toEqual(["pizza_session_open", null]);

    unsubscribe();
    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});

describe("EventBoard – Zeilenaktionen im Runden-Board (HCI-109)", () => {
  it(`„Dabei" ist ein Klick ohne Aufklappen der Zeile`, async () => {
    const posted: Array<{ url: string; body: unknown }> = [];
    requestMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === "/api/events") return { events: [gameEvent()] };
      if (url === "/api/events/e-1/participation" && options?.method === "POST") {
        posted.push({ url, body: options.body ? JSON.parse(String(options.body)) : null });
        return { event: gameEvent({ myParticipation: "joined", joinedCount: 1 }) };
      }
      throw new Error(`unerwarteter Aufruf ${url} ${options?.method ?? "GET"}`);
    });

    const rendered = await renderBoard(user);
    const row = rendered.container.querySelector("li.device-row") as HTMLLIElement;
    expect(row).toBeTruthy();

    // Die Zeile selbst ist kein <button> mehr (HCI-109): Beitreten hängt an einem eigenständigen
    // Knopf in `.device-actions`, ganz ohne ein vorheriges Aufklappen der Zeile.
    expect(rendered.container.querySelector(".event-row-details")).toBeNull();
    const joinButton = Array.from(row.querySelectorAll(".device-actions button")).find(
      (button) => button.textContent === "Dabei"
    ) as HTMLButtonElement | undefined;
    expect(joinButton).toBeTruthy();

    await act(async () => {
      joinButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    expect(posted).toEqual([{ url: "/api/events/e-1/participation", body: { status: "joined" } }]);
    await rendered.cleanup();
  });

  it(`„Archivieren" fragt erst eine Bestätigung ab (Aktion + Bestätigung = 2 Klicks)`, async () => {
    const posted: string[] = [];
    requestMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === "/api/events") return { events: [gameEvent()] };
      if (url === "/api/events/e-1/archive" && options?.method === "POST") {
        posted.push(url);
        return { event: gameEvent({ status: "archived" }) };
      }
      throw new Error(`unerwarteter Aufruf ${url} ${options?.method ?? "GET"}`);
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const manager = { ...user, id: "u-mgr", role: "manager" } as unknown as User;
    const rendered = await renderBoard(manager);

    const row = rendered.container.querySelector("li.device-row") as HTMLLIElement;
    const archiveButton = Array.from(row.querySelectorAll(".device-actions button")).find(
      (button) => button.textContent === "Archivieren"
    ) as HTMLButtonElement | undefined;
    expect(archiveButton).toBeTruthy();

    await act(async () => {
      archiveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    expect(confirmSpy).toHaveBeenCalledWith("Runde wirklich archivieren?");
    expect(posted).toEqual(["/api/events/e-1/archive"]);

    confirmSpy.mockRestore();
    await rendered.cleanup();
  });
});

describe("EventBoard – Mehrfachauswahl im Runden-Board (HCI-110)", () => {
  const manager = { ...user, id: "u-mgr", role: "manager" } as unknown as User;

  it("Kästchen nur für Orga; Sammelleiste ab einer Auswahl; Archivieren als eine Anfrage", async () => {
    const posted: Array<{ url: string; body: unknown }> = [];
    requestMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === "/api/events") {
        return { events: [gameEvent({ id: "e-1" }), gameEvent({ id: "e-2", gameTitle: "Zweite" })] };
      }
      if (url === "/api/events/bulk" && options?.method === "POST") {
        posted.push({ url, body: options.body ? JSON.parse(String(options.body)) : null });
        return { updated: ["e-1", "e-2"], skipped: [] };
      }
      throw new Error(`unerwarteter Aufruf ${url} ${options?.method ?? "GET"}`);
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const rendered = await renderBoard(manager);

    // Noch keine Auswahl → keine Sammelleiste.
    expect(rendered.container.querySelector(".bulk-bar")).toBeNull();

    const checkboxes = Array.from(
      rendered.container.querySelectorAll("li.device-row input[type='checkbox']")
    ) as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);

    await act(async () => {
      checkboxes[0].click();
      checkboxes[1].click();
      await flush();
    });

    const bulkBar = rendered.container.querySelector(".bulk-bar");
    expect(bulkBar).toBeTruthy();
    expect(bulkBar!.querySelector("strong")!.textContent).toBe("2 ausgewählt");

    const archiveButton = Array.from(bulkBar!.querySelectorAll("button")).find(
      (button) => button.textContent === "Archivieren"
    ) as HTMLButtonElement | undefined;
    expect(archiveButton).toBeTruthy();

    await act(async () => {
      archiveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    expect(confirmSpy).toHaveBeenCalledWith("2 Runden wirklich archivieren?");
    expect(posted).toEqual([{ url: "/api/events/bulk", body: { action: "archive", ids: ["e-1", "e-2"] } }]);

    confirmSpy.mockRestore();
    await rendered.cleanup();
  });

  it("die Auswahl übersteht ein Echtzeit-Update (events_changed)", async () => {
    requestMock.mockImplementation(async (url: string) =>
      url === "/api/events" ? { events: [gameEvent({ id: "e-1" }), gameEvent({ id: "e-2" })] } : undefined
    );

    const rendered = await renderBoard(manager);
    const checkboxes = Array.from(
      rendered.container.querySelectorAll("li.device-row input[type='checkbox']")
    ) as HTMLInputElement[];

    await act(async () => {
      checkboxes[0].click();
      await flush();
    });
    expect(rendered.container.querySelector(".bulk-bar strong")!.textContent).toBe("1 ausgewählt");

    // Echtzeit-Update: Board lädt neu (gleiche, weiter aktive Runden) – die Auswahl bleibt bestehen.
    const source = CapturingEventSource.instances[0];
    await act(async () => {
      source.onopen?.();
      source.emit("events_changed", { reason: "participation_updated", at: "2026-11-06T18:00:00.000Z" });
      await flush();
    });

    expect(rendered.container.querySelector(".bulk-bar strong")!.textContent).toBe("1 ausgewählt");
    const checkboxAfter = rendered.container.querySelector(
      "li.device-row input[type='checkbox']"
    ) as HTMLInputElement;
    expect(checkboxAfter.checked).toBe(true);

    await rendered.cleanup();
  });

  it("ein einfacher Spieler bekommt keine Kästchen", async () => {
    requestMock.mockImplementation(async (url: string) =>
      url === "/api/events" ? { events: [gameEvent({ id: "e-1" })] } : undefined
    );

    const rendered = await renderBoard(user);
    expect(rendered.container.querySelector("li.device-row")).toBeTruthy();
    expect(rendered.container.querySelector("li.device-row input[type='checkbox']")).toBeNull();
    expect(rendered.container.querySelector(".bulk-bar")).toBeNull();

    await rendered.cleanup();
  });
});
