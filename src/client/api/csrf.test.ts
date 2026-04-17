import { describe, expect, it } from "vitest";
import { shouldAttachCsrf } from "./csrf";

describe("shouldAttachCsrf", () => {
  it("does not require CSRF for pair-redeem (session-less second device)", () => {
    expect(
      shouldAttachCsrf("/api/auth/pair-redeem", { method: "POST" })
    ).toBe(false);
  });

  it("still requires CSRF for authenticated auth POSTs such as pair-token", () => {
    expect(shouldAttachCsrf("/api/auth/pair-token", { method: "POST" })).toBe(true);
  });
});
