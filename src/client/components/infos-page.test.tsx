// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { InfosPage } from "./InfosPage";
import { I18nProvider } from "../i18n/I18nContext";
import { requestJson } from "../api/request";
import type { MainEvent } from "../types/core";

vi.mock("../api/request", () => ({ requestJson: vi.fn() }));
const requestMock = vi.mocked(requestJson);

function mainEvent(overrides: Partial<MainEvent>): MainEvent {
  return {
    id: "m-1",
    name: "LAN Herbst",
    description: null,
    infosMarkdown: null,
    status: "running",
    visibility: "public",
    plannedStartAt: null,
    plannedEndAt: null,
    startedAt: null,
    endedAt: null,
    createdByUserId: "u",
    createdByUsername: "u",
    roundCount: 0,
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

async function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<I18nProvider locale="de">{element}</I18nProvider>);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("Infos pro Event", () => {
  const events = [
    mainEvent({ infosMarkdown: "WLAN: **lan-herbst**" }),
    mainEvent({ id: "m-2", name: "Turnier", infosMarkdown: "Halle 3" }),
    mainEvent({ id: "m-3", name: "Geplant", status: "planned", infosMarkdown: "Später" })
  ];

  it("shows infos of all running events above the general infos when no event is chosen", async () => {
    requestMock.mockResolvedValue({ mainEvents: events });
    const rendered = await render(<InfosPage markdown="Hausordnung" enabled />);
    const headings = Array.from(rendered.container.querySelectorAll("h2")).map((h) => h.textContent);
    expect(headings).toEqual(["Infos zu LAN Herbst", "Infos zu Turnier", "Allgemeine Infos"]);
    expect(rendered.container.textContent).toContain("lan-herbst");
    expect(rendered.container.textContent).not.toContain("Später");
    rendered.cleanup();
  });

  it("shows only the current event's infos and keeps them when general infos are off", async () => {
    requestMock.mockResolvedValue({ mainEvents: events });
    const rendered = await render(<InfosPage markdown="Hausordnung" enabled={false} currentMainEventId="m-3" />);
    const headings = Array.from(rendered.container.querySelectorAll("h2")).map((h) => h.textContent);
    expect(headings).toEqual(["Infos zu Geplant"]);
    expect(rendered.container.textContent).not.toContain("Hausordnung");
    rendered.cleanup();
  });

  it("falls back to the general infos without a heading", async () => {
    requestMock.mockResolvedValue({ mainEvents: [mainEvent({})] });
    const rendered = await render(<InfosPage markdown="Hausordnung" enabled />);
    expect(rendered.container.querySelector("h2")).toBeNull();
    expect(rendered.container.textContent).toContain("Hausordnung");
    rendered.cleanup();
  });
});
