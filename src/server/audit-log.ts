import { and, count, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DatabaseContext } from "./db/client";
import { auditLogs, users } from "./db/schema";

type AuditActor = Pick<typeof users.$inferSelect, "id" | "username"> | undefined;

type AuditLogInput = {
  actor?: AuditActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

export function maskInviteCode(code: string) {
  const normalized = code.trim();
  if (!normalized) return "";
  if (normalized.length <= 6) {
    return normalized.slice(0, 1) + "***" + normalized.slice(-1);
  }
  return normalized.slice(0, 3) + "***" + normalized.slice(-3);
}

export function writeAuditLog(context: DatabaseContext, input: AuditLogInput) {
  context.db
    .insert(auditLogs)
    .values({
      id: randomUUID(),
      actorUserId: input.actor?.id ?? null,
      actorUsername: input.actor?.username ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: new Date().toISOString()
    })
    .run();
}

export function tryWriteAuditLog(context: DatabaseContext, input: AuditLogInput) {
  try {
    writeAuditLog(context, input);
  } catch (error) {
    console.error("[Matchdesk] audit log failed", error);
  }
}

export type AuditLogQuery = {
  limit?: number;
  offset?: number;
  /** Freitext in Beschreibung, Aktion und Benutzername. */
  q?: string;
  action?: string;
  actor?: string;
};

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function auditFilter(query: AuditLogQuery) {
  const conditions: SQL[] = [];
  const text = query.q?.trim();
  if (text) {
    const pattern = `%${escapeLike(text)}%`;
    conditions.push(
      or(
        sql`${auditLogs.summary} LIKE ${pattern} ESCAPE '\\'`,
        sql`${auditLogs.action} LIKE ${pattern} ESCAPE '\\'`,
        sql`${auditLogs.actorUsername} LIKE ${pattern} ESCAPE '\\'`
      )!
    );
  }
  if (query.action) {
    conditions.push(eq(auditLogs.action, query.action));
  }
  if (query.actor === "__system") {
    conditions.push(sql`${auditLogs.actorUsername} IS NULL`);
  } else if (query.actor) {
    conditions.push(eq(auditLogs.actorUsername, query.actor));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export function listAuditLogs(context: DatabaseContext, limitOrQuery: number | AuditLogQuery = 100) {
  const query = typeof limitOrQuery === "number" ? { limit: limitOrQuery } : limitOrQuery;
  const limit = Math.max(1, Math.min(Number.isFinite(query.limit) ? Number(query.limit) : 100, 500));
  const offset = Math.max(0, Number.isFinite(query.offset) ? Math.floor(Number(query.offset)) : 0);
  return context.db
    .select()
    .from(auditLogs)
    .where(auditFilter(query))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit)
    .offset(offset)
    .all()
    .map((entry) => ({
      ...entry,
      metadata: entry.metadata ? (JSON.parse(entry.metadata) as unknown) : null
    }));
}

export function countAuditLogs(context: DatabaseContext, query: AuditLogQuery = {}) {
  return context.db.select({ total: count() }).from(auditLogs).where(auditFilter(query)).get()?.total ?? 0;
}

/** Vorhandene Aktionen und Benutzer für die Filter-Auswahl. */
export function auditLogFacets(context: DatabaseContext) {
  const actions = context.db
    .selectDistinct({ action: auditLogs.action })
    .from(auditLogs)
    .orderBy(auditLogs.action)
    .all()
    .map((row) => row.action);
  const actors = context.db
    .selectDistinct({ actor: auditLogs.actorUsername })
    .from(auditLogs)
    .orderBy(auditLogs.actorUsername)
    .all()
    .map((row) => row.actor)
    .filter((actor): actor is string => Boolean(actor));
  return { actions, actors };
}
