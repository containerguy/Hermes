/* @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { EventBoard } from "./EventBoard";
import { I18nProvider } from "../i18n/I18nContext";
import { requestJson } from "../api/request";
import { subscribeEventsChanged } from "../realtime/events-changed-bus";
import type { User } from "../types/core";

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
