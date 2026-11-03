import { describe, expect, it } from "vitest";
import { csvCell, isRegistrationClosed, resolveParticipationStatus } from "./main-events";

describe("event registration rules", () => {
  it("puts a join on the waitlist only when the event is full", () => {
    const base = { previous: null, joinedCount: 2, maxParticipants: 2 } as const;
    expect(resolveParticipationStatus({ ...base, requested: "joined" })).toBe("waitlisted");
    expect(resolveParticipationStatus({ ...base, requested: "joined", maxParticipants: null })).toBe("joined");
    expect(resolveParticipationStatus({ ...base, requested: "joined", joinedCount: 1 })).toBe("joined");
    // Wer schon dabei ist, bleibt dabei, auch wenn die Plätze verkleinert wurden.
    expect(resolveParticipationStatus({ ...base, requested: "joined", previous: "joined", joinedCount: 3 })).toBe(
      "joined"
    );
    expect(resolveParticipationStatus({ ...base, requested: "interested" })).toBe("interested");
    expect(resolveParticipationStatus({ ...base, requested: "declined" })).toBe("declined");
  });

  it("closes registration after the deadline only while the event is planned", () => {
    const now = new Date("2026-11-03T12:00:00.000Z");
    const past = "2026-11-03T11:00:00.000Z";
    const future = "2026-11-03T13:00:00.000Z";
    expect(isRegistrationClosed({ status: "planned", registrationDeadline: past }, now)).toBe(true);
    expect(isRegistrationClosed({ status: "planned", registrationDeadline: future }, now)).toBe(false);
    expect(isRegistrationClosed({ status: "planned", registrationDeadline: null }, now)).toBe(false);
    expect(isRegistrationClosed({ status: "running", registrationDeadline: past }, now)).toBe(false);
  });

  it("quotes CSV cells and defuses formulas", () => {
    expect(csvCell('Sag "Hallo"')).toBe('"Sag ""Hallo"""');
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvCell("@cmd")).toBe(`"'@cmd"`);
    expect(csvCell(null)).toBe('""');
    expect(csvCell(3)).toBe('"3"');
  });
});
