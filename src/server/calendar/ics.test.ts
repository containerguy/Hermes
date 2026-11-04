import { describe, expect, it } from "vitest";
import { buildCalendar, escapeIcsText, foldIcsLine } from "./ics";

describe("iCalendar", () => {
  it("escapes text and folds long lines", () => {
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\;c\\\\d\\ne");
    const folded = foldIcsLine(`DESCRIPTION:${"ä".repeat(60)}`);
    for (const line of folded.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
  });

  it("builds a calendar with default end", () => {
    const text = buildCalendar(
      [
        {
          id: "e1",
          name: "LAN, Winter",
          description: null,
          startsAt: "2026-12-01T16:00:00.000Z",
          endsAt: null,
          url: "https://lan.example/#main-events",
          updatedAt: "2026-11-01T00:00:00.000Z"
        }
      ],
      { calendarName: "Test", uidDomain: "lan.example", now: new Date("2026-11-04T00:00:00.000Z") }
    );
    expect(text).toContain("DTSTART:20261201T160000Z");
    expect(text).toContain("DTEND:20261201T220000Z");
    expect(text).toContain("SUMMARY:LAN\\, Winter");
    expect(text).toContain("UID:e1@lan.example");
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
