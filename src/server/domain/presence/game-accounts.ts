import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseContext } from "../../db/client";
import { userGameAccountPrefs, userGameAccounts, users } from "../../db/schema";

/**
 * Spielkonten pro Benutzer. Entscheidung (René, 2026-11-04): Wer den Agenten installiert, stimmt
 * der Nutzung zu. Steam übernimmt der Agent automatisch, solange noch kein Steam-Konto hinterlegt
 * ist; weicht ein erkanntes Konto ab, wartet es als Vorschlag auf „übernehmen“. EA, Battle.net,
 * Epic und Ubisoft pflegt man selbst im Profil.
 */
export const GAME_PLATFORMS = ["steam", "ea", "battlenet", "epic", "ubisoft"] as const;
export type GamePlatform = (typeof GAME_PLATFORMS)[number];

const STEAM_ID64 = /^7656119\d{10}$/;

export const steamAccountSchema = z.object({
  steamId: z.string().regex(STEAM_ID64),
  personaName: z.string().trim().max(64).optional()
});
export type SteamAccountReport = z.infer<typeof steamAccountSchema>;

const manualValue = z.string().trim().max(64).nullable().optional();

/** Profil-Formular: `null` oder leer löscht, fehlendes Feld bleibt unverändert. */
export const gameAccountsUpdateSchema = z.object({
  steam: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === null || value === "") {
        return value === "" ? null : value;
      }
      const id = parseSteamInput(value);
      if (!id) {
        ctx.addIssue({ code: "custom", message: "steam_id_ungueltig" });
        return z.NEVER;
      }
      return id;
    }),
  ea: manualValue,
  battlenet: manualValue,
  epic: manualValue,
  ubisoft: manualValue
});

/** SteamID64 direkt oder aus einem Profil-Link `steamcommunity.com/profiles/<id>`. */
export function parseSteamInput(input: string): string | undefined {
  const trimmed = input.trim();
  if (STEAM_ID64.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/steamcommunity\.com\/profiles\/(7656119\d{10})/);
  return match?.[1];
}

export type GameAccountView = {
  accountId: string;
  displayName: string | null;
  source: "agent" | "manual";
  pending?: { accountId: string; displayName: string | null };
};

function nowIso() {
  return new Date().toISOString();
}

export function getGameAccounts(context: DatabaseContext, userId: string) {
  const rows = context.db.select().from(userGameAccounts).where(eq(userGameAccounts.userId, userId)).all();
  const accounts: Partial<Record<GamePlatform, GameAccountView>> = {};
  for (const row of rows) {
    accounts[row.platform] = {
      accountId: row.accountId,
      displayName: row.displayName,
      source: row.source,
      ...(row.pendingAccountId
        ? { pending: { accountId: row.pendingAccountId, displayName: row.pendingDisplayName } }
        : {})
    };
  }
  const prefs = context.db
    .select()
    .from(userGameAccountPrefs)
    .where(eq(userGameAccountPrefs.userId, userId))
    .get();
  const missing = GAME_PLATFORMS.filter((platform) => !accounts[platform]);
  return { accounts, missing, promptDismissed: Boolean(prefs?.promptDismissedAt) };
}

/**
 * Steam-Konto vom Agenten. Rückgabe: was passiert ist (für Tests und Logs).
 * - kein Steam-Konto hinterlegt → übernehmen
 * - gleiches Konto → Anzeigenamen aktualisieren, Vorschlag verwerfen
 * - anderes Konto → als Vorschlag ablegen
 */
export function reportSteamAccount(
  context: DatabaseContext,
  userId: string,
  report: SteamAccountReport
): "stored" | "updated" | "pending" | "unchanged" {
  const name = report.personaName?.trim() || null;
  const existing = context.db
    .select()
    .from(userGameAccounts)
    .where(and(eq(userGameAccounts.userId, userId), eq(userGameAccounts.platform, "steam")))
    .get();
  const stamp = nowIso();

  if (!existing) {
    context.db
      .insert(userGameAccounts)
      .values({ userId, platform: "steam", accountId: report.steamId, displayName: name, source: "agent", updatedAt: stamp })
      .run();
    return "stored";
  }
  const where = and(eq(userGameAccounts.userId, userId), eq(userGameAccounts.platform, "steam"));
  if (existing.accountId === report.steamId) {
    if (existing.displayName === name && !existing.pendingAccountId) {
      return "unchanged";
    }
    context.db
      .update(userGameAccounts)
      .set({ displayName: name ?? existing.displayName, pendingAccountId: null, pendingDisplayName: null, updatedAt: stamp })
      .where(where)
      .run();
    return "updated";
  }
  if (existing.pendingAccountId === report.steamId && existing.pendingDisplayName === name) {
    return "unchanged";
  }
  context.db
    .update(userGameAccounts)
    .set({ pendingAccountId: report.steamId, pendingDisplayName: name, updatedAt: stamp })
    .where(where)
    .run();
  return "pending";
}

export function acceptPendingSteam(context: DatabaseContext, userId: string): boolean {
  const where = and(eq(userGameAccounts.userId, userId), eq(userGameAccounts.platform, "steam"));
  const existing = context.db.select().from(userGameAccounts).where(where).get();
  if (!existing?.pendingAccountId) {
    return false;
  }
  context.db
    .update(userGameAccounts)
    .set({
      accountId: existing.pendingAccountId,
      displayName: existing.pendingDisplayName,
      source: "agent",
      pendingAccountId: null,
      pendingDisplayName: null,
      updatedAt: nowIso()
    })
    .where(where)
    .run();
  return true;
}

export function dismissPendingSteam(context: DatabaseContext, userId: string) {
  context.db
    .update(userGameAccounts)
    .set({ pendingAccountId: null, pendingDisplayName: null })
    .where(and(eq(userGameAccounts.userId, userId), eq(userGameAccounts.platform, "steam")))
    .run();
}

export function updateGameAccounts(
  context: DatabaseContext,
  userId: string,
  input: z.infer<typeof gameAccountsUpdateSchema>
) {
  const stamp = nowIso();
  for (const platform of GAME_PLATFORMS) {
    const value = input[platform];
    if (value === undefined) {
      continue;
    }
    const where = and(eq(userGameAccounts.userId, userId), eq(userGameAccounts.platform, platform));
    const trimmed = value?.trim() ?? "";
    if (!trimmed) {
      context.db.delete(userGameAccounts).where(where).run();
      continue;
    }
    const existing = context.db.select().from(userGameAccounts).where(where).get();
    if (existing?.accountId === trimmed) {
      continue;
    }
    if (existing) {
      context.db
        .update(userGameAccounts)
        .set({ accountId: trimmed, displayName: null, source: "manual", pendingAccountId: null, pendingDisplayName: null, updatedAt: stamp })
        .where(where)
        .run();
    } else {
      context.db
        .insert(userGameAccounts)
        .values({ userId, platform, accountId: trimmed, displayName: null, source: "manual", updatedAt: stamp })
        .run();
    }
  }
}

export function dismissGameAccountPrompt(context: DatabaseContext, userId: string) {
  const stamp = nowIso();
  context.db
    .insert(userGameAccountPrefs)
    .values({ userId, promptDismissedAt: stamp })
    .onConflictDoUpdate({ target: userGameAccountPrefs.userId, set: { promptDismissedAt: stamp } })
    .run();
}

/** Spielkonten aller aktiven Benutzer, die mindestens eins hinterlegt haben (ohne Vorschläge). */
export function listAllGameAccounts(context: DatabaseContext) {
  const rows = context.db
    .select({
      userId: userGameAccounts.userId,
      username: users.username,
      displayName: users.displayName,
      platform: userGameAccounts.platform,
      accountId: userGameAccounts.accountId,
      accountName: userGameAccounts.displayName
    })
    .from(userGameAccounts)
    .innerJoin(users, eq(userGameAccounts.userId, users.id))
    .where(isNull(users.deletedAt))
    .all();
  const byUser = new Map<
    string,
    { userId: string; username: string; displayName: string | null; accounts: Partial<Record<GamePlatform, { accountId: string; displayName: string | null }>> }
  >();
  for (const row of rows) {
    let entry = byUser.get(row.userId);
    if (!entry) {
      entry = { userId: row.userId, username: row.username, displayName: row.displayName, accounts: {} };
      byUser.set(row.userId, entry);
    }
    entry.accounts[row.platform] = { accountId: row.accountId, displayName: row.accountName };
  }
  return Array.from(byUser.values()).sort((a, b) => a.username.localeCompare(b.username));
}
