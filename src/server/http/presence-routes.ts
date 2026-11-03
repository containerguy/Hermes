import { inArray, isNull, and } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { requireCsrf } from "../auth/csrf";
import { requireUser } from "../auth/current-user";
import { enforceApiTokenWriteAccess } from "../auth/hermes-auth";
import type { DatabaseContext } from "../db/client";
import { users } from "../db/schema";
import { presenceReportSchema, type PresenceStore } from "../domain/presence/game-presence";
import { broadcastPresenceChanged } from "../realtime/event-bus";
import { readSettings } from "../settings";

/**
 * „Spielt gerade“ (optional, Admin schaltet `featuresGamePresenceEnabled` ein).
 *
 * - POST   /api/presence/game  Bericht des Agenten (`{ playing: [...] }`), API-Token mit Vollzugriff
 *                              oder Sitzung + CSRF. Gilt immer für den eigenen Benutzer.
 * - DELETE /api/presence/game  eigenen Eintrag sofort entfernen (Agent beendet).
 * - GET    /api/presence       wer spielt gerade was (nur angemeldet).
 * - GET    /api/presence/agent/download  Windows-Agent (im Docker-Image unter agent/ mitgebaut).
 */
export const DEFAULT_AGENT_PATH = path.join(process.cwd(), "agent", "hermes-game-agent.exe");

export function createPresenceRouter(
  context: DatabaseContext,
  store: PresenceStore,
  options?: { agentPath?: string }
) {
  const router = Router();
  const agentPath = options?.agentPath ?? DEFAULT_AGENT_PATH;
  const agentAvailable = () => fs.existsSync(agentPath);

  function guard(request: Request, response: Response) {
    if (!readSettings(context).featuresGamePresenceEnabled) {
      response.status(404).json({ error: "modul_inaktiv" });
      return undefined;
    }
    const user = requireUser(context, request);
    if (!user) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return undefined;
    }
    return user;
  }

  router.get("/", (request, response) => {
    if (!guard(request, response)) {
      return;
    }
    const entries = store.list();
    const userIds = entries.map((entry) => entry.userId);
    const rows =
      userIds.length === 0
        ? []
        : context.db
            .select({ id: users.id, username: users.username, displayName: users.displayName })
            .from(users)
            .where(and(inArray(users.id, userIds), isNull(users.deletedAt)))
            .all();
    const byId = new Map(rows.map((row) => [row.id, row]));

    const players = entries
      .filter((entry) => byId.has(entry.userId))
      .map((entry) => {
        const user = byId.get(entry.userId)!;
        return {
          userId: entry.userId,
          username: user.username,
          displayName: user.displayName,
          games: entry.games,
          updatedAt: entry.updatedAt
        };
      })
      .sort((a, b) => a.username.localeCompare(b.username));

    response.json({ players, agentAvailable: agentAvailable() });
  });

  router.get("/agent/download", (request, response) => {
    if (!guard(request, response)) {
      return;
    }
    if (!agentAvailable()) {
      response.status(404).json({ error: "agent_nicht_vorhanden" });
      return;
    }
    response.download(agentPath, "hermes-game-agent.exe", {
      headers: { "Content-Type": "application/vnd.microsoft.portable-executable" }
    });
  });

  router.post("/game", (request, response) => {
    const user = guard(request, response);
    if (!user || !requireCsrf(context, request, response) || !enforceApiTokenWriteAccess(request, response)) {
      return;
    }
    const parsed = presenceReportSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_meldung" });
      return;
    }
    if (store.report(user.id, parsed.data.playing)) {
      broadcastPresenceChanged();
    }
    response.status(204).end();
  });

  router.delete("/game", (request, response) => {
    const user = guard(request, response);
    if (!user || !requireCsrf(context, request, response) || !enforceApiTokenWriteAccess(request, response)) {
      return;
    }
    if (store.clear(user.id)) {
      broadcastPresenceChanged();
    }
    response.status(204).end();
  });

  return router;
}
