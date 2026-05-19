import { and, desc, eq, isNull } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { tryWriteAuditLog } from "../../audit-log";
import { hashSessionToken } from "../../auth/sessions";
import type { DatabaseContext } from "../../db/client";
import { userApiTokens } from "../../db/schema";

type Actor = { id: string; username: string };
type ApiTokenRow = typeof userApiTokens.$inferSelect;

export type SerializedApiToken = {
  id: string;
  label: string | null;
  scope: ApiTokenRow["scope"];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export const createApiTokenBodySchema = z.object({
  label: z.string().trim().max(120).optional(),
  scope: z.enum(["full", "read_only"])
});

type CreateInput = z.infer<typeof createApiTokenBodySchema>;

function nowIso() {
  return new Date().toISOString();
}

export function serializeApiToken(row: ApiTokenRow): SerializedApiToken {
  return {
    id: row.id,
    label: row.label,
    scope: row.scope,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt
  };
}

export function listActiveApiTokens(
  context: DatabaseContext,
  userId: string
): SerializedApiToken[] {
  const rows = context.db
    .select()
    .from(userApiTokens)
    .where(and(eq(userApiTokens.userId, userId), isNull(userApiTokens.revokedAt)))
    .orderBy(desc(userApiTokens.createdAt))
    .all();
  return rows.map(serializeApiToken);
}

export type CreateApiTokenResult = {
  token: string;
  apiToken: SerializedApiToken | undefined;
};

export function createApiToken(
  context: DatabaseContext,
  user: Actor,
  input: CreateInput
): CreateApiTokenResult {
  const rawToken = `hm_at_${randomBytes(24).toString("base64url")}`;
  const tokenHash = hashSessionToken(rawToken);
  const id = randomUUID();
  const timestamp = nowIso();

  context.db
    .insert(userApiTokens)
    .values({
      id,
      userId: user.id,
      tokenHash,
      label: input.label?.trim() ? input.label.trim() : null,
      scope: input.scope,
      createdAt: timestamp,
      lastUsedAt: null,
      revokedAt: null
    })
    .run();

  const created = context.db.select().from(userApiTokens).where(eq(userApiTokens.id, id)).get();

  tryWriteAuditLog(context, {
    actor: user,
    action: "api_token.create",
    entityType: "api_token",
    entityId: id,
    summary: `${user.username} hat ein API-Token (${input.scope}) angelegt.`,
    metadata: { scope: input.scope, label: input.label ?? null }
  });

  return { token: rawToken, apiToken: created ? serializeApiToken(created) : undefined };
}

export type RevokeApiTokenResult =
  | { ok: true }
  | { ok: false; status: 404; error: "api_token_nicht_gefunden" };

export function revokeApiToken(
  context: DatabaseContext,
  user: Actor,
  tokenId: string
): RevokeApiTokenResult {
  const row = context.db
    .select()
    .from(userApiTokens)
    .where(and(eq(userApiTokens.id, tokenId), eq(userApiTokens.userId, user.id)))
    .get();

  if (!row || row.revokedAt) {
    return { ok: false, status: 404, error: "api_token_nicht_gefunden" };
  }

  const timestamp = nowIso();
  context.db
    .update(userApiTokens)
    .set({ revokedAt: timestamp })
    .where(eq(userApiTokens.id, row.id))
    .run();

  tryWriteAuditLog(context, {
    actor: user,
    action: "api_token.revoke",
    entityType: "api_token",
    entityId: row.id,
    summary: `${user.username} hat ein API-Token widerrufen.`
  });

  return { ok: true };
}
