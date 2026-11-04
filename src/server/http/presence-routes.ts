import { inArray, isNull, and } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { requireCsrf } from "../auth/csrf";
import { requireUser } from "../auth/current-user";
import { enforceApiTokenWriteAccess } from "../auth/matchdesk-auth";
import type { DatabaseContext } from "../db/client";
import { users } from "../db/schema";
import {
  AGENT_KEY_PREFIX,
  getAgentKeyInfo,
  issueAgentKey,
  resolveAgentKey,
  revokeAgentKey
} from "../domain/presence/agent-keys";
import { presenceReportSchema, type PresenceStore } from "../domain/presence/game-presence";
import { readSettings } from "../settings";

/**
 * „Spielt gerade“ (optional, Admin schaltet `featuresGamePresenceEnabled` ein).
 *
 * - GET    /api/presence                 wer spielt gerade was (nur angemeldet)
 * - POST   /api/presence/game            Bericht des Agenten (`{ playing: [...] }`)
 * - DELETE /api/presence/game            eigenen Eintrag sofort entfernen (Agent beendet)
 * - POST   /api/presence/agent-key       Agent-Schlüssel (neu) anlegen, alter wird ungültig
 * - DELETE /api/presence/agent-key       Agent-Schlüssel widerrufen
 * - GET    /api/presence/agent/download  Windows-Agent (im Docker-Image unter agent/ mitgebaut)
 *
 * Der Agent meldet sich mit seinem Schlüssel (`Bearer md_ga_…`). Der Schlüssel taugt nur für
 * `/game`; Sitzung + CSRF oder ein API-Token mit Vollzugriff gehen dort ebenfalls.
 */
export const DEFAULT_AGENT_PATH = path.join(process.cwd(), "agent", "matchdesk-game-agent.exe");

function bearer(request: Request) {
  const match = request.get("authorization")?.match(/^\s*Bearer\s+(\S+)\s*$/i);
  return match?.[1];
}

export function createPresenceRouter(
  context: DatabaseContext,
  store: PresenceStore,
  options?: { agentPath?: string }
) {
  const router = Router();
  const agentPath = options?.agentPath ?? DEFAULT_AGENT_PATH;
  const agentAvailable = () => fs.existsSync(agentPath);
  const enabled = () => readSettings(context).featuresGamePresenceEnabled;

  function guard(request: Request, response: Response) {
    if (!enabled()) {
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

  /** Schreibender Zugriff für den eigenen Benutzer: Sitzung + CSRF oder API-Token mit Vollzugriff. */
  function guardWrite(request: Request, response: Response) {
    const user = guard(request, response);
    if (!user || !requireCsrf(context, request, response) || !enforceApiTokenWriteAccess(request, response)) {
      return undefined;
    }
    return user.id;
  }

  /** Für /game zusätzlich: Agent-Schlüssel. */
  function guardReport(request: Request, response: Response) {
    const key = bearer(request);
    if (key?.startsWith(AGENT_KEY_PREFIX)) {
      if (!enabled()) {
        response.status(404).json({ error: "modul_inaktiv" });
        return undefined;
      }
      const userId = resolveAgentKey(context, key);
      if (!userId) {
        response.status(401).json({ error: "agent_schluessel_ungueltig" });
        return undefined;
      }
      return userId;
    }
    return guardWrite(request, response);
  }

  router.get("/", (request, response) => {
    const user = guard(request, response);
    if (!user) {
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
        const row = byId.get(entry.userId)!;
        return {
          userId: entry.userId,
          username: row.username,
          displayName: row.displayName,
          games: entry.games,
          updatedAt: entry.updatedAt
        };
      })
      .sort((a, b) => a.username.localeCompare(b.username));

    response.json({ players, agentAvailable: agentAvailable(), agentKey: getAgentKeyInfo(context, user.id) });
  });

  router.post("/game", (request, response) => {
    const userId = guardReport(request, response);
    if (!userId) {
      return;
    }
    const parsed = presenceReportSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_meldung" });
      return;
    }
    store.report(userId, parsed.data.playing);
    response.status(204).end();
  });

  router.delete("/game", (request, response) => {
    const userId = guardReport(request, response);
    if (!userId) {
      return;
    }
    store.clear(userId);
    response.status(204).end();
  });

  router.post("/agent-key", (request, response) => {
    const userId = guardWrite(request, response);
    if (!userId) {
      return;
    }
    response.status(201).json(issueAgentKey(context, userId));
  });

  router.delete("/agent-key", (request, response) => {
    const userId = guardWrite(request, response);
    if (!userId) {
      return;
    }
    revokeAgentKey(context, userId);
    store.clear(userId);
    response.status(204).end();
  });

  router.get("/agent/download", (request, response) => {
    if (!guard(request, response)) {
      return;
    }
    if (!agentAvailable()) {
      response.status(404).json({ error: "agent_nicht_vorhanden" });
      return;
    }
    response.download(agentPath, "matchdesk-game-agent.exe", {
      headers: { "Content-Type": "application/vnd.microsoft.portable-executable" }
    });
  });

  return router;
}
