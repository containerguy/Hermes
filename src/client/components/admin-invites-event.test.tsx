/* @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { AdminPanelInvites } from "./AdminPanelInvites";
import { I18nProvider } from "../i18n/I18nContext";
import { requestJson } from "../api/request";

vi.mock("../api/request", () => ({ requestJson: vi.fn() }));

describe("Einladungscode pro Event", () => {
  it("offers open events for new codes and shows the event of existing codes", async () => {
    vi.mocked(requestJson).mockResolvedValue({
      mainEvents: [
        { id: "m-1", name: "LAN Winter", status: "planned" },
        { id: "m-0", name: "Alt", status: "ended" }
      ]
    });
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider locale="de">
          <AdminPanelInvites
            inviteCodes={[
              {
                id: "i-1",
                code: "ABC",
                label: "Gäste",
                maxUses: 10,
                expiresAt: null,
                revokedAt: null,
                createdAt: "2026-11-03T00:00:00.000Z",
                usedCount: 1,
                mainEventId: "m-1",
                mainEventName: "LAN Winter"
              }
            ]}
            newInvite={{ label: "", maxUses: "", expiresAt: "", mainEventId: "" }}
            inviteDrafts={{}}
            dateTag="de-DE"
            onNewInviteChange={onChange}
            onInviteDraftsChange={vi.fn()}
            onCreate={vi.fn()}
            onUpdate={vi.fn()}
            onDeactivate={vi.fn()}
            onReactivate={vi.fn()}
            onDeleteUnused={vi.fn()}
          />
        </I18nProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const options = Array.from(container.querySelectorAll("form select option")).map((option) => option.textContent);
    expect(options).toEqual(["Kein Event (allgemeiner Code)", "LAN Winter"]);
    expect(container.textContent).toContain("Event: LAN Winter");

    const select = container.querySelector("form select") as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, "m-1");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mainEventId: "m-1" }));

    act(() => root.unmount());
    container.remove();
  });
});
