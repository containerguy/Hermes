import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readRequiredEnv } from "../env";
import { createDb } from "./client";
import { runMigrations } from "./migrate";
import { appSettings, users } from "./schema";

const DEFAULT_SETTINGS = {
  appName: "Hermes",
  defaultNotificationsEnabled: true,
  eventAutoArchiveHours: 8
};

function nowIso() {
  return new Date().toISOString();
}

export function bootstrapAdmin() {
  const phoneNumber = readRequiredEnv("HERMES_ADMIN_PHONE");
  const username = readRequiredEnv("HERMES_ADMIN_USERNAME");
  const email = readRequiredEnv("HERMES_ADMIN_EMAIL");
  const { db, sqlite } = createDb();

  runMigrations(sqlite);

  const existingAdmin = db
    .select()
    .from(users)
    .where(eq(users.phoneNumber, phoneNumber))
    .get();

  const timestamp = nowIso();
  const adminId = existingAdmin?.id ?? randomUUID();

  if (existingAdmin) {
    db.update(users)
      .set({
        username,
        email,
        role: "admin",
        notificationsEnabled: true,
        updatedAt: timestamp
      })
      .where(eq(users.id, existingAdmin.id))
      .run();
  } else {
    db.insert(users)
      .values({
        id: adminId,
        phoneNumber,
        username,
        email,
        role: "admin",
        notificationsEnabled: true,
        createdByUserId: null,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run();
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    db.insert(appSettings)
      .values({
        key,
        value: JSON.stringify(value),
        updatedByUserId: adminId,
        updatedAt: timestamp
      })
      .onConflictDoNothing()
      .run();
  }

  sqlite.close();

  return {
    adminId,
    phoneNumber,
    username,
    email
  };
}

const entrypoint = process.argv[1] ? path.basename(process.argv[1]) : "";

if (entrypoint === "bootstrap-admin.ts" || entrypoint === "bootstrap-admin.js") {
  const admin = bootstrapAdmin();
  console.log(`Admin ensured: ${admin.username} <${admin.email}>`);
}
