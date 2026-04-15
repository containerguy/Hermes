import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { publicUser, requireAdmin, requireUser } from "../auth/current-user";
import type { DatabaseContext } from "../db/client";
import { users } from "../db/schema";
import { userRoleSchema } from "../domain/users";
import { persistDatabaseSnapshot, restoreDatabaseSnapshotIntoLive } from "../storage/s3-storage";
import { readSettings, settingsSchema, writeSettings } from "../settings";

const createUserSchema = z.object({
  phoneNumber: z.string().trim().min(3).max(40).optional(),
  username: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(160),
  role: userRoleSchema.default("user")
});

const updateUserSchema = z.object({
  phoneNumber: z.string().trim().min(3).max(40).optional(),
  username: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email().max(160).optional(),
  role: userRoleSchema.optional(),
  notificationsEnabled: z.boolean().optional()
});

function nowIso() {
  return new Date().toISOString();
}

function fallbackPhoneNumber(userId: string) {
  return `user:${userId}`;
}

export function createAdminRouter(context: DatabaseContext) {
  const router = Router();

  router.use((request, response, next) => {
    const user = requireUser(context, request);

    if (!user) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    if (user.role !== "admin") {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    next();
  });

  router.get("/users", (_request, response) => {
    const allUsers = context.db.select().from(users).orderBy(asc(users.username)).all();
    response.json({ users: allUsers.map(publicUser) });
  });

  router.post("/users", (request, response) => {
    const admin = requireAdmin(context, request);
    const parsed = createUserSchema.safeParse(request.body);

    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_user" });
      return;
    }

    const timestamp = nowIso();
    const id = randomUUID();

    try {
      context.db
        .insert(users)
        .values({
          id,
          phoneNumber: parsed.data.phoneNumber ?? fallbackPhoneNumber(id),
          username: parsed.data.username,
          email: parsed.data.email,
          role: parsed.data.role,
          notificationsEnabled: readSettings(context).defaultNotificationsEnabled,
          createdByUserId: admin.id,
          createdAt: timestamp,
          updatedAt: timestamp
        })
        .run();
    } catch (error) {
      console.error("[Hermes] Failed to create user", error);
      response.status(409).json({ error: "user_existiert_bereits" });
      return;
    }

    const created = context.db.select().from(users).where(eq(users.id, id)).get();
    response.status(201).json({ user: created ? publicUser(created) : undefined });
  });

  router.patch("/users/:id", (request, response) => {
    const parsed = updateUserSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_user" });
      return;
    }

    const existing = context.db.select().from(users).where(eq(users.id, request.params.id)).get();

    if (!existing) {
      response.status(404).json({ error: "user_nicht_gefunden" });
      return;
    }

    try {
      context.db
        .update(users)
        .set({
          ...parsed.data,
          updatedAt: nowIso()
        })
        .where(eq(users.id, existing.id))
        .run();
    } catch (error) {
      console.error("[Hermes] Failed to update user", error);
      response.status(409).json({ error: "user_update_konflikt" });
      return;
    }

    const updated = context.db.select().from(users).where(eq(users.id, existing.id)).get();
    response.json({ user: updated ? publicUser(updated) : undefined });
  });

  router.get("/settings", (_request, response) => {
    response.json({ settings: readSettings(context) });
  });

  router.put("/settings", (request, response) => {
    const admin = requireAdmin(context, request);
    const parsed = settingsSchema.partial().safeParse(request.body);

    if (!admin) {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_settings" });
      return;
    }

    writeSettings(context, settingsSchema.parse({ ...readSettings(context), ...parsed.data }), admin.id);
    response.json({ settings: readSettings(context) });
  });

  router.post("/backup", async (_request, response) => {
    try {
      await persistDatabaseSnapshot(context.sqlite);
      response.json({ ok: true, message: "backup_erstellt" });
    } catch (error) {
      console.error("[Hermes] Failed to create admin backup", error);
      response.status(500).json({ error: "backup_fehlgeschlagen" });
    }
  });

  router.post("/restore", async (_request, response) => {
    try {
      await restoreDatabaseSnapshotIntoLive(context.sqlite);
      response.json({ ok: true, message: "restore_abgeschlossen" });
    } catch (error) {
      console.error("[Hermes] Failed to restore admin backup", error);
      response.status(500).json({ error: "restore_fehlgeschlagen" });
    }
  });

  return router;
}
