import { useCallback, useEffect, useState } from "react";
import { requestJson } from "../api/request";
import type { ServerStatus } from "../types/core";
import { subscribeServerStatus } from "./server-status-bus";

const POLL_MS = 30_000;

function indexByBinding(servers: ServerStatus[]): Record<string, ServerStatus> {
  return Object.fromEntries(servers.map((server) => [server.bindingId, server]));
}

/**
 * Live-Status der gebundenen Server (Phase 15): initialer Fetch, SSE über den Bus,
 * 30-s-Polling als Fallback. Ohne aktives Modul oder ohne Login keine Requests.
 */
export function useServerStatus(enabled: boolean, userId: string | undefined) {
  const [byBinding, setByBinding] = useState<Record<string, ServerStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const active = enabled && Boolean(userId);

  const refresh = useCallback(
    async (force = false) => {
      if (!active) {
        return;
      }
      try {
        const result = await requestJson<{ servers: ServerStatus[] }>(
          `/api/integrations/amp/status${force ? "?refresh=1" : ""}`
        );
        setByBinding(indexByBinding(result.servers));
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "amp_anfrage_fehlgeschlagen");
      }
    },
    [active]
  );

  useEffect(() => {
    if (!active) {
      setByBinding({});
      setError(null);
      return undefined;
    }
    void refresh();
    const unsubscribe = subscribeServerStatus((servers) => setByBinding(indexByBinding(servers)));
    const poll = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [active, refresh]);

  return { byBinding, error, refresh };
}
