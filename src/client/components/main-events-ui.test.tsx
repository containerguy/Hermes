/* @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { EventBoard } from "./EventBoard";
import { MainEventsPanel } from "./MainEventsPanel";
import { MainEventPrompt } from "./MainEventPrompt";
import { MainEventSwitcher } from "./MainEventSwitcher";
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

function setInputValue(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
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
    visibility: "public",
    plannedStartAt: null,
    plannedEndAt: null,
    startedAt: "2026-11-06T16:00:00.000Z",
    endedAt: null,
    createdByUserId: "u-mgr",
    createdByUsername: "mgr",
    roundCount: 1,
    participantCount: 0,
    interestedCount: 0,
    waitlistCount: 0,
    maxParticipants: null,
    registrationDeadline: null,
    registrationClosed: false,
    myParticipation: null,
    myWaitlistPosition: null,
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
  it("shows the Infos entry point only when the admin enabled the general info text", async () => {
    installRequests([mainEvent({})]);
    const withLink = await render(<MainEventsPanel showInfosLink />);
    const link = withLink.container.querySelector('a[href="#main-events/infos"]');
    expect(link?.textContent).toBe("Informationen und Hinweise");
    await withLink.cleanup();

    installRequests([mainEvent({})]);
    const withoutLink = await render(<MainEventsPanel />);
    expect(withoutLink.container.querySelector('a[href="#main-events/infos"]')).toBeNull();
    await withoutLink.cleanup();
  });

  it("groups rounds by event and narrows to the current event from the global switcher", async () => {
    installRequests([mainEvent({})]);
    const rendered = await render(<EventBoard currentUser={manager} mode="events" />);

    expect(rendered.container.textContent).toContain("Läuft gerade: LAN Herbst");
    const groups = Array.from(rendered.container.querySelectorAll(".event-group")).map((group) =>
      group.getAttribute("aria-label")
    );
    expect(groups).toEqual(["LAN Herbst", "Ohne Event"]);
    expect(rendered.container.querySelector('.event-group[aria-label="LAN Herbst"]')?.textContent).toContain("Quake");
    expect(rendered.container.querySelector('.event-group[aria-label="Ohne Event"]')?.textContent).toContain("Solo");

    const collapse = rendered.container.querySelector('.event-group[aria-label="Ohne Event"] button') as HTMLButtonElement;
    await act(async () => {
      collapse.click();
      await flush();
    });
    expect(rendered.container.textContent).not.toContain("Solo");
    await rendered.cleanup();

    installRequests([mainEvent({})]);
    const narrowed = await render(
      <EventBoard currentUser={{ ...manager, currentMainEventId: "m-1" }} mode="events" />
    );
    expect(narrowed.container.querySelector(".event-group")).toBeNull();
    expect(narrowed.container.textContent).toContain("Quake");
    expect(narrowed.container.textContent).not.toContain("Solo");

    const filter = narrowed.container.querySelector(".board-filter select") as HTMLSelectElement;
    await act(async () => {
      setInputValue(filter, "none");
      await flush();
    });
    expect(narrowed.container.textContent).toContain("Solo");
    expect(narrowed.container.textContent).not.toContain("Quake");
    await narrowed.cleanup();
  });

  it("preselects the current event for new rounds, even a planned one", async () => {
    installRequests([mainEvent({}), mainEvent({ id: "m-2", name: "Turnier", status: "planned" })]);
    const rendered = await render(
      <EventBoard currentUser={{ ...manager, currentMainEventId: "m-2" }} mode="manager" />
    );
    const mainEventSelect = Array.from(rendered.container.querySelectorAll("form.event-form select")).find((select) =>
      Array.from((select as HTMLSelectElement).options).some((option) => option.value === "m-2")
    ) as HTMLSelectElement;
    expect(mainEventSelect.value).toBe("m-2");
    await rendered.cleanup();
  });

  it("switches the current event globally and stores it at the user", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    requestMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === "PUT") {
        calls.push({ url, body: JSON.parse(String(options.body)) });
        return { user: { ...manager, currentMainEventId: "m-2" } };
      }
      return {
        mainEvents: [
          mainEvent({ id: "m-2", name: "Turnier", status: "planned" }),
          mainEvent({}),
          mainEvent({ id: "m-3", name: "Alt", status: "ended" })
        ]
      };
    });
    const changed: User[] = [];
    const rendered = await render(<MainEventSwitcher currentUser={manager} onUserChange={(user) => changed.push(user)} />);
    const select = rendered.container.querySelector(".main-event-switcher select") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      "Alle Events",
      "● LAN Herbst",
      "Turnier"
    ]);
    expect(select.value).toBe("");
    await act(async () => {
      setInputValue(select, "m-2");
      await flush();
    });
    expect(calls).toEqual([{ url: "/api/main-events/current", body: { mainEventId: "m-2" } }]);
    expect(changed.at(-1)?.currentMainEventId).toBe("m-2");
    await rendered.cleanup();
  });

  it("preselects the running event and sends null for 'Kein Event'", async () => {
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
    expect(posted.at(-1)?.body).toMatchObject({ gameTitle: "Quake", mainEventId: "m-1" });
    expect(posted.at(-1)?.body).not.toHaveProperty("notifyAll");

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
    expect(posted.at(-1)?.body).toMatchObject({ gameTitle: "Solo", mainEventId: null, notifyAll: false });

    const notifyAll = Array.from(rendered.container.querySelectorAll("form.event-form label")).find((label) =>
      label.textContent?.includes("Alle benachrichtigen")
    )?.querySelector("input") as HTMLInputElement;
    await act(async () => {
      notifyAll.click();
      setInputValue(title, "Laut");
      await flush();
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(posted.at(-1)?.body).toMatchObject({ gameTitle: "Laut", mainEventId: null, notifyAll: true });
    await rendered.cleanup();
  });

  it("makes you choose the event when several run and you joined none or several", async () => {
    const posted = installRequests([mainEvent({}), mainEvent({ id: "m-2", name: "Turnier" })]);
    const rendered = await render(<EventBoard currentUser={manager} mode="manager" />);

    const title = rendered.container.querySelector("form.event-form input") as HTMLInputElement;
    const form = rendered.container.querySelector("form.event-form") as HTMLFormElement;
    const mainEventSelect = Array.from(rendered.container.querySelectorAll("form.event-form select")).find((select) =>
      Array.from((select as HTMLSelectElement).options).some((option) => option.value === "m-2")
    ) as HTMLSelectElement;
    expect(mainEventSelect.selectedOptions[0]?.textContent).toBe("Bitte Event wählen");

    await act(async () => {
      setInputValue(title, "Quake");
      await flush();
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(posted).toEqual([]);
    expect(rendered.container.textContent).toContain("Es laufen mehrere Events");

    await act(async () => {
      setInputValue(mainEventSelect, "m-2");
      await flush();
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(posted.at(-1)?.body).toMatchObject({ gameTitle: "Quake", mainEventId: "m-2" });
    await rendered.cleanup();
  });

  it("preselects the one running event you joined", async () => {
    installRequests([mainEvent({}), mainEvent({ id: "m-2", name: "Turnier", myParticipation: "joined" })]);
    const rendered = await render(<EventBoard currentUser={manager} mode="manager" />);
    const mainEventSelect = Array.from(rendered.container.querySelectorAll("form.event-form select")).find((select) =>
      Array.from((select as HTMLSelectElement).options).some((option) => option.value === "m-2")
    ) as HTMLSelectElement;
    expect(mainEventSelect.value).toBe("m-2");
    await rendered.cleanup();
  });

  it("starts a planned event, also while another one runs", async () => {
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
    const parallel = Array.from(second.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Starten"
    ) as HTMLButtonElement;
    expect(parallel.disabled).toBe(false);
    expect(second.container.textContent).toContain("Beenden");
    await second.cleanup();
  });

  it("asks undecided users about the running event and hides after an answer", async () => {
    window.sessionStorage.clear();
    const posted = installRequests([mainEvent({})]);
    requestMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        posted.push({ url, body: JSON.parse(String(options.body)) as Record<string, unknown> });
        return { mainEvent: mainEvent({ myParticipation: "joined", participantCount: 1 }) };
      }
      return { mainEvents: [mainEvent({})] };
    });
    const rendered = await render(<MainEventPrompt currentUserId="u-mgr" />);
    expect(rendered.container.textContent).toContain("Bist du bei LAN Herbst dabei?");

    const join = Array.from(rendered.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Dabei"
    ) as HTMLButtonElement;
    await act(async () => {
      join.click();
      await flush();
    });
    expect(posted.at(-1)).toEqual({ url: "/api/main-events/m-1/participation", body: { status: "joined" } });
    expect(rendered.container.textContent).toBe("");
    await rendered.cleanup();
  });

  it("asks about several running events one after another", async () => {
    window.sessionStorage.clear();
    installRequests([mainEvent({}), mainEvent({ id: "m-2", name: "Turnier" })]);
    const rendered = await render(<MainEventPrompt currentUserId="u-mgr" />);
    expect(rendered.container.textContent).toContain("Bist du bei LAN Herbst dabei?");
    const later = Array.from(rendered.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Später"
    ) as HTMLButtonElement;
    await act(async () => {
      later.click();
      await flush();
    });
    expect(rendered.container.textContent).toContain("Bist du bei Turnier dabei?");
    await rendered.cleanup();
  });

  it("does not ask again after 'Später' or once the user has decided", async () => {
    window.sessionStorage.clear();
    installRequests([mainEvent({})]);
    const first = await render(<MainEventPrompt currentUserId="u-mgr" />);
    const later = Array.from(first.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Später"
    ) as HTMLButtonElement;
    await act(async () => {
      later.click();
      await flush();
    });
    expect(first.container.textContent).toBe("");
    await first.cleanup();

    const again = await render(<MainEventPrompt currentUserId="u-mgr" />);
    expect(again.container.textContent).toBe("");
    await again.cleanup();

    window.sessionStorage.clear();
    installRequests([mainEvent({ myParticipation: "declined" })]);
    const decided = await render(<MainEventPrompt currentUserId="u-mgr" />);
    expect(decided.container.textContent).toBe("");
    await decided.cleanup();
  });

  it("invites people to a private event and withdraws invitations", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const secret = mainEvent({
      id: "m-3",
      name: "Geheimturnier",
      status: "planned",
      visibility: "private",
      invites: [{ userId: "u-1", username: "anna" }]
    });
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    requestMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method) {
        calls.push({ url, method: options.method, body: options.body ? JSON.parse(String(options.body)) : null });
        return { mainEvent: secret };
      }
      if (url === "/api/main-events/invite-candidates") {
        return { users: [{ id: "u-1", username: "anna" }, { id: "u-2", username: "ben" }] };
      }
      return { mainEvents: [secret] };
    });

    const rendered = await render(<MainEventsPanel />);
    await act(async () => {
      await flush();
    });
    expect(rendered.container.textContent).toContain("privat");
    expect(rendered.container.textContent).toContain("anna");

    const select = rendered.container.querySelector(".main-event-invite-form select") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(["Person auswählen…", "ben"]);
    await act(async () => {
      setInputValue(select, "u-2");
      await flush();
    });
    const inviteButton = rendered.container.querySelector(".main-event-invite-form button") as HTMLButtonElement;
    await act(async () => {
      inviteButton.click();
      await flush();
    });
    expect(calls.at(-1)).toEqual({ url: "/api/main-events/m-3/invites", method: "POST", body: { userIds: ["u-2"] } });

    const remove = rendered.container.querySelector(".main-event-invites li button") as HTMLButtonElement;
    await act(async () => {
      remove.click();
      await flush();
    });
    expect(calls.at(-1)).toEqual({ url: "/api/main-events/m-3/invites/u-1", method: "DELETE", body: null });
    await rendered.cleanup();
  });

  it("shows the events page to regular users with participation but without management", async () => {
    const posted = installRequests([
      mainEvent({ id: "m-1", name: "LAN Herbst", status: "running" }),
      mainEvent({ id: "m-2", name: "Tag 2", status: "planned", myParticipation: "joined" }),
      mainEvent({ id: "m-0", name: "Frühjahr", status: "ended" })
    ]);
    const rendered = await render(<MainEventsPanel canManage={false} />);
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("LAN Herbst");
    expect(text).toContain("Du bist dabei");
    expect(text).not.toContain("Starten");
    expect(text).not.toContain("Neues Event anlegen");
    expect(rendered.container.querySelector("form")).toBeNull();

    // Laufendes Event zuerst, beendetes zuletzt
    const titles = Array.from(rendered.container.querySelectorAll(".main-event-title strong")).map((el) => el.textContent);
    expect(titles).toEqual(["LAN Herbst", "Tag 2", "Frühjahr"]);
    // Beendete Events bieten keine Teilnahme mehr an
    const ended = rendered.container.querySelectorAll(".main-event")[2] as HTMLElement;
    expect(ended.querySelector(".main-event-participation")).toBeNull();

    const join = Array.from(rendered.container.querySelectorAll(".main-event-participation button")).find(
      (button) => button.textContent === "Dabei"
    ) as HTMLButtonElement;
    await act(async () => {
      join.click();
      await flush();
    });
    expect(posted).toEqual([{ url: "/api/main-events/m-1/participation", body: { status: "joined" } }]);
    await rendered.cleanup();
  });

  it("shows seats, waitlist position and interest, and blocks sign-up after the deadline", async () => {
    const posted = installRequests([
      mainEvent({
        id: "m-1",
        status: "planned",
        maxParticipants: 10,
        participantCount: 10,
        waitlistCount: 2,
        interestedCount: 3,
        myParticipation: "waitlisted",
        myWaitlistPosition: 2
      }),
      mainEvent({
        id: "m-2",
        name: "Tag 2",
        status: "planned",
        registrationDeadline: "2026-11-01T12:00:00.000Z",
        registrationClosed: true
      }),
      mainEvent({ id: "m-3", name: "Tag 3", status: "planned" })
    ]);
    const rendered = await render(<MainEventsPanel canManage={false} />);
    const [full, closed, open] = Array.from(rendered.container.querySelectorAll(".main-event")) as HTMLElement[];
    expect(full.textContent).toContain("10 von 10 Plätzen belegt");
    expect(full.textContent).toContain("2 Nachrücker");
    expect(full.textContent).toContain("3 interessiert");
    expect(full.textContent).toContain("Du bist Nachrücker (Platz 2)");
    const fullButtons = Array.from(full.querySelectorAll(".main-event-participation button")).map((b) => b.textContent);
    expect(fullButtons).toEqual(["Nicht dabei"]);

    expect(closed.textContent).toContain("Anmeldeschluss vorbei");
    const closedButtons = Array.from(closed.querySelectorAll(".main-event-participation button")) as HTMLButtonElement[];
    expect(closedButtons.find((b) => b.textContent === "Dabei")!.disabled).toBe(true);
    expect(closedButtons.find((b) => b.textContent === "Interessiert")!.disabled).toBe(true);
    expect(closedButtons.find((b) => b.textContent === "Nicht dabei")!.disabled).toBe(false);

    const interest = Array.from(open.querySelectorAll("button")).find((b) => b.textContent === "Interessiert")!;
    await act(async () => {
      (interest as HTMLButtonElement).click();
      await flush();
    });
    expect(posted).toEqual([{ url: "/api/main-events/m-3/participation", body: { status: "interested" } }]);
    await rendered.cleanup();
  });

  it("lets managers set seats and deadline and see the registration overview with CSV link", async () => {
    const patched: Array<Record<string, unknown>> = [];
    requestMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === "PATCH") {
        patched.push(JSON.parse(String(options.body)) as Record<string, unknown>);
        return { mainEvent: mainEvent({ status: "planned" }) };
      }
      if (url === "/api/main-events/m-1/participants") {
        return {
          participants: [
            { userId: "u-1", username: "anna", displayName: null, status: "joined", updatedAt: "x", waitlistPosition: null },
            { userId: "u-2", username: "bert", displayName: "Bert B.", status: "waitlisted", updatedAt: "x", waitlistPosition: 1 }
          ],
          noResponse: [{ userId: "u-3", username: "carl", displayName: null }]
        };
      }
      if (url === "/api/main-events") return { mainEvents: [mainEvent({ status: "planned" })] };
      throw new Error(`unexpected ${url}`);
    });
    const rendered = await render(<MainEventsPanel />);

    const editor = rendered.container.querySelector(".main-event-registration") as HTMLElement;
    // R5 (HCI-124): Anmeldung ist die häufigste Aktion der Seite und darf nicht hinter <details> stecken.
    expect(editor.tagName).not.toBe("DETAILS");
    const seats = editor.querySelector('input[type="number"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(seats, "12");
      await flush();
    });
    await act(async () => {
      (editor.querySelector("form") as HTMLFormElement).requestSubmit();
      await flush();
    });
    expect(patched).toEqual([{ maxParticipants: 12, registrationDeadline: null, remindersEnabled: true }]);

    const overview = rendered.container.querySelector(".main-event-overview") as HTMLDetailsElement;
    await act(async () => {
      overview.open = true;
      overview.dispatchEvent(new Event("toggle"));
      await flush();
    });
    const text = overview.textContent ?? "";
    expect(text).toContain("Dabei (1)");
    expect(text).toContain("Nachrücker (1)");
    expect(text).toContain("1. Bert B. (bert)");
    expect(text).toContain("Noch keine Antwort (1)");
    expect(overview.querySelector("a")!.getAttribute("href")).toBe("/api/main-events/m-1/participants.csv");
    await rendered.cleanup();
  });

  it("lets managers send a broadcast without expanding anything first", async () => {
    const posted: Array<Record<string, unknown>> = [];
    requestMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === "POST" && url.endsWith("/broadcasts")) {
        posted.push(JSON.parse(String(options.body)) as Record<string, unknown>);
        return { broadcast: { id: "b-1", recipientCount: 3 } };
      }
      if (url.endsWith("/broadcasts")) return { broadcasts: [] };
      if (url === "/api/main-events/m-1/participants") {
        return { participants: [], noResponse: [] };
      }
      if (url === "/api/main-events") return { mainEvents: [mainEvent({ status: "planned" })] };
      throw new Error(`unexpected ${url}`);
    });
    const rendered = await render(<MainEventsPanel />);

    const broadcast = rendered.container.querySelector(".main-event-broadcast") as HTMLElement;
    // R5 (HCI-124): Rundnachricht ist laut Abnahmekriterium ohne Aufklappen erreichbar.
    expect(broadcast.tagName).not.toBe("DETAILS");
    const subject = broadcast.querySelector("input") as HTMLInputElement;
    const body = broadcast.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      setInputValue(subject, "LAN startet bald");
      setInputValue(body, "Bringt Headsets mit.");
      await flush();
    });
    await act(async () => {
      (broadcast.querySelector("form") as HTMLFormElement).requestSubmit();
      await flush();
    });
    expect(posted).toEqual([
      { subject: "LAN startet bald", body: "Bringt Headsets mit.", audience: ["joined", "interested", "waitlisted"] }
    ]);
    await rendered.cleanup();
  });
});
