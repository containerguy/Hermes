/* @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { I18nProvider } from "../i18n/I18nContext";
import { requestJson } from "../api/request";
import type { User } from "../types/core";
import { AdminModules } from "./AdminModules";

vi.mock("../api/request", () => ({ requestJson: vi.fn() }));

const admin = { id: "a-1", username: "chef", role: "admin" } as unknown as User;

const manifest = {
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  description: null,
  author: "Jemand",
  homepage: null,
  permissions: [{ key: "demo.manage", label: "Verwalten", scopable: true, defaultRoles: ["manager"] }],
  tables: ["demo_notes"],
  secrets: ["DEMO_TOKEN"],
  network: ["api.example.test"],
  trust: "third_party"
};

let root: Root | undefined;

async function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<I18nProvider locale="de">{element}</I18nProvider>);
  });
  return container;
}

function button(container: HTMLElement, text: string) {
  const found = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text));
  if (!found) throw new Error(`Knopf ${text} fehlt: ${container.textContent}`);
  return found as HTMLButtonElement;
}

afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  vi.mocked(requestJson).mockReset();
});

describe("Admin › Module", () => {
  it("zeigt Update-Empfehlungen und verlangt vor der Installation die Bestätigung der angeforderten Rechte", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    vi.mocked(requestJson).mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === "/api/admin/modules") {
        return {
          sources: [
            { id: "official", name: "Matchdesk (offiziell)", url: "https://github.com/containerguy/matchdesk-modules", ref: "main", trust: "official", tokenEnv: null, lastFetchedAt: null, lastError: null }
          ],
          modules: []
        };
      }
      if (url.startsWith("/api/admin/modules/updates")) return { updates: [{ id: "pizza", installed: "1.0.0", latest: "1.1.0", sourceId: "official" }] };
      if (url.startsWith("/api/admin/modules/sources/official/modules")) {
        return {
          modules: [
            { id: "demo", name: "Demo", description: null, latestCompatible: "1.0.0", versions: [], installed: null, updateAvailable: false }
          ]
        };
      }
      if (url === "/api/admin/modules/install") return { confirmed: false, preview: manifest };
      throw new Error(`unerwartet: ${url}`);
    });

    const container = await render(<AdminModules currentUser={admin} subPath="module" />);
    expect(container.textContent).toContain("Empfohlene Updates");
    expect(container.textContent).toContain("pizza: 1.0.0 → 1.1.0");
    expect(container.textContent).toContain("Noch keine Module installiert");

    await act(async () => button(container, "Module anzeigen").click());
    await act(async () => button(container, "Installieren").click());
    expect(calls.find((call) => call.url === "/api/admin/modules/install")?.body).toEqual({ sourceId: "official", moduleId: "demo" });
    expect(container.textContent).toContain("Drittanbieter-Modul");
    expect(container.textContent).toContain("demo.manage");
    expect(container.textContent).toContain("MATCHDESK_DEMO_TOKEN");
    expect(container.textContent).toContain("api.example.test");

    const confirm = [...container.querySelectorAll(".module-confirm button")][0] as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const checkbox = container.querySelector(".module-confirm input[type=checkbox]") as HTMLInputElement;
    await act(async () => checkbox.click());
    expect(confirm.disabled).toBe(false);
  });
});
