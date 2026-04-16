import { desc } from "drizzle-orm";
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
    console.error("[Hermes] audit log failed", error);
  }
}

export function listAuditLogs(context: DatabaseContext, limit = 100) {
  return context.db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(Math.max(1, Math.min(limit, 500)))
    .all()
    .map((entry) => ({
      ...entry,
      metadata: entry.metadata ? (JSON.parse(entry.metadata) as unknown) : null
    }));
}
