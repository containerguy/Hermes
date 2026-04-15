import { describe, expect, it } from "vitest";
import { deriveEventStatus, eventInputSchema, shouldAutoArchive } from "./events";

describe("event domain", () => {
  it("rejects maxPlayers below minPlayers", () => {
    const result = eventInputSchema.safeParse({
      gameTitle: "Counter-Strike 2",
      startMode: "scheduled",
      startsAt: "2026-04-15T20:00:00.000Z",
      minPlayers: 5,
      maxPlayers: 4
    });

    expect(result.success).toBe(false);
  });

  it("derives ready and running status", () => {
    expect(
      deriveEventStatus({
        status: "open",
        startsAt: new Date("2026-04-15T20:00:00.000Z"),
        joinedCount: 3,
        minPlayers: 3,
        now: new Date("2026-04-15T19:00:00.000Z")
      })
    ).toBe("ready");

    expect(
      deriveEventStatus({
        status: "ready",
        startsAt: new Date("2026-04-15T20:00:00.000Z"),
        joinedCount: 3,
        minPlayers: 3,
        now: new Date("2026-04-15T20:00:00.000Z")
      })
    ).toBe("running");
  });

  it("auto-archives after the configured time window", () => {
    expect(
      shouldAutoArchive(
        new Date("2026-04-15T10:00:00.000Z"),
        new Date("2026-04-15T18:00:00.000Z"),
        8
      )
    ).toBe(true);
  });
});
