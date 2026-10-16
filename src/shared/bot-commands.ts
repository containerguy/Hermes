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
    /**
     * Nur CS2: Bots werden mit dieser Anzahl neu aufgesetzt, weil bot_difficulty nur für neue Bots gilt.
     * Ohne Angabe nimmt Hermes die vom Server gelesene Botzahl.
     */
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

/** Konsolenbefehl, dessen Antwort die Zahl der Bots im Spiel enthält. */
export function botCountQuery(kind: BotKind): string {
  return kind === "yapb" ? "yb list" : "status";
}

/**
 * Botzahl aus Konsolenzeilen: YaPB `yb list` endet mit „N bots“, CS2 `status` enthält
 * „players : H humans, B bots“. Nimmt den letzten Treffer; null ohne Treffer.
 */
export function parseBotCount(kind: BotKind, lines: string[]): number | null {
  const pattern = kind === "yapb" ? /(?:^|\s)(\d+) bots?\s*$/ : /players\s*:\s*\d+ humans?,\s*(\d+) bots?/;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = pattern.exec(lines[index].trim());
    if (match) return Number.parseInt(match[1], 10);
  }
  return null;
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
 * `currentBots` ist die vom Server gelesene Botzahl (null, wenn unbekannt).
 *
 * „Hinzufügen“ stellt die Quote auf `normal` und auf die aktuelle Botzahl: Im Modus `fill` würde
 * die Quote neue Bots sonst wieder kicken, und eine alte Quote (z. B. 10 aus „Auffüllen“) würde
 * im Modus `normal` als Botzahl gelten. `yb add`/`bot_add` erhöhen die Quote danach selbst.
 * Mit festem Team fallen Teamlimit und Ausgleich weg, sonst lehnt das Spiel ab „Team is stacked“.
 */
export function buildBotCommands(kind: BotKind, request: BotRequest, currentBots: number | null = null): string[] {
  const repeat = (command: string, count: number) => Array.from({ length: count }, () => command);
  const teamUnlock = request.action === "add" && request.team !== "auto" ? ["mp_limitteams 0", "mp_autoteambalance 0"] : [];

  if (kind === "yapb") {
    switch (request.action) {
      case "add":
        return [
          ...teamUnlock,
          "yb_quota_mode normal",
          ...(currentBots === null ? [] : [`yb_quota ${currentBots}`]),
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
        ...teamUnlock,
        "bot_quota_mode normal",
        ...(currentBots === null ? [] : [`bot_quota ${currentBots}`]),
        `bot_difficulty ${CS2_LEVEL[request.level]}`,
        ...repeat(CS2_ADD[request.team], request.count)
      ];
    case "removeAll":
      return ["bot_quota 0", "bot_kick"];
    case "setLevel": {
      const count = request.count ?? currentBots;
      if (count === null || count === undefined) throw new BotRequestError("botzahl_unbekannt");
      if (count === 0) return [`bot_difficulty ${CS2_LEVEL[request.level]}`];
      return [
        "bot_quota 0",
        "bot_kick",
        `bot_difficulty ${CS2_LEVEL[request.level]}`,
        "bot_quota_mode normal",
        ...repeat("bot_add", Math.min(count, MAX_BOTS_ADD))
      ];
    }
    case "fill":
      return ["bot_quota_mode fill", `bot_difficulty ${CS2_LEVEL[request.level]}`, `bot_quota ${request.count}`];
  }
}
