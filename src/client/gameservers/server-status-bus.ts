import type { ServerStatus } from "../types/core";

type Listener = (servers: ServerStatus[]) => void;

const listeners = new Set<Listener>();

/** Verteilt `servers_changed`-Payloads des bestehenden EventSource an alle Hook-Instanzen. */
export function publishServerStatus(servers: ServerStatus[]) {
  for (const listener of listeners) {
    listener(servers);
  }
}

export function subscribeServerStatus(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
