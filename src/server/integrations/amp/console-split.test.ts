import { describe, expect, it } from "vitest";
import { splitConsoleCommands } from "./console-split";

describe("splitConsoleCommands", () => {
  it("teilt an ; und entfernt Leerraum und leere Teile", () => {
    expect(splitConsoleCommands("yb_quota_mode fill; yb_quota 10")).toEqual(["yb_quota_mode fill", "yb_quota 10"]);
    expect(splitConsoleCommands(" status ;; ")).toEqual(["status"]);
    expect(splitConsoleCommands(";")).toEqual([]);
  });

  it("lässt ; in Anführungszeichen stehen", () => {
    expect(splitConsoleCommands('say "a; b"; yb list')).toEqual(['say "a; b"', "yb list"]);
  });

  it("lässt Befehle ohne ; unverändert", () => {
    expect(splitConsoleCommands('kick "<name>"')).toEqual(['kick "<name>"']);
  });
});
