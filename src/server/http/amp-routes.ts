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
import { canAssignRoles, canManageServers } from "../domain/users";
import { checkRateLimit, recordRateLimitFailure } from "../auth/rate-limits";
import { fetchAmpInstances } from "../integrations/amp/amp-client";
import { ampCall, unwrapAmpData } from "../integrations/amp/amp-session";
import { getAllServerStatus, getServerStatus, pollNow } from "../integrations/amp/amp-status";
import { readSettings, type HermesSettings } from "../settings";
import type { GameServerBinding } from "../domain/gameservers/bindings";

/* ---------- Phase 15-02: Steuerung + Konsole ---------- */

const CONTROL_ACTIONS = ["start", "stop", "restart", "update", "kill"] as const;
type ControlAction = (typeof CONTROL_ACTIONS)[number];

/** Instanz-Proxy des Controllers: Methoden der Ziel-Instanz unter ADSModule/Servers/{id}/API/… */
function instanceMethod(binding: GameServerBinding, method: string) {
  return `ADSModule/Servers/${encodeURIComponent(binding.ampInstanceId)}/API/${method}`;
}

/** AMP ActionResult: `{ Status: boolean, Reason?: string }`, ggf. in `result` verpackt. */
function assertActionOk(raw: unknown) {
  const data = unwrapAmpData(raw);
  if (data && typeof data === "object" && "Status" in data && (data as { Status?: unknown }).Status === false) {
    const reason = (data as { Reason?: unknown }).Reason;
    throw new Error(typeof reason === "string" && reason ? reason : "amp_aktion_fehlgeschlagen");
  }
}

async function runControlAction(settings: HermesSettings, binding: GameServerBinding, action: ControlAction) {
  const status = getServerStatus(binding.id);
  switch (action) {
    case "start": {
      if (!status?.instanceRunning) {
        assertActionOk(
          await ampCall(settings, "ADSModule/StartInstance", { InstanceName: binding.ampInstanceName })
        );
        // Die Instanz bootet gerade; Core/Start kann noch scheitern — der Poller zeigt den Verlauf.
        try {
          assertActionOk(await ampCall(settings, instanceMethod(binding, "Core/Start")));
        } catch {
          /* Instanz noch nicht erreichbar */
        }
        return;
      }
      assertActionOk(await ampCall(settings, instanceMethod(binding, "Core/Start")));
      return;
    }
    case "stop":
      assertActionOk(await ampCall(settings, instanceMethod(binding, "Core/Stop")));
      return;
    case "restart":
      assertActionOk(await ampCall(settings, instanceMethod(binding, "Core/Restart")));
      return;
    case "update":
      // Spiel-Update (SteamCMD o. ä.) — nicht ADSModule/UpgradeInstance, das wäre das AMP-Upgrade.
      assertActionOk(await ampCall(settings, instanceMethod(binding, "Core/UpdateApplication")));
      return;
    case "kill":
      assertActionOk(await ampCall(settings, instanceMethod(binding, "Core/Kill")));
      return;
  }
}

type ConsoleLine = { seq: number; ts: string; source: string; text: string };
const CONSOLE_KEEP = 300;
const consoleBuffers = new Map<string, { seq: number; lines: ConsoleLine[] }>();
const SECRET_LINE = /((?:rcon_?password|sv_password|password|passwd|token)\s*[:=]?\s*)(\S+)/gi;

export function maskConsoleSecrets(text: string) {
  return text.replace(SECRET_LINE, "$1***");
}

/**
 * `Core/GetUpdates` liefert pro AMP-Session nur neue Zeilen. Weil Hermes genau eine Session hat,
 * werden die Zeilen serverseitig gepuffert und per Cursor (seq) an beliebig viele Betrachter verteilt.
 */
async function fetchConsole(settings: HermesSettings, binding: GameServerBinding, since: number) {
  const raw = unwrapAmpData(await ampCall(settings, instanceMethod(binding, "Core/GetUpdates")));
  const entries =
    raw && typeof raw === "object" && Array.isArray((raw as { ConsoleEntries?: unknown }).ConsoleEntries)
      ? ((raw as { ConsoleEntries: unknown[] }).ConsoleEntries as Record<string, unknown>[])
      : [];

  const buffer = consoleBuffers.get(binding.id) ?? { seq: 0, lines: [] };
  for (const entry of entries) {
    const text = typeof entry.Contents === "string" ? entry.Contents : "";
    if (!text) continue;
    buffer.seq += 1;
    buffer.lines.push({
      seq: buffer.seq,
      ts: typeof entry.Timestamp === "string" ? entry.Timestamp : new Date().toISOString(),
      source: typeof entry.Source === "string" ? entry.Source : "",
      text: maskConsoleSecrets(text)
    });
  }
  if (buffer.lines.length > CONSOLE_KEEP) {
    buffer.lines.splice(0, buffer.lines.length - CONSOLE_KEEP);
  }
  consoleBuffers.set(binding.id, buffer);

  return { lines: buffer.lines.filter((line) => line.seq > since), cursor: buffer.seq };
}

const consoleCommandSchema = z.object({ command: z.string().trim().min(1).max(200) });

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

  /* ---------- Status (alle Angemeldeten) ---------- */

  router.get("/status", async (request, response) => {
    if (!readSettings(context).ampIntegrationEnabled) {
      response.status(404).json({ error: "amp_deaktiviert" });
      return;
    }
    if (request.query.refresh === "1") {
      await pollNow(context);
    }
    response.json({ servers: getAllServerStatus() });
  });

  /* ---------- Steuerung + Konsole (manager+) ---------- */

  function requireServerManager(
    request: Parameters<typeof requireUser>[1],
    response: import("express").Response
  ) {
    const user = requireUser(context, request);
    if (!user || !canManageServers(user)) {
      response.status(403).json({ error: "manager_erforderlich" });
      return undefined;
    }
    if (!readSettings(context).ampIntegrationEnabled) {
      response.status(404).json({ error: "amp_deaktiviert" });
      return undefined;
    }
    const binding = getBinding(context, String(request.params.bindingId ?? ""));
    if (!binding) {
      response.status(404).json({ error: "binding_nicht_gefunden" });
      return undefined;
    }
    if (!binding.enabled) {
      response.status(409).json({ error: "binding_deaktiviert" });
      return undefined;
    }
    return { user, binding };
  }

  router.post("/instances/:bindingId/:action", async (request, response, next) => {
    const action = request.params.action as ControlAction;
    if ((action as string) === "console") {
      // gehört zur Konsolen-Route weiter unten
      next();
      return;
    }
    if (!CONTROL_ACTIONS.includes(action)) {
      response.status(404).json({ error: "unbekannte_aktion" });
      return;
    }
    const guard = requireServerManager(request, response);
    if (!guard) return;
    if (!requireCsrf(context, request, response)) return;

    const rateLimit = checkRateLimit(context, {
      scope: "amp_control",
      key: `user:${guard.user.id}`,
      sourceIp: request.ip
    });
    if (!rateLimit.ok) {
      response.status(429).json({ error: rateLimit.error, retryAfterSeconds: rateLimit.retryAfterSeconds });
      return;
    }
    // Jede Aktion zählt als Versuch (checkRateLimit prüft nur eine bestehende Sperre).
    recordRateLimitFailure(context, { scope: "amp_control", key: `user:${guard.user.id}` });

    try {
      await runControlAction(readSettings(context), guard.binding, action);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "amp_anfrage_fehlgeschlagen";
      console.error(`[Hermes] AMP ${action} ${guard.binding.ampInstanceName}:`, msg);
      response.status(502).json({ error: mapAmpErrorToCode(msg) });
      return;
    }

    writeAuditLog(context, {
      actor: guard.user,
      action: `amp.instance_${action}`,
      entityType: "game_server_binding",
      entityId: guard.binding.id,
      summary: `${guard.user.username}: ${action} auf ${guard.binding.ampInstanceName} (${guard.binding.displayTitle}).`,
      metadata: { ampInstanceName: guard.binding.ampInstanceName, action }
    });
    void pollNow(context);
    response.json({ ok: true });
  });

  router.get("/instances/:bindingId/console", async (request, response) => {
    const guard = requireServerManager(request, response);
    if (!guard) return;
    const since = Number.parseInt(String(request.query.since ?? "0"), 10);

    try {
      response.json(await fetchConsole(readSettings(context), guard.binding, Number.isFinite(since) ? since : 0));
    } catch (error) {
      const msg = error instanceof Error ? error.message : "amp_anfrage_fehlgeschlagen";
      response.status(502).json({ error: mapAmpErrorToCode(msg) });
    }
  });

  router.post("/instances/:bindingId/console", async (request, response) => {
    const guard = requireServerManager(request, response);
    if (!guard) return;
    if (!requireCsrf(context, request, response)) return;

    const parsed = consoleCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_befehl" });
      return;
    }
    const rateLimit = checkRateLimit(context, {
      scope: "amp_control",
      key: `user:${guard.user.id}`,
      sourceIp: request.ip
    });
    if (!rateLimit.ok) {
      response.status(429).json({ error: rateLimit.error, retryAfterSeconds: rateLimit.retryAfterSeconds });
      return;
    }
    // Jede Aktion zählt als Versuch (checkRateLimit prüft nur eine bestehende Sperre).
    recordRateLimitFailure(context, { scope: "amp_control", key: `user:${guard.user.id}` });

    try {
      await ampCall(readSettings(context), instanceMethod(guard.binding, "Core/SendConsoleMessage"), {
        message: parsed.data.command
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "amp_anfrage_fehlgeschlagen";
      response.status(502).json({ error: mapAmpErrorToCode(msg) });
      return;
    }

    writeAuditLog(context, {
      actor: guard.user,
      action: "amp.console_command",
      entityType: "game_server_binding",
      entityId: guard.binding.id,
      summary: `${guard.user.username} hat einen Konsolenbefehl an ${guard.binding.ampInstanceName} gesendet.`,
      metadata: { ampInstanceName: guard.binding.ampInstanceName, command: maskConsoleSecrets(parsed.data.command) }
    });
    response.json({ ok: true });
  });

  return router;
}
