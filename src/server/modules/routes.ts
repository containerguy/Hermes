import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireCsrf } from "../auth/csrf";
import { requireAdmin, requireUser } from "../auth/current-user";
import { enforceApiTokenWriteAccess } from "../auth/matchdesk-auth";
import type { DatabaseContext } from "../db/client";
import { MATCHDESK_MODULE_API } from "./manifest";
import { ModuleError, type ModuleManager } from "./manager";

const installSchema = z.object({
  sourceId: z.string().min(1),
  moduleId: z.string().min(1).max(40),
  version: z.string().max(40).optional(),
  confirm: z.boolean().optional()
});

const updateSchema = z.object({
  version: z.string().max(40).optional(),
  confirm: z.boolean().optional()
});

const uninstallSchema = z.object({
  confirmId: z.string().max(40).optional()
});

function sendError(response: Response, error: unknown) {
  if (error instanceof ModuleError) {
    response.status(error.status).json({ error: error.code, message: error.message, ...(error.details ?? {}) });
    return;
  }
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: "ungueltige_eingabe", issues: error.issues });
    return;
  }
  console.error("[Matchdesk] Modulverwaltung", error);
  response.status(500).json({ error: "modulverwaltung_fehler" });
}

/** Admin › Module: Quellen, Installieren, Aktivieren, Aktualisieren, Deinstallieren, Einstellungen. */
export function createModuleAdminRouter(context: DatabaseContext, manager: ModuleManager) {
  const router = Router();

  function admin(request: Request, response: Response, write = false) {
    const user = requireAdmin(context, request);
    if (!user) {
      response.status(requireUser(context, request) ? 403 : 401).json({
        error: requireUser(context, request) ? "admin_erforderlich" : "nicht_angemeldet"
      });
      return undefined;
    }
    if (write && (!requireCsrf(context, request, response) || !enforceApiTokenWriteAccess(request, response))) {
      return undefined;
    }
    return user;
  }

  function handle(write: boolean, run: (actor: NonNullable<ReturnType<typeof requireAdmin>>, request: Request) => unknown) {
    return async (request: Request, response: Response) => {
      const actor = admin(request, response, write);
      if (!actor) return;
      try {
        const result = await run(actor, request);
        if (result === undefined) response.status(204).end();
        else response.json(result);
      } catch (error) {
        sendError(response, error);
      }
    };
  }

  router.get(
    "/",
    handle(false, () => ({
      matchdeskApi: MATCHDESK_MODULE_API,
      modulesDir: manager.modulesDir,
      sources: manager.listSources(),
      modules: manager.listModules().map((module) => manager.describeModule(module))
    }))
  );

  router.get("/updates", handle(false, (_actor, request) => manager.checkUpdates({ force: request.query.force === "1" })));

  router.post("/sources", handle(true, (actor, request) => ({ source: manager.addSource(actor, request.body) })));
  router.patch(
    "/sources/:sourceId",
    handle(true, (actor, request) => ({ source: manager.updateSource(actor, String(request.params.sourceId), request.body) }))
  );
  router.delete(
    "/sources/:sourceId",
    handle(true, (actor, request) => {
      manager.deleteSource(actor, String(request.params.sourceId));
      return undefined;
    })
  );
  router.get(
    "/sources/:sourceId/modules",
    handle(false, async (_actor, request) => ({
      modules: await manager.listAvailable(String(request.params.sourceId), { force: request.query.force === "1" })
    }))
  );

  router.post("/install", handle(true, (actor, request) => manager.install(actor, installSchema.parse(request.body))));

  router.get("/:moduleId", handle(false, (_actor, request) => ({ module: manager.describeModule(requireModule(manager, request)) })));
  router.post("/:moduleId/enable", handle(true, async (actor, request) => ({ module: await manager.enable(actor, moduleParam(request)) })));
  router.post("/:moduleId/disable", handle(true, async (actor, request) => ({ module: await manager.disable(actor, moduleParam(request)) })));
  router.post(
    "/:moduleId/update",
    handle(true, (actor, request) => manager.update(actor, moduleParam(request), updateSchema.parse(request.body ?? {})))
  );
  router.post(
    "/:moduleId/uninstall",
    handle(true, async (actor, request) => {
      await manager.uninstall(actor, moduleParam(request), uninstallSchema.parse(request.body ?? {}));
      return undefined;
    })
  );
  router.get(
    "/:moduleId/export",
    handle(false, (_actor, request) => manager.exportData(moduleParam(request)))
  );
  router.get(
    "/:moduleId/settings",
    handle(false, (_actor, request) => {
      const module = requireModule(manager, request);
      return { settings: manager.getSettings(module.id), schema: module.manifest.settings ?? null };
    })
  );
  router.put(
    "/:moduleId/settings",
    handle(true, (actor, request) => ({ settings: manager.putSettings(actor, moduleParam(request), request.body?.settings ?? request.body) }))
  );

  return router;
}

function moduleParam(request: Request) {
  return String(request.params.moduleId);
}

function requireModule(manager: ModuleManager, request: Request) {
  const module = manager.getModule(moduleParam(request));
  if (!module) throw new ModuleError("modul_nicht_gefunden", 404);
  return module;
}

/** GET /api/modules: aktive Module mit Menüpunkten für den angemeldeten Benutzer. */
export function createPublicModulesRouter(context: DatabaseContext, manager: ModuleManager) {
  const router = Router();
  router.get("/", (request, response) => {
    const user = requireUser(context, request);
    response.json({ matchdeskApi: MATCHDESK_MODULE_API, modules: manager.publicModules(user) });
  });
  return router;
}
