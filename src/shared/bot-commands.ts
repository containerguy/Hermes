import { z } from "zod";

/**
 * Bot-Verwaltung für Gameserver mit Bots (CS 1.6 mit YaPB, CS2 mit den eingebauten Bots).
 * Hermes baut die Konsolenbefehle selbst und schickt sie einzeln über AMP; freie Eingaben
 * sind dafür nicht nötig. Server und Oberfläche teilen sich diese Datei.
 */
export type BotKind = "yapb" | "cs2";

export const botLevelSchema = z.enum(["easy", "normal", "hard", "expert"]);
export const botTeamSchema = z.enum(["auto", "t", "ct"]);
export type BotLevel = z.infer<typeof botLevelSchema>;
export type BotTeam = z.infer<typeof botTeamSchema>;

export const MAX_BOTS_ADD = 20;
export const MAX_BOTS_FILL = 32;

export const botRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    count: z.number().int().min(1).max(MAX_BOTS_ADD),
    level: botLevelSchema,
    team: botTeamSchema.default("auto")
  }),
  z.object({ action: z.literal("removeAll") }),
  z.object({
    action: z.literal("setLevel"),
    level: botLevelSchema,
    /** Nur CS2: Bots werden mit dieser Anzahl neu aufgesetzt, weil bot_difficulty nur für neue Bots gilt. */
    count: z.number().int().min(1).max(MAX_BOTS_ADD).optional()
  }),
  z.object({
    action: z.literal("fill"),
    count: z.number().int().min(1).max(MAX_BOTS_FILL),
    level: botLevelSchema
  })
]);
export type BotRequest = z.infer<typeof botRequestSchema>;

/** Bot-Art zum Spiel laut AMP (ModuleDisplayName/Modul); null ohne Bot-Unterstützung. */
export function botKindForGame(game: string | null | undefined): BotKind | null {
  if (!game) return null;
  const normalized = game.toLowerCase();
  if (/counter.?strike.?1\.?6|\bcs.?1\.?6\b/.test(normalized)) return "yapb";
  if (/counter.?strike.?2|\bcs2\b/.test(normalized)) return "cs2";
  return null;
}

/** Ob die Aktion für diese Bot-Art eine Anzahl braucht (CS2: Stufe ändern = neu aufsetzen). */
export function botActionNeedsCount(kind: BotKind, action: BotRequest["action"]): boolean {
  return action === "add" || action === "fill" || (kind === "cs2" && action === "setLevel");
}

// YaPB: 0 Neuling … 4 Gott; CS2: 0 leicht … 3 Experte
const YAPB_LEVEL: Record<BotLevel, number> = { easy: 1, normal: 2, hard: 3, expert: 4 };
const CS2_LEVEL: Record<BotLevel, number> = { easy: 0, normal: 1, hard: 2, expert: 3 };
// YaPB `yb add <stufe> <persönlichkeit> <team>`: 1 = T, 2 = CT, 5 = automatisch
const YAPB_TEAM: Record<BotTeam, number> = { auto: 5, t: 1, ct: 2 };
const CS2_ADD: Record<BotTeam, string> = { auto: "bot_add", t: "bot_add_t", ct: "bot_add_ct" };

export class BotRequestError extends Error {}

/**
 * Befehlsfolge für eine Bot-Aktion, in der Reihenfolge, in der sie gesendet werden muss.
 *
 * „Hinzufügen“ stellt die Quote auf `normal`: Im Modus `fill` würde die Quote die neuen Bots
 * sonst wieder kicken, sobald Menschen drin sind. `yb add`/`bot_add` erhöhen die Quote selbst.
 */
export function buildBotCommands(kind: BotKind, request: BotRequest): string[] {
  const repeat = (command: string, count: number) => Array.from({ length: count }, () => command);

  if (kind === "yapb") {
    switch (request.action) {
      case "add":
        return [
          "yb_quota_mode normal",
          ...repeat(`yb add ${YAPB_LEVEL[request.level]} 0 ${YAPB_TEAM[request.team]}`, request.count)
        ];
      case "removeAll":
        return ["yb_quota 0", "yb kickall"];
      case "setLevel":
        return [`yb_difficulty ${YAPB_LEVEL[request.level]}`];
      case "fill":
        return ["yb_quota_mode fill", `yb_difficulty ${YAPB_LEVEL[request.level]}`, `yb_quota ${request.count}`];
    }
  }

  switch (request.action) {
    case "add":
      return [
        "bot_quota_mode normal",
        `bot_difficulty ${CS2_LEVEL[request.level]}`,
        ...repeat(CS2_ADD[request.team], request.count)
      ];
    case "removeAll":
      return ["bot_quota 0", "bot_kick"];
    case "setLevel":
      if (!request.count) throw new BotRequestError("bots_anzahl_erforderlich");
      return [
        "bot_quota 0",
        "bot_kick",
        `bot_difficulty ${CS2_LEVEL[request.level]}`,
        "bot_quota_mode normal",
        ...repeat("bot_add", request.count)
      ];
    case "fill":
      return ["bot_quota_mode fill", `bot_difficulty ${CS2_LEVEL[request.level]}`, `bot_quota ${request.count}`];
  }
}
