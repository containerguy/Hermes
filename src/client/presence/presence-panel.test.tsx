/* @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { requestJson } from "../api/request";
import { I18nProvider } from "../i18n/I18nContext";
import { buildStartFile, PresencePanel } from "./PresencePanel";

vi.mock("../api/request", () => ({ requestJson: vi.fn() }));
const requestJsonMock = vi.mocked(requestJson);

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale="de">
        <PresencePanel />
      </I18nProvider>
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  requestJsonMock.mockReset();
});

describe("PresencePanel", () => {
  it("groups players by game", async () => {
    requestJsonMock.mockResolvedValue({
      players: [
        {
          userId: "1",
          username: "rene",
          displayName: null,
          games: [{ title: "Counter-Strike 2", launcher: "steam", appId: "730", since: "2026-11-03T18:00:00Z" }],
          updatedAt: "2026-11-03T18:00:30Z"
        },
        {
          userId: "2",
          username: "anna",
          displayName: "Anna",
          games: [{ title: "Counter-Strike 2", launcher: "steam", since: "2026-11-03T18:05:00Z" }],
          updatedAt: "2026-11-03T18:05:30Z"
        }
      ]
    });
    const view = await render();
    expect(requestJsonMock).toHaveBeenCalledWith("/api/presence");
    const games = view.querySelectorAll(".presence-game");
    expect(games).toHaveLength(1);
    expect(games[0].textContent).toContain("Counter-Strike 2");
    expect(games[0].textContent).toContain("2 im Spiel");
    expect(games[0].textContent).toContain("Anna");
    expect(games[0].textContent).toContain("rene");
  });

  it("shows the empty state", async () => {
    requestJsonMock.mockResolvedValue({ players: [] });
    const view = await render();
    expect(view.textContent).toContain("Gerade meldet niemand ein laufendes Spiel.");
  });
});

describe("PresencePanel setup", () => {
  it("offers the download and creates a token for the start file", async () => {
    requestJsonMock.mockImplementation(async (url: string) => {
      if (url === "/api/presence") return { players: [], agentAvailable: true };
      if (url === "/api/auth/api-tokens") return { token: "hm_at_test" };
      throw new Error(url);
    });
    const view = await render();
    expect(view.querySelector('a[href="/api/presence/agent/download"]')).toBeTruthy();
    const create = Array.from(view.querySelectorAll("button")).find((b) => b.textContent === "Agent einrichten");
    await act(async () => {
      create!.click();
      await Promise.resolve();
    });
    expect(requestJsonMock).toHaveBeenCalledWith(
      "/api/auth/api-tokens",
      expect.objectContaining({ method: "POST" })
    );
    expect(view.textContent).toContain("Startdatei herunterladen");
  });

  it("explains when no agent is bundled", async () => {
    requestJsonMock.mockResolvedValue({ players: [], agentAvailable: false });
    const view = await render();
    expect(view.querySelector('a[href="/api/presence/agent/download"]')).toBeNull();
    expect(view.textContent).toContain("keinen fertigen Agenten");
  });

  it("builds a Windows start file next to the exe", () => {
    expect(buildStartFile("https://lan.example", "hm_at_x")).toBe(
      '@echo off\r\ntitle Spielt gerade\r\ncd /d "%~dp0"\r\nhermes-game-agent.exe -server https://lan.example -token hm_at_x -interval 30s\r\npause\r\n'
    );
  });
});
