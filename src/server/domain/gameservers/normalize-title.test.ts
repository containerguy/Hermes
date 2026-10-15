import { describe, expect, it } from "vitest";
import { normalizeGameTitle } from "./normalize-title";

describe("normalizeGameTitle", () => {
  it("matches the client-side isCod4Game normalization", () => {
    expect(normalizeGameTitle("Counter-Strike 1.6")).toBe("counterstrike16");
    expect(normalizeGameTitle("  Call of Duty 4  ")).toBe("callofduty4");
    expect(normalizeGameTitle("COD4")).toBe("cod4");
    expect(normalizeGameTitle("Minecraft")).toBe("minecraft");
  });

  it("returns an empty string for titles without alphanumerics", () => {
    expect(normalizeGameTitle("---")).toBe("");
  });
});
