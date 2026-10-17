import { useEffect, useRef } from "react";
import { subscribeEventsChanged } from "./events-changed-bus";

export const LIVE_REFRESH_DEBOUNCE_MS = 300;

/**
 * Ruft `onChange` entprellt auf, wenn ein passendes `events_changed`-Signal eintrifft.
 * Mehrere Signale innerhalb von `debounceMs` ergeben genau einen Aufruf.
 */
export function useEventsChanged(
  onChange: () => void,
  accept: (reason: string | null) => boolean,
  debounceMs = LIVE_REFRESH_DEBOUNCE_MS
) {
  const onChangeRef = useRef(onChange);
  const acceptRef = useRef(accept);
  onChangeRef.current = onChange;
  acceptRef.current = accept;

  useEffect(() => {
    let timer: number | null = null;
    const unsubscribe = subscribeEventsChanged(({ reason }) => {
      if (!acceptRef.current(reason)) {
        return;
      }
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        timer = null;
        onChangeRef.current();
      }, debounceMs);
    });
    return () => {
      unsubscribe();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [debounceMs]);
}
