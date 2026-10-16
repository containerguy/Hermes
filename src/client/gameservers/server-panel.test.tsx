/* @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { I18nProvider } from "../i18n/I18nContext";
import type { ServerStatus } from "../types/core";
import { ServerPanel } from "./ServerPanel";

vi.mock("../api/request", () => ({ requestJson: vi.fn(async () => ({ lines: [], cursor: 0 })) }));

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
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

const running: ServerStatus = {
  bindingId: "b-cs2",
  ampInstanceId: "i-1",
  ampInstanceName: "Counter-Strike201",
  instanceRunning: true,
  running: true,
  appState: "Ready",
  players: 3,
  maxPlayers: 32,
  host: "cs2.lanparty.example",
  connectIp: "192.168.200.8",
  port: 27015,
  connectScheme: "steam",
  updatedAt: new Date().toISOString(),
  error: null
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("ServerPanel", () => {
  it("shows status, players and a steam connect link but no actions for players", async () => {
    const onAction = vi.fn();
    const rendered = await render(
      <ServerPanel bindingId="b-cs2" status={running} canManage={false} busy={false} onAction={onAction} />
    );

    expect(rendered.container.textContent).toContain("Server läuft");
    expect(rendered.container.textContent).toContain("3 / 32");
    const link = rendered.container.querySelector("a.button-link") as HTMLAnchorElement | null;
    expect(link?.getAttribute("href")).toBe("steam://connect/192.168.200.8:27015");
    expect(rendered.container.querySelector(".server-actions")).toBeNull();
    expect(rendered.container.querySelector(".server-dot--on")).toBeTruthy();
    await rendered.cleanup();
  });

  it("offers start/stop/restart and console to managers and forwards the action", async () => {
    const onAction = vi.fn();
    const rendered = await render(
      <ServerPanel bindingId="b-cs2" status={running} canManage busy={false} onAction={onAction} />
    );

    const buttons = Array.from(rendered.container.querySelectorAll(".server-actions button")) as HTMLButtonElement[];
    const labels = buttons.map((b) => b.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(["Start", "Stopp", "Neustart", "Mehr …", "Konsole"]));
    expect(labels).not.toContain("Abschießen");

    await act(async () => {
      buttons.find((b) => b.textContent?.trim() === "Stopp")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });
    expect(onAction).toHaveBeenCalledWith("stop");

    await act(async () => {
      buttons.find((b) => b.textContent?.trim() === "Mehr …")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });
    expect(rendered.container.textContent).toContain("Abschießen");
    await rendered.cleanup();
  });

  it("shows sleeping servers as joinable with a connect link", async () => {
    const rendered = await render(
      <ServerPanel
        bindingId="b-cs2"
        status={{ ...running, appState: "Sleeping", running: true, players: 0 }}
        canManage={false}
        busy={false}
        onAction={vi.fn()}
      />
    );
    expect(rendered.container.textContent).toContain("Ruhemodus – startet beim Verbinden");
    expect(rendered.container.textContent).not.toContain("Sleeping");
    expect(rendered.container.querySelector(".server-dot--sleep")).toBeTruthy();
    expect(rendered.container.querySelector("a.button-link")).toBeTruthy();
    await rendered.cleanup();
  });

  it("renders a copyable address for the copy scheme and a loading state without status", async () => {
    const rendered = await render(
      <ServerPanel
        bindingId="b-mc"
        status={{ ...running, bindingId: "b-mc", connectScheme: "minecraft", port: 25565, host: "mc.example" }}
        canManage={false}
        busy={false}
        onAction={vi.fn()}
      />
    );
    expect(rendered.container.querySelector("a.button-link")).toBeNull();
    expect(rendered.container.querySelector(".server-endpoint")?.textContent).toBe("mc.example");
    await rendered.cleanup();

    const loading = await render(
      <ServerPanel bindingId="b-x" status={null} canManage={false} busy={false} onAction={vi.fn()} />
    );
    expect(loading.container.textContent).toContain("Serverstatus wird geladen");
    await loading.cleanup();
  });
});
