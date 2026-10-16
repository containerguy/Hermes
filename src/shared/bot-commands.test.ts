import { describe, expect, it } from "vitest";
import { BotRequestError, botKindForGame, botRequestSchema, buildBotCommands, parseBotCount } from "./bot-commands";

describe("botKindForGame", () => {
  it("erkennt CS 1.6 (YaPB) und CS2, sonst keine Bots", () => {
    expect(botKindForGame("Counter-Strike 1.6")).toBe("yapb");
    expect(botKindForGame("Counter-Strike 2")).toBe("cs2");
    expect(botKindForGame("Minecraft")).toBeNull();
    expect(botKindForGame(null)).toBeNull();
  });
});

describe("buildBotCommands", () => {
  it("YaPB: Hinzufügen stellt die Quote auf normal und fügt einzeln mit Stufe und Team hinzu", () => {
    // Fester Team: Teamlimit und Ausgleich aus; bekannte Botzahl setzt die Quote (alte Quote aus "Auffüllen")
    expect(buildBotCommands("yapb", { action: "add", count: 2, level: "hard", team: "ct" }, 4)).toEqual([
      "mp_limitteams 0",
      "mp_autoteambalance 0",
      "yb_quota_mode normal",
      "yb_quota 4",
      "yb add 3 0 2",
      "yb add 3 0 2"
    ]);
    expect(buildBotCommands("yapb", { action: "add", count: 1, level: "easy", team: "auto" })).toEqual([
      "yb_quota_mode normal",
      "yb add 1 0 5"
    ]);
  });

  it("YaPB: Entfernen, Stufe und Auffüllen", () => {
    expect(buildBotCommands("yapb", { action: "removeAll" })).toEqual(["yb_quota 0", "yb kickall"]);
    expect(buildBotCommands("yapb", { action: "setLevel", level: "expert" })).toEqual(["yb_difficulty 4"]);
    expect(buildBotCommands("yapb", { action: "fill", count: 10, level: "normal" })).toEqual([
      "yb_quota_mode fill",
      "yb_difficulty 2",
      "yb_quota 10"
    ]);
  });

  it("CS2: Hinzufügen, Entfernen, Auffüllen", () => {
    expect(buildBotCommands("cs2", { action: "add", count: 2, level: "easy", team: "t" })).toEqual([
      "mp_limitteams 0",
      "mp_autoteambalance 0",
      "bot_quota_mode normal",
      "bot_difficulty 0",
      "bot_add_t",
      "bot_add_t"
    ]);
    expect(buildBotCommands("cs2", { action: "removeAll" })).toEqual(["bot_quota 0", "bot_kick"]);
    expect(buildBotCommands("cs2", { action: "fill", count: 8, level: "expert" })).toEqual([
      "bot_quota_mode fill",
      "bot_difficulty 3",
      "bot_quota 8"
    ]);
  });

  it("CS2: Stufe ändern setzt die gelesene Zahl Bots neu auf", () => {
    expect(buildBotCommands("cs2", { action: "setLevel", level: "easy" }, 1)).toEqual([
      "bot_quota 0",
      "bot_kick",
      "bot_difficulty 0",
      "bot_quota_mode normal",
      "bot_add"
    ]);
    expect(buildBotCommands("cs2", { action: "setLevel", level: "easy" }, 0)).toEqual(["bot_difficulty 0"]);
  });

  it("CS2: Stufe ändern mit Anzahl; ohne Anzahl und ohne Botzahl abgelehnt", () => {
    expect(buildBotCommands("cs2", { action: "setLevel", level: "hard", count: 2 })).toEqual([
      "bot_quota 0",
      "bot_kick",
      "bot_difficulty 2",
      "bot_quota_mode normal",
      "bot_add",
      "bot_add"
    ]);
    expect(() => buildBotCommands("cs2", { action: "setLevel", level: "hard" })).toThrow(BotRequestError);
  });
});

describe("botRequestSchema", () => {
  it("begrenzt Anzahl und Werte", () => {
    expect(botRequestSchema.safeParse({ action: "add", count: 21, level: "normal" }).success).toBe(false);
    expect(botRequestSchema.safeParse({ action: "add", count: 0, level: "normal" }).success).toBe(false);
    expect(botRequestSchema.safeParse({ action: "add", count: 3, level: "godlike" }).success).toBe(false);
    expect(botRequestSchema.safeParse({ action: "explode" }).success).toBe(false);
    expect(botRequestSchema.parse({ action: "add", count: 3, level: "normal" })).toEqual({
      action: "add",
      count: 3,
      level: "normal",
      team: "auto"
    });
  });
});

describe("parseBotCount", () => {
  it("liest YaPB yb list und CS2 status", () => {
    expect(parseBotCount("yapb", ["[0 ] Turbo normal TE 3", "[1 ] Socke normal TE 3", "2 bots"])).toBe(2);
    expect(parseBotCount("yapb", ["0 bots"])).toBe(0);
    expect(parseBotCount("cs2", ["hostname: LAN", "players  : 0 humans, 2 bots (32 max)"])).toBe(2);
    expect(parseBotCount("cs2", ["Server started"])).toBeNull();
  });
});
