import { and, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import net from "node:net";
import type { DatabaseContext } from "../db/client";
import { rateLimitAllowlist, rateLimitEntries } from "../db/schema";
 
export type RateLimitScope = "login_request" | "login_verify" | "invite_register" | "pair_token_create";
 
type ScopeConfig = {
  windowSeconds: number;
  maxAttempts: number;
  blockSeconds: number;
};
 
type RateLimitResult =
  | { ok: true }
  | {
      ok: false;
      error: "rate_limit_aktiv";
      retryAfterSeconds: number;
      entryId: string;
    };
 
function nowIso() {
  return new Date().toISOString();
}
 
function secondsUntil(isoTimestamp: string) {
  const ms = new Date(isoTimestamp).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 1000));
}
 
function getScopeConfig(scope: RateLimitScope): ScopeConfig {
  switch (scope) {
    case "login_request":
      return { windowSeconds: 5 * 60, maxAttempts: 5, blockSeconds: 10 * 60 };
    case "login_verify":
      return { windowSeconds: 10 * 60, maxAttempts: 8, blockSeconds: 15 * 60 };
    case "invite_register":
      return { windowSeconds: 30 * 60, maxAttempts: 10, blockSeconds: 30 * 60 };
    case "pair_token_create":
      return { windowSeconds: 10 * 60, maxAttempts: 5, blockSeconds: 15 * 60 };
  }
}
 
function normalizeIp(raw: string | undefined) {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("::ffff:")) return trimmed.slice("::ffff:".length);
  return trimmed;
}
 
function ipv4ToInt(ip: string) {
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  const nums = parts.map((part) => Number(part));
  if (nums.some((num) => !Number.isInteger(num) || num < 0 || num > 255)) return undefined;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}
 
function isIpv4InCidr(ip: string, cidr: string) {
  const [base, maskRaw] = cidr.split("/");
  if (!base || !maskRaw) return false;
  const mask = Number(maskRaw);
  if (!Number.isInteger(mask) || mask < 0 || mask > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === undefined || baseInt === undefined) return false;
  const maskBits = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
  return (ipInt & maskBits) === (baseInt & maskBits);
}
 
function isAllowlistedIp(ip: string | undefined, allowlistRows: Array<{ ip_or_cidr: string }>) {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
 
  for (const entry of allowlistRows) {
    const value = entry.ip_or_cidr.trim();
    if (!value) continue;
    if (value === normalized) return true;
    if (value.includes("/") && net.isIP(normalized) === 4 && isIpv4InCidr(normalized, value)) {
      return true;
    }
  }
 
  return false;
}
 
function redactKey(input: string) {
  return createHash("sha256").update(input).digest("hex");
}
 
export function checkRateLimit(
  context: DatabaseContext,
  input: { scope: RateLimitScope; key: string; sourceIp?: string }
): RateLimitResult {
  const allowlistRows = context.sqlite
    .prepare("SELECT ip_or_cidr FROM rate_limit_allowlist ORDER BY updated_at DESC")
    .all() as Array<{ ip_or_cidr: string }>;
 
  if (isAllowlistedIp(input.sourceIp, allowlistRows)) {
    return { ok: true };
  }
 
  const row = context.db
    .select()
    .from(rateLimitEntries)
    .where(and(eq(rateLimitEntries.scope, input.scope), eq(rateLimitEntries.key, redactKey(input.key))))
    .get();
 
  if (!row?.blockedUntil) {
    return { ok: true };
  }
 
  if (row.blockedUntil <= nowIso()) {
    return { ok: true };
  }
 
  return {
    ok: false,
    error: "rate_limit_aktiv",
    retryAfterSeconds: secondsUntil(row.blockedUntil),
    entryId: row.id
  };
}
 
export function recordRateLimitFailure(
  context: DatabaseContext,
  input: { scope: RateLimitScope; key: string }
) {
  const timestamp = nowIso();
  const config = getScopeConfig(input.scope);
  const redactedKey = redactKey(input.key);
 
  const existing = context.db
    .select()
    .from(rateLimitEntries)
    .where(and(eq(rateLimitEntries.scope, input.scope), eq(rateLimitEntries.key, redactedKey)))
    .get();
 
  if (!existing) {
    const blockedUntil =
      config.maxAttempts <= 1
        ? new Date(Date.now() + config.blockSeconds * 1000).toISOString()
        : null;
 
    context.db
      .insert(rateLimitEntries)
      .values({
        id: randomUUID(),
        scope: input.scope,
        key: redactedKey,
        attemptCount: 1,
        windowStartedAt: timestamp,
        lastAttemptAt: timestamp,
        blockedUntil,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run();
    return;
  }
 
  const windowAgeSeconds = Math.floor(
    (new Date(timestamp).getTime() - new Date(existing.windowStartedAt).getTime()) / 1000
  );
  const withinWindow = windowAgeSeconds >= 0 && windowAgeSeconds <= config.windowSeconds;
  const nextAttemptCount = withinWindow ? existing.attemptCount + 1 : 1;
  const nextWindowStartedAt = withinWindow ? existing.windowStartedAt : timestamp;
 
  const shouldBlock = nextAttemptCount >= config.maxAttempts;
  const nextBlockedUntil = shouldBlock
    ? new Date(Date.now() + config.blockSeconds * 1000).toISOString()
    : null;
 
  context.db
    .update(rateLimitEntries)
    .set({
      attemptCount: nextAttemptCount,
      windowStartedAt: nextWindowStartedAt,
      lastAttemptAt: timestamp,
      blockedUntil: nextBlockedUntil,
      updatedAt: timestamp
    })
    .where(eq(rateLimitEntries.id, existing.id))
    .run();
}
 
export function clearRateLimitBlock(context: DatabaseContext, id: string) {
  context.db.delete(rateLimitEntries).where(eq(rateLimitEntries.id, id)).run();
}
 
export function listRateLimitEntries(context: DatabaseContext) {
  return context.db
    .select()
    .from(rateLimitEntries)
    .orderBy(rateLimitEntries.scope, rateLimitEntries.updatedAt)
    .all();
}
 
export function listRateLimitAllowlist(context: DatabaseContext) {
  return context.db.select().from(rateLimitAllowlist).orderBy(rateLimitAllowlist.updatedAt).all();
}
 
export function addRateLimitAllowlist(
  context: DatabaseContext,
  input: { ipOrCidr: string; note?: string | null }
) {
  const timestamp = nowIso();
  const id = randomUUID();
  context.db
    .insert(rateLimitAllowlist)
    .values({
      id,
      ipOrCidr: input.ipOrCidr.trim(),
      note: input.note ?? null,
      createdAt: timestamp,
      updatedAt: timestamp
    })
    .run();
  return id;
}
 
export function deleteRateLimitAllowlist(context: DatabaseContext, id: string) {
  context.db.delete(rateLimitAllowlist).where(eq(rateLimitAllowlist.id, id)).run();
}

