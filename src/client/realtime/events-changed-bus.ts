/**
 * Verteilt `events_changed`-Signale des bestehenden EventSource (EventBoard) an weitere
 * Komponenten, z. B. das Pizza-Panel. Kein zweiter EventSource pro Seite.
 *
 * `reason` ist der Grund aus dem SSE-Payload (`pizza_line_added`, `event_created`, …) oder
 * `null`, wenn er fehlt bzw. nach einem Reconnect ein vollständiger Abgleich nötig ist.
 */
export interface EventsChangedSignal {
  reason: string | null;
}

type Listener = (signal: EventsChangedSignal) => void;

const listeners = new Set<Listener>();

export function publishEventsChanged(reason: string | null) {
  const signal: EventsChangedSignal = { reason };
  for (const listener of Array.from(listeners)) {
    listener(signal);
  }
}

export function subscribeEventsChanged(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Liest `reason` aus den SSE-Daten (`{"reason":"…","at":"…"}`); ungültig → `null`. */
export function parseEventsChangedReason(data: unknown): string | null {
  if (typeof data !== "string" || !data) {
    return null;
  }
  try {
    const parsed = JSON.parse(data) as { reason?: unknown };
    return typeof parsed?.reason === "string" && parsed.reason ? parsed.reason : null;
  } catch {
    return null;
  }
}

/** Pizza-relevant: Grund mit Präfix `pizza_` oder unbekannter Grund (lieber einmal zu viel laden). */
export function isPizzaReason(reason: string | null): boolean {
  return reason === null || reason.startsWith("pizza_");
}
