import { describe, expect, it } from "vitest";
import { maskInviteCode } from "./audit-log";

describe("maskInviteCode", () => {
  it("returns empty string for empty input", () => {
    expect(maskInviteCode("")).toBe("");
  });

  it("returns empty string for whitespace-only input (trim)", () => {
    expect(maskInviteCode("   ")).toBe("");
  });

  it("masks short codes (<=6 chars) with single-char prefix + suffix", () => {
    expect(maskInviteCode("ABC")).toBe("A***C");
    expect(maskInviteCode("ABCD")).toBe("A***D");
    expect(maskInviteCode("ABCDEF")).toBe("A***F");
  });

  it("masks long codes (>6 chars) with three-char prefix + suffix", () => {
    expect(maskInviteCode("ABCDEFGHIJ")).toBe("ABC***HIJ");
    expect(maskInviteCode("INV-1234567890")).toBe("INV***890");
  });

  it("trims before classifying length", () => {
    expect(maskInviteCode("  ABCDEF  ")).toBe("A***F");
    expect(maskInviteCode("  ABCDEFGHIJ  ")).toBe("ABC***HIJ");
  });

  it("single-char input still produces a masked value", () => {
    expect(maskInviteCode("X")).toBe("X***X");
  });
});
