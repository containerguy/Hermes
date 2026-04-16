import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type PushHandler = (event: { data?: { json: () => unknown } | null; waitUntil: (promise: Promise<unknown>) => void }) => void;

function loadServiceWorkerScript() {
  const scriptPath = path.join(process.cwd(), "public", "sw.js");
  return fs.readFileSync(scriptPath, "utf8");
}

describe("service worker push handler", () => {
  it("does not crash on malformed push payload and shows a fallback notification (REL-03)", async () => {
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

    let waited: Promise<unknown> | null = null;
    push?.({
      data: { json: () => {
        throw new Error("boom");
      } },
      waitUntil: (promise) => {
        waited = promise;
      }
    });

    expect(waited).toBeTruthy();
    await waited;

    expect(showNotification).toHaveBeenCalledWith(
      "Hermes",
      expect.objectContaining({
        body: "Neue Benachrichtigung",
        icon: "/icon.svg",
        data: { url: "/" }
      })
    );
  });
});

