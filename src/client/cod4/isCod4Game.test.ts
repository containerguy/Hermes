import { describe, expect, it } from "vitest";
import { isCod4Game } from "./isCod4Game";

describe("isCod4Game", () => {
  it.each([
    ["COD4"],
    ["CoD4"],
    ["CoD 4"],
    ["Call of Duty 4"],
    ["cod4"],
    ["call of duty 4"],
    ["CALL OF DUTY 4"],
  ])("accepts %s", (title) => {
    expect(isCod4Game(title)).toBe(true);
  });

  it.each([
    ["cod"],
    ["cod40"],
    ["Call of Duty 2"],
    [""],
    ["Call of Duty 4 Modern Warfare Remastered"],
  ])("rejects %s", (title) => {
    expect(isCod4Game(title)).toBe(false);
  });
});
