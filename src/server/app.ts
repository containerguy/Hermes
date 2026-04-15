import cookieParser from "cookie-parser";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createAdminRouter } from "./http/admin-routes";
import { createAuthRouter } from "./http/auth-routes";
import { createEventRouter, refreshEventStatuses } from "./http/event-routes";
import { createPushRouter } from "./http/push-routes";
import { createRealtimeRouter } from "./http/realtime-routes";
import { createDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { broadcastEventsChanged } from "./realtime/event-bus";
import { readSettings } from "./settings";
import {
  flushDatabaseSnapshot,
  restoreDatabaseFromStorageIfNeeded,
  scheduleDatabaseSnapshot
} from "./storage/s3-storage";

export async function createHermesApp() {
  await restoreDatabaseFromStorageIfNeeded();
  const context = createDb();
  runMigrations(context.sqlite);

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
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

  app.get("/api/settings", (_request, response) => {
    response.json({ settings: readSettings(context) });
  });

  app.use("/api/auth", createAuthRouter(context));
  app.use("/api/admin", createAdminRouter(context));
  app.use("/api/events", createEventRouter(context));
  app.use("/api/push", createPushRouter(context));
  app.use("/api/realtime", createRealtimeRouter(context));

  const statusInterval = setInterval(() => {
    if (refreshEventStatuses(context)) {
      broadcastEventsChanged("status_refreshed");
    }
  }, 30_000);

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
    close: async () => {
      clearInterval(statusInterval);
      await flushDatabaseSnapshot(context.sqlite);
      context.sqlite.close();
    }
  };
}
