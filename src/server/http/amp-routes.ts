import { Router } from "express";
import type { DatabaseContext } from "../db/client";
import { fetchAmpInstances } from "../integrations/amp/amp-client";
import { readSettings } from "../settings";
import { requireUser } from "../auth/current-user";

function mapAmpErrorToCode(message: string): string {
  const known = new Set([
    "amp_deaktiviert",
    "amp_nicht_konfiguriert",
    "amp_auth_fehlgeschlagen",
    "amp_antwort_unlesbar",
    "amp_http_fehler",
    "amp_base_leer"
  ]);
  if (known.has(message)) {
    return message;
  }
  return "amp_anfrage_fehlgeschlagen";
}

function canUseAmpIntegration(role: string): boolean {
  return role === "admin" || role === "manager" || role === "organizer";
}

export function createAmpIntegrationRouter(context: DatabaseContext) {
  const router = Router();

  router.get("/instances", async (request, response) => {
    const user = requireUser(context, request);
    if (!user) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }
    if (!canUseAmpIntegration(user.role)) {
      response.status(403).json({ error: "manager_erforderlich" });
      return;
    }

    const settings = readSettings(context);
    if (!settings.ampIntegrationEnabled) {
      response.status(403).json({ error: "amp_deaktiviert" });
      return;
    }

    try {
      const instances = await fetchAmpInstances(settings);
      response.json({ instances });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "amp_anfrage_fehlgeschlagen";
      const code = mapAmpErrorToCode(msg);
      console.error("[Hermes] AMP instances:", msg);
      response.status(502).json({ error: code });
    }
  });

  return router;
}
