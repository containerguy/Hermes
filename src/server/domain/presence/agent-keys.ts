import { and, eq, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { hashSessionToken } from "../../auth/sessions";
import type { DatabaseContext } from "../../db/client";
import { gameAgentKeys, users } from "../../db/schema";

/** Präfix, an dem die Presence-Routen einen Agent-Schlüssel erkennen. */
export const AGENT_KEY_PREFIX = "md_ga_";

function nowIso() {
  return new Date().toISOString();
}

/** Legt den Agent-Schlüssel des Benutzers neu an; ein älterer Schlüssel wird damit ungültig. */
export function issueAgentKey(context: DatabaseContext, userId: string): { key: string; createdAt: string } {
  const key = `${AGENT_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  const createdAt = nowIso();
  const keyHash = hashSessionToken(key);
  context.db
    .insert(gameAgentKeys)
    .values({ userId, keyHash, createdAt, lastUsedAt: null })
    .onConflictDoUpdate({ target: gameAgentKeys.userId, set: { keyHash, createdAt, lastUsedAt: null } })
    .run();
  return { key, createdAt };
}

export function revokeAgentKey(context: DatabaseContext, userId: string) {
  context.db.delete(gameAgentKeys).where(eq(gameAgentKeys.userId, userId)).run();
}

export function getAgentKeyInfo(context: DatabaseContext, userId: string) {
  const row = context.db
    .select({ createdAt: gameAgentKeys.createdAt, lastUsedAt: gameAgentKeys.lastUsedAt })
    .from(gameAgentKeys)
    .where(eq(gameAgentKeys.userId, userId))
    .get();
  return row ?? null;
}

/** Benutzer zum Schlüssel (nur aktive, nicht gelöschte Benutzer) und letzte Nutzung vermerken. */
export function resolveAgentKey(context: DatabaseContext, key: string) {
  if (!key.startsWith(AGENT_KEY_PREFIX)) {
    return undefined;
  }
  const row = context.db
    .select({ userId: gameAgentKeys.userId })
    .from(gameAgentKeys)
    .innerJoin(users, eq(gameAgentKeys.userId, users.id))
    .where(and(eq(gameAgentKeys.keyHash, hashSessionToken(key)), isNull(users.deletedAt)))
    .get();
  if (!row) {
    return undefined;
  }
  context.db.update(gameAgentKeys).set({ lastUsedAt: nowIso() }).where(eq(gameAgentKeys.userId, row.userId)).run();
  return row.userId;
}
