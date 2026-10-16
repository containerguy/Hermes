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

export type BotCounts = { bots: number; humans: number };

/** Konsolenbefehle, deren Antworten Bots und Menschen im Spiel enthalten. */
export function botCountQueries(kind: BotKind): string[] {
  // GoldSrc-`status` zählt Bots als Spieler mit, `yb list` liefert die Bots
  return kind === "yapb" ? ["yb list", "status"] : ["status"];
}

function lastMatch(lines: string[], pattern: RegExp) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = pattern.exec(lines[index].trim());
    if (match) return match;
  }
  return null;
}

/**
 * Bots und Menschen aus Konsolenzeilen. YaPB: `yb list` endet mit „N bots“, GoldSrc-`status`
 * zeigt „players : N active“ (Menschen + Bots). CS2-`status`: „players : H humans, B bots“.
 * Nimmt jeweils den letzten Treffer; null, solange nicht alles da ist.
 */
export function parseBotCounts(kind: BotKind, lines: string[]): BotCounts | null {
  if (kind === "cs2") {
    const match = lastMatch(lines, /^players\s*:\s*(\d+) humans?,\s*(\d+) bots?/);
    return match ? { humans: Number.parseInt(match[1], 10), bots: Number.parseInt(match[2], 10) } : null;
  }
  // ganze Zeile, damit Chatzeilen wie „… 5 bots“ nicht zählen
  const bots = lastMatch(lines, /^(\d+) bots?$/);
  const players = lastMatch(lines, /^players\s*:\s*(\d+)\s+active/);
  if (!bots || !players) return null;
  const botCount = Number.parseInt(bots[1], 10);
  return { bots: botCount, humans: Math.max(Number.parseInt(players[1], 10) - botCount, 0) };
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
 * `counts` sind die vom Server gelesenen Bots und Menschen (null, wenn unbekannt).
 *
 * Alle Aktionen laufen im Quotenmodus `fill`, denn nur dort machen Bots Platz, sobald Menschen
 * joinen (LAN-Test mit René: im Modus `normal` blieben die Bots). „Hinzufügen“ setzt die Quote
 * deshalb erst auf den aktuellen Stand (Menschen + Bots); jedes `yb add`/`bot_add` erhöht sie um
 * eins und bringt genau diesen Bot mit Stufe und Team. Mit festem Team fallen Teamlimit und
 * Ausgleich weg, sonst lehnt das Spiel mit „Team is stacked“ ab.
 */
export function buildBotCommands(kind: BotKind, request: BotRequest, counts: BotCounts | null = null): string[] {
  const repeat = (command: string, count: number) => Array.from({ length: count }, () => command);
  const teamUnlock = request.action === "add" && request.team !== "auto" ? ["mp_limitteams 0", "mp_autoteambalance 0"] : [];
  const requireCounts = () => {
    if (!counts) throw new BotRequestError("botzahl_unbekannt");
    return counts;
  };

  if (kind === "yapb") {
    switch (request.action) {
      case "add": {
        const { bots, humans } = requireCounts();
        return [
          ...teamUnlock,
          "yb_quota_mode fill",
          `yb_quota ${humans + bots}`,
          ...repeat(`yb add ${YAPB_LEVEL[request.level]} 0 ${YAPB_TEAM[request.team]}`, request.count)
        ];
      }
      case "removeAll":
        return ["yb_quota 0", "yb kickall"];
      case "setLevel":
        return [`yb_difficulty ${YAPB_LEVEL[request.level]}`];
      case "fill":
        return ["yb_quota_mode fill", `yb_difficulty ${YAPB_LEVEL[request.level]}`, `yb_quota ${request.count}`];
    }
  }

  switch (request.action) {
    case "add": {
      const { bots, humans } = requireCounts();
      return [
        ...teamUnlock,
        "bot_quota_mode fill",
        `bot_quota ${humans + bots}`,
        `bot_difficulty ${CS2_LEVEL[request.level]}`,
        ...repeat(CS2_ADD[request.team], request.count)
      ];
    }
    case "removeAll":
      return ["bot_quota 0", "bot_kick"];
    case "setLevel": {
      const { bots, humans } = requireCounts();
      const count = Math.min(request.count ?? bots, MAX_BOTS_ADD);
      if (count === 0) return [`bot_difficulty ${CS2_LEVEL[request.level]}`];
      return [
        "bot_quota 0",
        "bot_kick",
        `bot_difficulty ${CS2_LEVEL[request.level]}`,
        "bot_quota_mode fill",
        `bot_quota ${humans}`,
        ...repeat("bot_add", count)
      ];
    }
    case "fill":
      return ["bot_quota_mode fill", `bot_difficulty ${CS2_LEVEL[request.level]}`, `bot_quota ${request.count}`];
  }
}
