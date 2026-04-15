import { z } from "zod";
import type { DatabaseContext } from "./db/client";
import { appSettings } from "./db/schema";

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const settingsSchema = z.object({
  appName: z.string().trim().min(1).max(80),
  defaultNotificationsEnabled: z.boolean(),
  eventAutoArchiveHours: z.number().int().min(1).max(72),
  themePrimaryColor: colorSchema,
  themeLoginColor: colorSchema,
  themeManagerColor: colorSchema,
  themeAdminColor: colorSchema,
  themeSurfaceColor: colorSchema
});

export type HermesSettings = z.infer<typeof settingsSchema>;

export const defaultSettings: HermesSettings = {
  appName: "Hermes",
  defaultNotificationsEnabled: true,
  eventAutoArchiveHours: 8,
  themePrimaryColor: "#0f766e",
  themeLoginColor: "#be123c",
  themeManagerColor: "#b7791f",
  themeAdminColor: "#2563eb",
  themeSurfaceColor: "#f6f8f4"
};

function nowIso() {
  return new Date().toISOString();
}

export function readSettings(context: DatabaseContext) {
  const rows = context.db.select().from(appSettings).all();
  const values = Object.fromEntries(
    rows.map((row) => {
      return [row.key, JSON.parse(row.value) as unknown];
    })
  );

  return settingsSchema.parse({
    ...defaultSettings,
    ...values
  });
}

export function writeSettings(
  context: DatabaseContext,
  settings: HermesSettings,
  updatedByUserId: string
) {
  const timestamp = nowIso();

  for (const [key, value] of Object.entries(settings)) {
    context.db
      .insert(appSettings)
      .values({
        key,
        value: JSON.stringify(value),
        updatedByUserId,
        updatedAt: timestamp
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: JSON.stringify(value),
          updatedByUserId,
          updatedAt: timestamp
        }
      })
      .run();
  }
}
