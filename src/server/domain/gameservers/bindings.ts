import { and, eq, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseContext } from "../../db/client";
import { gameServerBindings } from "../../db/schema";
import { normalizeGameTitle } from "./normalize-title";

export const connectSchemeSchema = z.enum(["steam", "minecraft", "copy"]);

export const bindingInputSchema = z.object({
  displayTitle: z.string().trim().min(1).max(160),
  ampInstanceId: z.string().trim().min(1).max(64),
  ampInstanceName: z.string().trim().min(1).max(120),
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+$/, "ungueltiger_host"),
  port: z.number().int().min(1).max(65535),
  connectScheme: connectSchemeSchema,
  enabled: z.boolean().optional().default(true)
});

export type BindingInput = z.infer<typeof bindingInputSchema>;

export type GameServerBinding = {
  id: string;
  gameTitleNorm: string;
  displayTitle: string;
  ampInstanceId: string;
  ampInstanceName: string;
  host: string;
  port: number;
  connectScheme: z.infer<typeof connectSchemeSchema>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export class BindingTitleConflictError extends Error {
  constructor() {
    super("binding_titel_existiert");
  }
}

function toBinding(row: typeof gameServerBindings.$inferSelect): GameServerBinding {
  return {
    id: row.id,
    gameTitleNorm: row.gameTitleNorm,
    displayTitle: row.displayTitle,
    ampInstanceId: row.ampInstanceId,
    ampInstanceName: row.ampInstanceName,
    host: row.host,
    port: row.port,
    connectScheme: row.connectScheme,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function listBindings(context: DatabaseContext, options?: { enabledOnly?: boolean }) {
  const rows = options?.enabledOnly
    ? context.db.select().from(gameServerBindings).where(eq(gameServerBindings.enabled, true)).all()
    : context.db.select().from(gameServerBindings).all();
  return rows.map(toBinding).sort((a, b) => a.displayTitle.localeCompare(b.displayTitle, "de"));
}

export function getBinding(context: DatabaseContext, id: string): GameServerBinding | null {
  const row = context.db.select().from(gameServerBindings).where(eq(gameServerBindings.id, id)).get();
  return row ? toBinding(row) : null;
}

/** Aktive Bindung zu einem Spieltitel (normalisierter Vergleich) oder null. */
export function findBindingForTitle(context: DatabaseContext, title: string): GameServerBinding | null {
  const norm = normalizeGameTitle(title);
  if (!norm) {
    return null;
  }
  const row = context.db
    .select()
    .from(gameServerBindings)
    .where(and(eq(gameServerBindings.gameTitleNorm, norm), eq(gameServerBindings.enabled, true)))
    .get();
  return row ? toBinding(row) : null;
}

/**
 * Legt eine Bindung an oder aktualisiert sie (per `id`). Der normalisierte Titel ist eindeutig;
 * ein Konflikt mit einer anderen Bindung wirft `BindingTitleConflictError`.
 */
export function upsertBinding(
  context: DatabaseContext,
  input: BindingInput,
  id?: string
): GameServerBinding {
  const gameTitleNorm = normalizeGameTitle(input.displayTitle);
  if (!gameTitleNorm) {
    throw new Error("ungueltige_bindung");
  }

  const conflict = context.db
    .select({ id: gameServerBindings.id })
    .from(gameServerBindings)
    .where(
      id
        ? and(eq(gameServerBindings.gameTitleNorm, gameTitleNorm), ne(gameServerBindings.id, id))
        : eq(gameServerBindings.gameTitleNorm, gameTitleNorm)
    )
    .get();
  if (conflict) {
    throw new BindingTitleConflictError();
  }

  const timestamp = new Date().toISOString();
  const values = {
    gameTitleNorm,
    displayTitle: input.displayTitle,
    ampInstanceId: input.ampInstanceId,
    ampInstanceName: input.ampInstanceName,
    host: input.host,
    port: input.port,
    connectScheme: input.connectScheme,
    enabled: input.enabled,
    updatedAt: timestamp
  };

  if (id) {
    const existing = getBinding(context, id);
    if (!existing) {
      throw new Error("binding_nicht_gefunden");
    }
    context.db.update(gameServerBindings).set(values).where(eq(gameServerBindings.id, id)).run();
    return getBinding(context, id) as GameServerBinding;
  }

  const newId = randomUUID();
  context.db
    .insert(gameServerBindings)
    .values({ id: newId, createdAt: timestamp, ...values })
    .run();
  return getBinding(context, newId) as GameServerBinding;
}

export function deleteBinding(context: DatabaseContext, id: string): boolean {
  const existing = getBinding(context, id);
  if (!existing) {
    return false;
  }
  context.db.delete(gameServerBindings).where(eq(gameServerBindings.id, id)).run();
  return true;
}
