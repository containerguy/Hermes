import { Router } from "express";
import { z } from "zod";
import { writeAuditLog } from "../audit-log";
import { requireCsrf } from "../auth/csrf";
import { requireUser } from "../auth/current-user";
import { enforceApiTokenWriteAccess } from "../auth/hermes-auth";
import type { DatabaseContext } from "../db/client";
import {
  BindingTitleConflictError,
  bindingInputSchema,
  deleteBinding,
  getBinding,
  listBindings,
  upsertBinding
} from "../domain/gameservers/bindings";
import { canAssignRoles } from "../domain/users";
import { fetchAmpInstances } from "../integrations/amp/amp-client";
import { readSettings } from "../settings";

const KNOWN_AMP_ERRORS = new Set([
  "amp_deaktiviert",
  "amp_nicht_konfiguriert",
  "amp_zugang_erforderlich",
  "amp_ca_ungueltig",
  "amp_auth_fehlgeschlagen",
  "amp_antwort_unlesbar",
  "amp_http_fehler",
  "amp_base_leer"
]);

function mapAmpErrorToCode(message: string): string {
  return KNOWN_AMP_ERRORS.has(message) ? message : "amp_anfrage_fehlgeschlagen";
}

/** Instanzliste: Orga ab organizer (Event-Formular), Bindungspflege nur admin. */
function canListInstances(role: string): boolean {
  return role === "admin" || role === "manager" || role === "organizer";
}

const bindingIdSchema = z.string().min(1).max(64);

export function createAmpIntegrationRouter(context: DatabaseContext) {
  const router = Router();

  router.use((request, response, next) => {
    const user = requireUser(context, request);
    if (!user) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
      if (!enforceApiTokenWriteAccess(request, response)) {
        return;
      }
    }
    next();
  });

  router.get("/instances", async (request, response) => {
    const user = requireUser(context, request);
    if (!user || !canListInstances(user.role)) {
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
      console.error("[Hermes] AMP instances:", msg);
      response.status(502).json({ error: mapAmpErrorToCode(msg) });
    }
  });

  // Bindungen lesen: jeder Angemeldete, nur aktive. Modul aus -> leere Liste (kein 404,
  // damit der Client den Zustand nicht als Fehler behandeln muss).
  router.get("/bindings", (_request, response) => {
    const settings = readSettings(context);
    if (!settings.ampIntegrationEnabled) {
      response.json({ bindings: [] });
      return;
    }
    response.json({ bindings: listBindings(context, { enabledOnly: true }) });
  });

  router.get("/bindings/all", (request, response) => {
    const user = requireUser(context, request);
    if (!user || !canAssignRoles(user)) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }
    response.json({ bindings: listBindings(context) });
  });

  function requireBindingAdmin(request: Parameters<typeof requireUser>[1], response: import("express").Response) {
    const user = requireUser(context, request);
    if (!user || !canAssignRoles(user)) {
      response.status(403).json({ error: "admin_erforderlich" });
      return undefined;
    }
    if (!requireCsrf(context, request, response)) {
      return undefined;
    }
    if (!readSettings(context).ampIntegrationEnabled) {
      response.status(404).json({ error: "amp_deaktiviert" });
      return undefined;
    }
    return user;
  }

  router.post("/bindings", (request, response) => {
    const actor = requireBindingAdmin(request, response);
    if (!actor) return;

    const parsed = bindingInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_bindung" });
      return;
    }

    try {
      const binding = upsertBinding(context, parsed.data);
      writeAuditLog(context, {
        actor,
        action: "gameserver.binding_upsert",
        entityType: "game_server_binding",
        entityId: binding.id,
        summary: `${actor.username} hat die Server-Bindung ${binding.displayTitle} angelegt.`,
        metadata: { ampInstanceName: binding.ampInstanceName, host: binding.host, port: binding.port }
      });
      response.status(201).json({ binding });
    } catch (error) {
      if (error instanceof BindingTitleConflictError) {
        response.status(409).json({ error: "binding_titel_existiert" });
        return;
      }
      throw error;
    }
  });

  router.put("/bindings/:id", (request, response) => {
    const actor = requireBindingAdmin(request, response);
    if (!actor) return;

    const id = bindingIdSchema.safeParse(request.params.id);
    const parsed = bindingInputSchema.safeParse(request.body);
    if (!id.success || !parsed.success) {
      response.status(400).json({ error: "ungueltige_bindung" });
      return;
    }
    if (!getBinding(context, id.data)) {
      response.status(404).json({ error: "binding_nicht_gefunden" });
      return;
    }

    try {
      const binding = upsertBinding(context, parsed.data, id.data);
      writeAuditLog(context, {
        actor,
        action: "gameserver.binding_upsert",
        entityType: "game_server_binding",
        entityId: binding.id,
        summary: `${actor.username} hat die Server-Bindung ${binding.displayTitle} geändert.`,
        metadata: {
          ampInstanceName: binding.ampInstanceName,
          host: binding.host,
          port: binding.port,
          enabled: binding.enabled
        }
      });
      response.json({ binding });
    } catch (error) {
      if (error instanceof BindingTitleConflictError) {
        response.status(409).json({ error: "binding_titel_existiert" });
        return;
      }
      throw error;
    }
  });

  router.delete("/bindings/:id", (request, response) => {
    const actor = requireBindingAdmin(request, response);
    if (!actor) return;

    const id = bindingIdSchema.safeParse(request.params.id);
    const existing = id.success ? getBinding(context, id.data) : null;
    if (!existing) {
      response.status(404).json({ error: "binding_nicht_gefunden" });
      return;
    }

    deleteBinding(context, existing.id);
    writeAuditLog(context, {
      actor,
      action: "gameserver.binding_delete",
      entityType: "game_server_binding",
      entityId: existing.id,
      summary: `${actor.username} hat die Server-Bindung ${existing.displayTitle} gelöscht.`
    });
    response.status(204).end();
  });

  return router;
}
