import { describe, expect, it, vi } from "vitest";
import {
  isPizzaReason,
  parseEventsChangedReason,
  publishEventsChanged,
  subscribeEventsChanged
} from "./events-changed-bus";

describe("events-changed-bus", () => {
  it("verteilt Signale an alle Abonnenten und hört nach dem Abmelden auf", () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = subscribeEventsChanged(first);
    const offSecond = subscribeEventsChanged(second);

    publishEventsChanged("pizza_line_added");
    expect(first).toHaveBeenCalledWith({ reason: "pizza_line_added" });
    expect(second).toHaveBeenCalledWith({ reason: "pizza_line_added" });

    offFirst();
    publishEventsChanged(null);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenLastCalledWith({ reason: null });
    offSecond();
  });

  it("liest den Grund aus dem SSE-Payload", () => {
    expect(parseEventsChangedReason('{"reason":"pizza_session_open","at":"2026-10-17T18:00:00.000Z"}')).toBe(
      "pizza_session_open"
    );
    expect(parseEventsChangedReason('{"at":"x"}')).toBeNull();
    expect(parseEventsChangedReason("kein json")).toBeNull();
    expect(parseEventsChangedReason(undefined)).toBeNull();
  });

  it("erkennt pizza-relevante Gründe", () => {
    expect(isPizzaReason("pizza_menu_changed")).toBe(true);
    expect(isPizzaReason(null)).toBe(true);
    expect(isPizzaReason("event_created")).toBe(false);
  });
});
