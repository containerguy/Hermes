import { describe, expect, it } from "vitest";
import { generateOtp, hashOtp, verifyOtp } from "./otp";

describe("otp", () => {
  it("generates six digit codes", () => {
    expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it("verifies only the original code", () => {
    const hash = hashOtp("123456");

    expect(verifyOtp("123456", hash)).toBe(true);
    expect(verifyOtp("654321", hash)).toBe(false);
  });
});
