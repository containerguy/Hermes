/* @vitest-environment jsdom */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { LoginPanel } from "./LoginPanel";
import { ApiError } from "../errors/errors";

import type { AppSettings, User } from "../types/core";

vi.mock("../api/request", () => {
  return {
    requestJson: vi.fn()
  };
});

vi.mock("../api/csrf", () => {
  return {
    clearCsrfToken: vi.fn(),
    primeCsrfToken: vi.fn()
  };
});

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

async function renderIntoDocument(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(element);
    await flushMicrotasks();
  });

  return {
    container,
    root,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
        await flushMicrotasks();
      });
      container.remove();
    }
  };
}

const defaultSettings: AppSettings = {
  appName: "Hermes",
  defaultNotificationsEnabled: true,
  eventAutoArchiveHours: 8,
  publicRegistrationEnabled: false,
  shellStartTitle: "",
  shellStartDescription: "",
  shellEventsEmptyTitle: "",
  shellEventsEmptyBody: "",
  themePrimaryColor: "#0f766e",
  themeLoginColor: "#be123c",
   themeManagerColor: "#b7791f",
  themeAdminColor: "#2563eb",
  themeSurfaceColor: "#f6f8f4",
  gameCatalog: [],
  infosEnabled: false,
  infosMarkdown: ""
};

const redeemedUser: User = {
  id: "u1",
  phoneNumber: "+4900000123",
  username: "u",
  displayName: "U",
  email: "u@example.test",
  role: "user",
  notificationsEnabled: true
};

beforeEach(() => {
  window.location.hash = "";
  window.localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  window.location.hash = "";
});

describe("LoginPanel pairing redemption", () => {
  it("renders refreshed login helper copy for request and verify states", async () => {
    const { requestJson } = await import("../api/request");
    const requestJsonMock = requestJson as unknown as ReturnType<typeof vi.fn>;

    requestJsonMock.mockResolvedValue({});

    const rendered = await renderIntoDocument(
      <LoginPanel
        currentUser={null}
        settings={{ ...defaultSettings, publicRegistrationEnabled: true }}
        onLoggedIn={vi.fn()}
        onLoggedOut={vi.fn()}
        onUserUpdated={vi.fn()}
      />
    );

    expect(rendered.container.textContent || "").toContain(
      "Gib deinen Username ein. Hermes schickt den Einmalcode an die hinterlegte E-Mail-Adresse."
    );

    const loginForm = rendered.container.querySelector("form");
    await act(async () => {
      loginForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    expect(rendered.container.textContent || "").toContain(
      "Trage den Code aus der Mail ein und gib diesem Gerät optional einen Namen"
    );
    expect(rendered.container.textContent || "").toContain("Code wurde per E-Mail versendet.");

    await rendered.cleanup();
  });

  it("renders refreshed authenticated profile helper copy and safe empty session state", async () => {
    const { requestJson } = await import("../api/request");
    const requestJsonMock = requestJson as unknown as ReturnType<typeof vi.fn>;

    requestJsonMock.mockImplementation(async (path: string) => {
      if (path === "/api/auth/sessions") {
        return { sessions: [] };
      }
      return {};
    });

    const rendered = await renderIntoDocument(
      <LoginPanel
        currentUser={redeemedUser}
        settings={defaultSettings}
        onLoggedIn={vi.fn()}
        onLoggedOut={vi.fn()}
        onUserUpdated={vi.fn()}
      />
    );

    const text = rendered.container.textContent || "";
    expect(text).toContain("Profil und E-Mail aktuell halten.");
    expect(text).toContain("Push vor dem Match testen.");
    expect(text).toContain("Hermes sendet Standard-Browser-Benachrichtigungen.");
    expect(text).toContain("Klingeltöne und garantiertes Audio kann Hermes nicht erzwingen.");
    expect(text).toMatch(/HTTPS|sicheren Kontext|Lokal|HTTP/);
    expect(rendered.container.querySelector(".runtime-callout")).toBeTruthy();
    expect(text).toContain("Hermes wie eine App nutzen");
    expect(text).toContain("Weiteres Gerät verbinden.");
    expect(text).toContain("Angemeldete Geräte im Blick behalten.");
    expect(text).toContain("Keine Geräte geladen.");
    expect(text).toContain("Aktualisieren lädt deine aktiven Sessions.");

    await rendered.cleanup();
  });

  it("redeems token from URL hash on mount and strips ?pair from the hash", async () => {
    window.location.hash = "#login?pair=PAIR_TOKEN_TEST_VALUE_AAAAAAAAAAAA";

    const { requestJson } = await import("../api/request");
    const requestJsonMock = requestJson as unknown as ReturnType<typeof vi.fn>;

    requestJsonMock.mockImplementation(async (path: string) => {
      if (path === "/api/auth/pair-redeem") {
        return { user: redeemedUser };
      }
      return {};
    });

    const onLoggedIn = vi.fn();

    const rendered = await renderIntoDocument(
      <LoginPanel
        currentUser={null}
        settings={defaultSettings}
        onLoggedIn={onLoggedIn}
        onLoggedOut={vi.fn()}
        onUserUpdated={vi.fn()}
      />
    );

    await act(async () => {
      await flushMicrotasks();
    });

    expect(onLoggedIn).toHaveBeenCalledTimes(1);
    expect(onLoggedIn).toHaveBeenCalledWith(redeemedUser);

    const redeemCalls = requestJsonMock.mock.calls.filter(
      (call) => call[0] === "/api/auth/pair-redeem"
    );
    expect(redeemCalls).toHaveLength(1);

    const redeemBody = JSON.parse(
      (redeemCalls[0][1] as RequestInit).body as string
    ) as { token: string; deviceKey: string; deviceName?: string; pwa?: boolean };
    expect(redeemBody.token).toBe("PAIR_TOKEN_TEST_VALUE_AAAAAAAAAAAA");
    expect(typeof redeemBody.deviceKey).toBe("string");
    expect(redeemBody.deviceKey.length).toBeGreaterThanOrEqual(22);
    expect(redeemBody.deviceName).toBeUndefined();
    expect(typeof redeemBody.pwa).toBe("boolean");

     expect(window.location.hash).not.toContain("pair=");
     expect(window.location.hash).toContain("#login");

    await rendered.cleanup();
  });

  it("does NOT call pair-redeem when no ?pair is in the hash", async () => {
    window.location.hash = "#login";

    const { requestJson } = await import("../api/request");
    const requestJsonMock = requestJson as unknown as ReturnType<typeof vi.fn>;

    requestJsonMock.mockImplementation(async () => {
      return {};
    });

    const rendered = await renderIntoDocument(
      <LoginPanel
        currentUser={null}
        settings={defaultSettings}
        onLoggedIn={vi.fn()}
        onLoggedOut={vi.fn()}
        onUserUpdated={vi.fn()}
      />
    );

    await act(async () => {
      await flushMicrotasks();
    });

    const redeemCalls = requestJsonMock.mock.calls.filter(
      (call) => call[0] === "/api/auth/pair-redeem"
    );
    expect(redeemCalls).toHaveLength(0);

    await rendered.cleanup();
  });

  it("handles pair_token_expired by surfacing a German error", async () => {
    window.location.hash = "#login?pair=PAIR_TOKEN_TEST_VALUE_AAAAAAAAAAAA";

    const { requestJson } = await import("../api/request");
    const requestJsonMock = requestJson as unknown as ReturnType<typeof vi.fn>;

    requestJsonMock.mockImplementation(async (path: string) => {
      if (path === "/api/auth/pair-redeem") {
        throw new ApiError({
          code: "pair_token_expired",
          status: 400,
          body: { error: "pair_token_expired" }
        });
      }
      return {};
    });

    const onLoggedIn = vi.fn();

    const rendered = await renderIntoDocument(
      <LoginPanel
        currentUser={null}
        settings={defaultSettings}
        onLoggedIn={onLoggedIn}
        onLoggedOut={vi.fn()}
        onUserUpdated={vi.fn()}
      />
    );

    await act(async () => {
      await flushMicrotasks();
    });

    expect(onLoggedIn).not.toHaveBeenCalled();
    expect(rendered.container.textContent || "").toContain(
      "Pairing-Code ist abgelaufen"
    );

    expect(window.location.hash).not.toContain("pair=");

    await rendered.cleanup();
  });
});
