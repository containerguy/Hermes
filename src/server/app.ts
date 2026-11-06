import { can } from "./domain/permissions";
import { createNotificationRouter } from "./http/notification-routes";
import { runEventReminders } from "./notifications/reminders";
import cookieParser from "cookie-parser";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createAdminRouter } from "./http/admin-routes";
import { createAuthRouter } from "./http/auth-routes";
import { createEventRouter, refreshEventStatuses } from "./http/event-routes";
import { createMainEventRouter } from "./http/main-event-routes";
import { createPushRouter } from "./http/push-routes";
import { createRealtimeRouter } from "./http/realtime-routes";
import { createKioskRouter } from "./http/kiosk-routes";
import { createAmpIntegrationRouter } from "./http/amp-routes";
import { startAmpStatusService, stopAmpStatusService } from "./integrations/amp/amp-status";
import { startAmpAutomation, stopAmpAutomation } from "./integrations/amp/amp-automation";
import { createDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { broadcastEventsChanged } from "./realtime/event-bus";
import { requireUser } from "./auth/current-user";
import { matchdeskAuthMiddleware } from "./auth/matchdesk-auth";
import { mountApiDocs } from "./http/api-docs";
import { pickPublicSettings, readSettings } from "./settings";
import {
  flushDatabaseSnapshot,
  restoreDatabaseFromStorageIfNeeded,
  scheduleDatabaseSnapshot
} from "./storage/s3-storage";
import { getReleaseInfo } from "./version-info";
import { createModuleManager, type ModuleManagerOptions } from "./modules/manager";
import { createModuleAdminRouter, createPublicModulesRouter } from "./modules/routes";
import { runBundledTransitions } from "./modules/bundled";
import { createJsonBodyParser } from "./http/raw-body";

export type CreateMatchdeskAppOptions = {
  modules?: ModuleManagerOptions;
};

export async function createMatchdeskApp(options: CreateMatchdeskAppOptions = {}) {
  await restoreDatabaseFromStorageIfNeeded();
  const context = createDb();
  runMigrations(context.sqlite);
  const modules = createModuleManager(context, options.modules);
  await modules.init();
  await runBundledTransitions(context, modules);

  const app = express();
  app.disable("x-powered-by");
  app.use(createJsonBodyParser());
  app.use(cookieParser());
  app.use(matchdeskAuthMiddleware(context));
  mountApiDocs(app);
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("X-Frame-Options", "SAMEORIGIN");
    response.setHeader(
      "Permissions-Policy",
      "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()"
    );
    response.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self'",
        "manifest-src 'self'",
        "worker-src 'self'"
      ].join("; ")
    );
    next();
  });
  app.use((request, response, next) => {
    response.on("finish", () => {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && response.statusCode < 500) {
        scheduleDatabaseSnapshot(context.sqlite);
      }
    });

    next();
  });

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/settings/public", (_request, response) => {
    response.json({
      settings: pickPublicSettings(readSettings(context)),
      release: getReleaseInfo()
    });
  });

  app.get("/api/settings", (request, response) => {
    const user = requireUser(context, request);

    if (!user) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    if (!can(context, user, "admin.access")) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    response.json({ settings: readSettings(context) });
  });

  app.use("/api/auth", createAuthRouter(context));
  app.use("/api/admin/modules", createModuleAdminRouter(context, modules));
  app.use("/api/admin", createAdminRouter(context));
  app.use("/api/events", createEventRouter(context));
  app.use("/api/main-events", createMainEventRouter(context));
  app.use("/api/push", createPushRouter(context));
  app.use("/api/notifications", createNotificationRouter(context));
  app.use("/api/realtime", createRealtimeRouter(context));
  app.use("/api/kiosk", createKioskRouter(context));
  app.use("/api/integrations/amp", createAmpIntegrationRouter(context));
  app.use("/api/modules", createPublicModulesRouter(context, modules));
  // Übergang für eine Version: Pizza war bis 0.16 unter /api/pizza eingebaut. Die alten Pfade werden
  // intern auf das Modul umgeschrieben (keine HTTP-Weiterleitung, damit POST-Bodies erhalten bleiben).
  // Ebenso „Spielt gerade“ unter /api/presence (ältere Windows-Agenten melden noch dorthin).
  app.use((request, _response, next) => {
    for (const [legacy, moduleId] of [
      ["/api/pizza", "pizza"],
      ["/api/presence", "presence"]
    ] as const) {
      const rest = request.url.slice(legacy.length);
      if (request.url.startsWith(legacy) && (rest === "" || rest.startsWith("/") || rest.startsWith("?"))) {
        request.url = `/api/m/${moduleId}${rest}`;
        break;
      }
    }
    next();
  });
  app.use("/api/m/:moduleId", modules.dispatch);
  app.get("/modules/:moduleId/:version/*file", modules.serveClientFile);

  // Geplante Erinnerungen zu Events (7 Tage, 1 Tag, Anmeldeschluss). Unter Vitest ohne Takt.
  const reminderInterval = process.env.VITEST
    ? null
    : setInterval(() => {
        runEventReminders(context).catch((error) => console.error("[Matchdesk] Event reminders failed", error));
      }, 10 * 60 * 1000);

  const statusInterval = setInterval(() => {
    if (refreshEventStatuses(context)) {
      broadcastEventsChanged("status_refreshed");
    }
  }, 30_000);

  // Phase 15: AMP-Statusdienst. Pollt nur, wenn das Modul aktiv ist und Bindungen existieren.
  // Unter Vitest ohne eigenen Takt (Tests stoßen Polls explizit über pollNow an).
  startAmpStatusService(context, process.env.VITEST ? { intervalMs: 60 * 60 * 1000 } : undefined);
  // Phase 15-04: Automatik (Auto-Start/-Stop, Push „Server läuft"), 30-s-Takt; unter Vitest ohne echten Takt.
  startAmpAutomation(context, process.env.VITEST ? { intervalMs: 60 * 60 * 1000 } : undefined);

  const staticDirectory = path.join(process.cwd(), "dist");
  if (fs.existsSync(staticDirectory)) {
    app.use(express.static(staticDirectory));
    app.use((request, response, next) => {
      if (request.path.startsWith("/api/")) {
        next();
        return;
      }

      response.sendFile(path.join(staticDirectory, "index.html"));
    });
  }

  return {
    app,
    modules,
    close: async () => {
      clearInterval(statusInterval);
      if (reminderInterval) {
        clearInterval(reminderInterval);
      }
      await modules.close();
      stopAmpAutomation();
      stopAmpStatusService();
      await flushDatabaseSnapshot(context.sqlite);
      context.sqlite.close();
    }
  };
}
