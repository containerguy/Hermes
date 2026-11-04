/**
 * Ereignisse des Kerns, auf die Module über `ctx.on(...)` hören können.
 *
 * Der Kern meldet hier, Module hören zu. Ein Fehler in einem Modul-Handler darf den Kern
 * nie stören, darum werden Handler einzeln abgesichert.
 */

export type CoreEventMap = {
  "user.deleted": { userId: string };
  "mainEvent.created": { mainEventId: string };
  "mainEvent.started": { mainEventId: string };
  "mainEvent.ended": { mainEventId: string };
  "round.created": { eventId: string };
  "round.started": { eventId: string };
  "round.ended": { eventId: string };
};

export type CoreEventName = keyof CoreEventMap;

export const coreEventNames = [
  "user.deleted",
  "mainEvent.created",
  "mainEvent.started",
  "mainEvent.ended",
  "round.created",
  "round.started",
  "round.ended"
] as const satisfies readonly CoreEventName[];

type Handler = (payload: never) => unknown;

const handlers = new Map<CoreEventName, Set<Handler>>();

export function onCoreEvent<K extends CoreEventName>(name: K, handler: (payload: CoreEventMap[K]) => unknown) {
  const set = handlers.get(name) ?? new Set<Handler>();
  set.add(handler as Handler);
  handlers.set(name, set);
  return () => {
    set.delete(handler as Handler);
  };
}

export function emitCoreEvent<K extends CoreEventName>(name: K, payload: CoreEventMap[K]) {
  for (const handler of handlers.get(name) ?? []) {
    try {
      const result = (handler as (payload: CoreEventMap[K]) => unknown)(payload);
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch((error) => console.error(`[Matchdesk] Modul-Handler für ${name}`, error));
      }
    } catch (error) {
      console.error(`[Matchdesk] Modul-Handler für ${name}`, error);
    }
  }
}
