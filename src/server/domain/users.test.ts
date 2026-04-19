import { describe, expect, it } from "vitest";
import { canCreateEvent, canManageEvent } from "./users";

describe("user roles and event permissions", () => {
  it("lets organizers create events", () => {
    expect(canCreateEvent({ role: "organizer" })).toBe(true);
    expect(canCreateEvent({ role: "user" })).toBe(false);
  });

  it("lets organizers manage only their own events", () => {
    expect(
      canManageEvent({ id: "a", role: "organizer" }, { createdByUserId: "a" })
    ).toBe(true);
    expect(
      canManageEvent({ id: "a", role: "organizer" }, { createdByUserId: "b" })
    ).toBe(false);
  });

  it("lets managers manage any event", () => {
    expect(
      canManageEvent({ id: "a", role: "manager" }, { createdByUserId: "b" })
    ).toBe(true);
  });
});
