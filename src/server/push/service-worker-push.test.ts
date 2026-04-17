import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type PushHandler = (event: { data?: { json: () => unknown } | null; waitUntil: (promise: Promise<unknown>) => void }) => void;

type NotificationOptions = {
  body: string;
  icon: string;
  badge: string;
  tag: string;
  renotify: boolean;
  requireInteraction: boolean;
  vibrate: number[];
  actions: Array<{ action: string; title: string }>;
  data: { url: string };
};

function loadServiceWorkerScript() {
  const scriptPath = path.join(process.cwd(), "public", "sw.js");
  return fs.readFileSync(scriptPath, "utf8");
}

function setupPushHarness() {
  const handlers: Record<string, unknown> = {};
  const showNotification = vi.fn(async () => undefined);

  const self = {
    addEventListener: (type: string, handler: unknown) => {
      handlers[type] = handler;
    },
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => undefined)
    },
    registration: {
      showNotification
    }
  };

  vm.runInNewContext(loadServiceWorkerScript(), { self }, { filename: "sw.js" });

  const push = handlers.push as PushHandler | undefined;
  expect(typeof push).toBe("function");

  const dispatch = async (data?: { json: () => unknown } | null) => {
    let waited: Promise<unknown> | null = null;

    push?.({
      data,
      waitUntil: (promise) => {
        waited = promise;
      }
    });

    expect(waited).toBeTruthy();
    await waited;

    const [title, options] = showNotification.mock.lastCall as [string, NotificationOptions];
    return { title, options };
  };

  return { dispatch, showNotification };
}

describe("service worker push handler", () => {
  it("does not crash on malformed push payload and shows a fallback notification (REL-03)", async () => {
    const { dispatch } = setupPushHarness();

    const rendered = await dispatch({
      json: () => {
        throw new Error("boom");
      }
    });

    expect(rendered.title).toBe("Hermes");
    expect(rendered.options).toEqual(
      expect.objectContaining({
        body: "Neue Benachrichtigung",
        icon: "/icon.svg",
        badge: "/icon.svg",
        tag: "hermes-event",
        requireInteraction: false,
        vibrate: [180, 80, 180],
        data: { url: "/" }
      })
    );
  });

  it("uses fallback payload fields when push data is missing", async () => {
    const { dispatch } = setupPushHarness();

    const rendered = await dispatch(undefined);

    expect(rendered.title).toBe("Hermes");
    expect(rendered.options.body).toBe("Neue Benachrichtigung");
    expect(rendered.options.vibrate).toEqual([180, 80, 180]);
    expect(rendered.options.requireInteraction).toBe(false);
    expect(rendered.options.data).toEqual({ url: "/" });
  });

  it("passes through explicit vibrate patterns", async () => {
    const { dispatch } = setupPushHarness();

    const rendered = await dispatch({
      json: () => ({
        title: "Event startet",
        body: "In 5 Minuten",
        url: "/#events",
        vibrate: [300, 120, 300]
      })
    });

    expect(rendered.title).toBe("Event startet");
    expect(rendered.options.body).toBe("In 5 Minuten");
    expect(rendered.options.vibrate).toEqual([300, 120, 300]);
    expect(rendered.options.data).toEqual({ url: "/#events" });
  });

  it("applies fallback vibrate pattern when payload vibrate is absent", async () => {
    const { dispatch } = setupPushHarness();

    const rendered = await dispatch({
      json: () => ({
        title: "Round ready",
        body: "Join now",
        url: "/#events"
      })
    });

    expect(rendered.options.vibrate).toEqual([180, 80, 180]);
  });

  it("passes through requireInteraction flag", async () => {
    const { dispatch } = setupPushHarness();

    const rendered = await dispatch({
      json: () => ({
        title: "Server online",
        body: "Counter-Strike",
        requireInteraction: true
      })
    });

    expect(rendered.options.requireInteraction).toBe(true);
    expect(rendered.options.data).toEqual({ url: "/" });
  });
});
