import cookieParser from "cookie-parser";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createAdminRouter } from "./http/admin-routes";
import { createAuthRouter } from "./http/auth-routes";
import { createEventRouter, refreshEventStatuses } from "./http/event-routes";
import { createRealtimeRouter } from "./http/realtime-routes";
import { createDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { broadcastEventsChanged } from "./realtime/event-bus";

export function createHermesApp() {
  const context = createDb();
  runMigrations(context.sqlite);

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.use("/api/auth", createAuthRouter(context));
  app.use("/api/admin", createAdminRouter(context));
  app.use("/api/events", createEventRouter(context));
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
    close: () => {
      clearInterval(statusInterval);
      context.sqlite.close();
    }
  };
}
