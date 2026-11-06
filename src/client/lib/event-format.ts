import type { GameEvent } from "../types/core";

export function toDatetimeLocal(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function fromDatetimeLocal(value: string) {
  return new Date(value).toISOString();
}

export function getEventStatusClass(event: GameEvent) {
  if (
    event.status !== "archived" &&
    event.status !== "cancelled" &&
    event.joinedCount >= event.maxPlayers
  ) {
    return "full";
  }

  return event.status;
}

/** Badge-Farbe für den Status einer Runde (einheitliches Badge-System, siehe styles.css). */
export function getEventStatusBadgeModifier(event: GameEvent): string {
  switch (getEventStatusClass(event)) {
    case "open":
    case "ready":
      return "badge--ok";
    case "running":
    case "full":
      return "badge--warn";
    case "cancelled":
      return "badge--danger";
    default:
      return "";
  }
}

export function capacityPercent(event: GameEvent): number {
  if (event.maxPlayers <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((event.joinedCount / event.maxPlayers) * 100));
}
