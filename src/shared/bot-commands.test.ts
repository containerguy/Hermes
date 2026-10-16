import { describe, expect, it } from "vitest";
import { BotRequestError, botKindForGame, botRequestSchema, buildBotCommands, parseBotCounts } from "./bot-commands";

describe("botKindForGame", () => {
  it("erkennt CS 1.6 (YaPB) und CS2, sonst keine Bots", () => {
    expect(botKindForGame("Counter-Strike 1.6")).toBe("yapb");
    expect(botKindForGame("Counter-Strike 2")).toBe("cs2");
    expect(botKindForGame("Minecraft")).toBeNull();
    expect(botKindForGame(null)).toBeNull();
  });
});

describe("buildBotCommands", () => {
  it("YaPB: Hinzufügen im Modus fill, Quote erst auf den aktuellen Stand, dann einzeln mit Stufe und Team", () => {
    // 3 Menschen + 4 Bots: Quote 7, jedes yb add erhöht sie um eins (Bots machen so Platz für Menschen)
    expect(buildBotCommands("yapb", { action: "add", count: 2, level: "hard", team: "ct" }, { bots: 4, humans: 3 })).toEqual([
      "mp_limitteams 0",
      "mp_autoteambalance 0",
      "yb_quota_mode fill",
      "yb_quota 7",
      "yb add 3 0 2",
      "yb add 3 0 2"
    ]);
    expect(buildBotCommands("yapb", { action: "add", count: 1, level: "easy", team: "auto" }, { bots: 0, humans: 0 })).toEqual([
      "yb_quota_mode fill",
      "yb_quota 0",
      "yb add 1 0 5"
    ]);
    expect(() => buildBotCommands("yapb", { action: "add", count: 1, level: "easy", team: "auto" })).toThrow(
      BotRequestError
    );
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
    expect(buildBotCommands("cs2", { action: "add", count: 2, level: "easy", team: "t" }, { bots: 1, humans: 2 })).toEqual([
      "mp_limitteams 0",
      "mp_autoteambalance 0",
      "bot_quota_mode fill",
      "bot_quota 3",
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

  it("CS2: Stufe ändern setzt die gelesenen Bots im Modus fill neu auf", () => {
    expect(buildBotCommands("cs2", { action: "setLevel", level: "easy" }, { bots: 2, humans: 1 })).toEqual([
      "bot_quota 0",
      "bot_kick",
      "bot_difficulty 0",
      "bot_quota_mode fill",
      "bot_quota 1",
      "bot_add",
      "bot_add"
    ]);
    expect(buildBotCommands("cs2", { action: "setLevel", level: "hard", count: 1 }, { bots: 5, humans: 0 })).toEqual([
      "bot_quota 0",
      "bot_kick",
      "bot_difficulty 2",
      "bot_quota_mode fill",
      "bot_quota 0",
      "bot_add"
    ]);
    expect(buildBotCommands("cs2", { action: "setLevel", level: "easy" }, { bots: 0, humans: 3 })).toEqual([
      "bot_difficulty 0"
    ]);
    expect(() => buildBotCommands("cs2", { action: "setLevel", level: "hard" })).toThrow(BotRequestError);
  });
});

describe("parseBotCounts", () => {
  it("YaPB: Bots aus yb list, Menschen aus status abzüglich Bots", () => {
    expect(
      parseBotCounts("yapb", [
        "[0 ] Turbo normal TE 3",
        "[1 ] Socke normal TE 3",
        "2 bots",
        "hostname:  LAN",
        "players : 3 active (24 max)"
      ])
    ).toEqual({ bots: 2, humans: 1 });
    expect(parseBotCounts("yapb", ["2 bots"])).toBeNull();
    // Chatzeilen zählen nicht
    expect(parseBotCounts("yapb", ["Turbo : wir sind 5 bots", "players : 1 active (24 max)"])).toBeNull();
  });

  it("CS2: Menschen und Bots aus status", () => {
    expect(parseBotCounts("cs2", ["hostname: LAN", "players  : 1 humans, 2 bots (32 max)"])).toEqual({ bots: 2, humans: 1 });
    expect(parseBotCounts("cs2", ["Server started"])).toBeNull();
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
