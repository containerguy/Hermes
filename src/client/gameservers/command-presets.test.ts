import { describe, expect, it } from "vitest";
import { commandSetForGame, firstPlaceholder } from "./command-presets";

describe("commandSetForGame", () => {
  it.each([
    ["Counter-Strike 2", "cs2"],
    ["Counter-Strike 1.6", "cs16"],
    ["Call of Duty 4: Modern Warfare", "cod4"],
    ["Minecraft", "minecraft"],
    ["Factorio", "factorio"],
    ["Soldat", "soldat"],
    ["Unreal Tournament 2004", "ut2004"]
  ])("ordnet den AMP-Namen %s zu", (game, key) => {
    expect(commandSetForGame(game)?.key).toBe(key);
  });

  it("verwechselt CS2 und CS 1.6 nicht", () => {
    expect(commandSetForGame("Counter-Strike 2")?.key).not.toBe("cs16");
    expect(commandSetForGame("Counter-Strike 1.6")?.key).not.toBe("cs2");
  });

  it("liefert null für unbekannte Spiele", () => {
    expect(commandSetForGame("Valheim")).toBeNull();
    expect(commandSetForGame(null)).toBeNull();
  });

  it("hält alle Vorlagen unter der Eingabegrenze von 200 Zeichen", () => {
    for (const game of ["cs2", "cs 1.6", "cod4", "minecraft", "factorio", "soldat"]) {
      const set = commandSetForGame(game);
      expect(set?.groups.length).toBeGreaterThan(0);
      for (const group of set!.groups) {
        for (const preset of group.presets) expect(preset.command.length).toBeLessThanOrEqual(200);
      }
    }
  });

  it("CS 1.6 bietet YaPB-Botbefehle; alle Bots entfernen setzt vorher die Quote auf 0", () => {
    const set = commandSetForGame("Counter-Strike 1.6");
    const bots = set?.groups.find((group) => group.label.de === "Bots (YaPB)");
    const commands = bots?.presets.map((preset) => preset.command) ?? [];
    expect(commands).toContain("yb add");
    expect(commands).toContain("yb_quota_mode fill; yb_quota 10");
    // ohne yb_quota 0 würde die Quote die eben gekickten Bots sofort wieder auffüllen
    expect(commands).toContain("yb_quota 0; yb kickall");
    expect(set?.hint?.de).toContain("YaPB");
    // GoldSrc-RCON über AMP trennt ; nicht selbst → Hermes teilt auf
    expect(set?.splitCommands).toBe(true);
  });

  it("CS 1.6 bietet die installierten Fun-Maps als eigene Gruppe neben den Standard-Maps", () => {
    const set = commandSetForGame("Counter-Strike 1.6");
    const standard = set?.groups.find((group) => group.label.de === "Map wechseln");
    expect(standard?.presets.map((preset) => preset.command)).toContain("changelevel de_dust2");

    const fun = set?.groups.find((group) => group.label.de === "Fun-Maps");
    expect(fun?.label.en).toBe("Fun maps");
    const commands = fun?.presets.map((preset) => preset.command) ?? [];
    expect(commands).toEqual([
      "changelevel fy_pool_day",
      "changelevel fy_poolparty",
      "changelevel fy_snow",
      "changelevel fy_iceworld",
      "changelevel aim_map",
      "changelevel awp_map",
      "changelevel 35hp_2_2",
      "changelevel de_dust2_2x2",
      "changelevel fy_mario",
      "changelevel smb2_land_v2"
    ]);
    for (const command of commands) expect(command.length).toBeLessThan(200);

    const smb2 = fun?.presets.find((preset) => preset.command === "changelevel smb2_land_v2");
    expect(smb2?.label.de).toBe("Super Mario Bros. 2 (ohne Bots)");
    expect(smb2?.note?.de).toContain("Bots finden sich auf dieser Map nicht zurecht");
    expect(smb2?.note?.en).toBeTruthy();
    // nur die Map ohne Bot-Navigation trägt einen Hinweis
    expect(fun?.presets.filter((preset) => preset.note)).toHaveLength(1);
  });

  it("teilt nur bei Konsolen auf, in denen ; Befehle trennt", () => {
    expect(commandSetForGame("Counter-Strike 2")?.splitCommands).toBe(true);
    expect(commandSetForGame("Call of Duty 4")?.splitCommands).toBe(true);
    expect(commandSetForGame("Minecraft")?.splitCommands).toBeFalsy();
    expect(commandSetForGame("Factorio")?.splitCommands).toBeFalsy();
  });

  it("UT2004 verweist aufs WebAdmin statt auf Konsolenbefehle", () => {
    const set = commandSetForGame("Unreal Tournament 2004");
    expect(set?.console).toBe("none");
    expect(set?.webAdminPort).toBe(8888);
  });
});

describe("firstPlaceholder", () => {
  it("findet den ersten Platzhalter", () => {
    expect(firstPlaceholder("tp <name> <ziel>")).toEqual({ start: 3, end: 9 });
    expect(firstPlaceholder("status")).toBeNull();
  });
});
