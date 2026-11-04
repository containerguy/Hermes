/*
 * Kalendereinträge im iCalendar-Format (RFC 5545) für Events: als Anhang der Zusage-Mail,
 * als Download und als abonnierbarer Kalender-Link.
 */

export type CalendarEvent = {
  id: string;
  name: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  url: string | null;
  updatedAt: string;
  cancelled?: boolean;
};

/** Ohne Ende gilt ein Event als sechs Stunden lang (Kalender brauchen ein Ende). */
const DEFAULT_DURATION_MS = 6 * 60 * 60 * 1000;

function formatUtc(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Text escapen: Backslash, Semikolon, Komma, Zeilenumbrüche. */
export function escapeIcsText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Zeilen nach 75 Oktetten falten (Folgezeilen beginnen mit einem Leerzeichen), UTF-8-sicher. */
export function foldIcsLine(line: string) {
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char, "utf8");
    const limit = parts.length === 0 ? 75 : 74;
    if (currentBytes + bytes > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function vevent(event: CalendarEvent, uidDomain: string, stamp: string) {
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : new Date(start.getTime() + DEFAULT_DURATION_MS);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.id}@${uidDomain}`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${formatUtc(event.updatedAt)}`,
    `DTSTART:${formatUtc(start.toISOString())}`,
    `DTEND:${formatUtc(end.toISOString())}`,
    `SUMMARY:${escapeIcsText(event.name)}`
  ];
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }
  if (event.url) {
    lines.push(`URL:${event.url}`);
  }
  if (event.cancelled) {
    lines.push("STATUS:CANCELLED");
  }
  lines.push("END:VEVENT");
  return lines;
}

export function buildCalendar(
  events: CalendarEvent[],
  options: { calendarName: string; uidDomain: string; method?: "PUBLISH"; now?: Date }
) {
  const stamp = formatUtc((options.now ?? new Date()).toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Matchdesk//Mitspielzentrale//DE",
    "CALSCALE:GREGORIAN",
    `METHOD:${options.method ?? "PUBLISH"}`,
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
    ...events.filter((event) => event.startsAt).flatMap((event) => vevent(event, options.uidDomain, stamp)),
    "END:VCALENDAR"
  ];
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
