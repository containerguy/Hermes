import { Router } from "express";
import { requireUser } from "../auth/current-user";
import type { DatabaseContext } from "../db/client";
import { registerEventsClient } from "../realtime/event-bus";

export function createRealtimeRouter(context: DatabaseContext) {
  const router = Router();

  router.get("/events", (request, response) => {
    const user = requireUser(context, request);

    if (!user) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    const unregister = registerEventsClient(response);
    request.on("close", unregister);
  });

  return router;
}
