import { z } from "zod";
import type { DatabaseContext } from "./db/client";
import { appSettings } from "./db/schema";
import { brandMarkSchema } from "../shared/brand-mark";
import { appLocaleSchema } from "../shared/locale";
import { projectTemplateSchema } from "../shared/project-template";

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const kioskPathSegmentSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/, "kiosk_pfad_ungueltig");

const kioskSecretSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{12,128}$/, "kiosk_geheimnis_ungueltig");

const settingsObjectSchema = z.object({
  /** Leer = eingebauter Anzeigename je nach UI-Sprache (Mitspielzentrale / MatchDesk). */
  appName: z.string().trim().max(80),
  /** App-Logo in der UI: H (Hermes) oder M (Mitspiel / MatchDesk). */
  brandMark: brandMarkSchema,
  /**
   * Inhaltliches Projekt-Template: steuert eingebaute UI-Standardtexte (Client-i18n-Overlays).
   * `lan_party` = bisherige LAN-Party-Kopie; `table_tennis` = Sport/Turnier.
   */
  projectTemplate: projectTemplateSchema,
  defaultNotificationsEnabled: z.boolean(),
  eventAutoArchiveHours: z.number().int().min(1).max(72),
  publicRegistrationEnabled: z.boolean(),
  /** Leer = eingebaute Start-Hero-Überschrift aus dem Client */
  shellStartTitle: z.string().max(240),
  /** Leer = kein Beschreibungsabsatz im Start-Hero */
  shellStartDescription: z.string().max(2000),
  /** Leer = eingebauter Leerzustand-Titel im Event-Board */
  shellEventsEmptyTitle: z.string().max(240),
  /** Leer = eingebauter Leerzustand-Fließtext */
  shellEventsEmptyBody: z.string().max(2000),
  gameCatalog: z.array(z.string().trim().min(1).max(160)).max(100),
  themePrimaryColor: colorSchema,
  themeLoginColor: colorSchema,
  themeManagerColor: colorSchema,
  themeAdminColor: colorSchema,
  themeSurfaceColor: colorSchema,
  infosEnabled: z.boolean(),
  infosMarkdown: z.string().max(100_000),
  /**
   * true (Default): S3-Snapshots aktiv, wenn HERMES_STORAGE_BACKEND=s3.
   * false: keine S3-Backups/Restores in der laufenden Instanz (Env kann trotzdem s3 sein).
   */
  s3SnapshotEnabled: z.boolean(),
  /**
   * Fallback-Sprache, wenn die Browsersprache weder eindeutig deutsch noch englisch ist.
   * Beeinflusst auch serverseitige Defaults (z. B. Registrierung ohne Client-Locale).
   */
  defaultLocale: appLocaleSchema,
  /**
   * Öffentliche Anzeige (Kiosk) für aktive Spielrunden ohne Login.
   * URL: /{kioskStreamPath}?id={kioskStreamSecret}
   */
  kioskStreamEnabled: z.boolean(),
  /** Ein Pfadsegment ohne Schrägstriche, z. B. stream oder display */
  kioskStreamPath: kioskPathSegmentSchema,
  /** Geheimer Zugriffsschlüssel (Query id), min. 12 Zeichen wenn Kiosk aktiv */
  kioskStreamSecret: z.string().max(128),
  /** PayPal-Handle für Pizzabestellungs-Kassenliste (paypal.me/<handle>). Leer = kein Link. */
  pizzaPaypalHandle: z.string().trim().max(80),
  /** Anzeigename für PayPal-Empfänger in Kassenliste. Leer = kein Hinweis. */
  pizzaPaypalName: z.string().trim().max(120),
  /** Bargeld-Empfänger Hinweis in Kassenliste. Leer = kein Hinweis. */
  pizzaCashRecipient: z.string().trim().max(120)
});

export const settingsSchema = settingsObjectSchema.superRefine((data, ctx) => {
  if (!data.kioskStreamEnabled) {
    return;
  }
  const parsed = kioskSecretSchema.safeParse(data.kioskStreamSecret);
  if (!parsed.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["kioskStreamSecret"],
      message: "kiosk_geheimnis_erforderlich"
    });
  }
});

/** Für partielle Updates/Imports ohne `.partial()` auf ein Schema mit Refinement. */
export const settingsPartialSchema = settingsObjectSchema.partial();

export type HermesSettings = z.infer<typeof settingsSchema>;

/** Öffentliche Teilmenge (kein defaultNotificationsEnabled, eventAutoArchiveHours, s3SnapshotEnabled). */
export type PublicHermesSettings = Pick<
  HermesSettings,
  | "appName"
  | "brandMark"
  | "projectTemplate"
  | "publicRegistrationEnabled"
  | "shellStartTitle"
  | "shellStartDescription"
  | "shellEventsEmptyTitle"
  | "shellEventsEmptyBody"
  | "gameCatalog"
  | "themePrimaryColor"
  | "themeLoginColor"
  | "themeManagerColor"
  | "themeAdminColor"
  | "themeSurfaceColor"
  | "infosEnabled"
  | "infosMarkdown"
  | "defaultLocale"
  | "kioskStreamEnabled"
  | "kioskStreamPath"
  | "pizzaPaypalHandle"
  | "pizzaPaypalName"
  | "pizzaCashRecipient"
>;

export function pickPublicSettings(full: HermesSettings): PublicHermesSettings {
  return {
    appName: full.appName,
    brandMark: full.brandMark,
    projectTemplate: full.projectTemplate,
    publicRegistrationEnabled: full.publicRegistrationEnabled,
    shellStartTitle: full.shellStartTitle,
    shellStartDescription: full.shellStartDescription,
    shellEventsEmptyTitle: full.shellEventsEmptyTitle,
    shellEventsEmptyBody: full.shellEventsEmptyBody,
    gameCatalog: full.gameCatalog,
    themePrimaryColor: full.themePrimaryColor,
    themeLoginColor: full.themeLoginColor,
    themeManagerColor: full.themeManagerColor,
    themeAdminColor: full.themeAdminColor,
    themeSurfaceColor: full.themeSurfaceColor,
    infosEnabled: full.infosEnabled,
    infosMarkdown: full.infosMarkdown,
    defaultLocale: full.defaultLocale,
    kioskStreamEnabled: full.kioskStreamEnabled,
    kioskStreamPath: full.kioskStreamPath,
    pizzaPaypalHandle: full.pizzaPaypalHandle,
    pizzaPaypalName: full.pizzaPaypalName,
    pizzaCashRecipient: full.pizzaCashRecipient
  };
}

export const defaultSettings: HermesSettings = {
  appName: "",
  brandMark: "mitspiel",
  projectTemplate: "lan_party",
  defaultNotificationsEnabled: true,
  eventAutoArchiveHours: 8,
  publicRegistrationEnabled: false,
  shellStartTitle: "",
  shellStartDescription: "",
  shellEventsEmptyTitle: "",
  shellEventsEmptyBody: "",
  gameCatalog: [],
  themePrimaryColor: "#0f766e",
  themeLoginColor: "#be123c",
  themeManagerColor: "#b7791f",
  themeAdminColor: "#2563eb",
  themeSurfaceColor: "#f6f8f4",
  infosEnabled: false,
  infosMarkdown: "",
  s3SnapshotEnabled: true,
  defaultLocale: "de",
  kioskStreamEnabled: false,
  kioskStreamPath: "stream",
  kioskStreamSecret: "",
  pizzaPaypalHandle: "",
  pizzaPaypalName: "",
  pizzaCashRecipient: ""
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
