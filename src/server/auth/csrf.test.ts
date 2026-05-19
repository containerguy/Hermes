import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCsrfToken, verifyCsrfToken } from "./csrf";

describe("csrf token mint + verify", () => {
  const originalSecret = process.env.HERMES_CSRF_SECRET;

  beforeEach(() => {
    process.env.HERMES_CSRF_SECRET = "test-csrf-secret-fixed";
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.HERMES_CSRF_SECRET;
    } else {
      process.env.HERMES_CSRF_SECRET = originalSecret;
    }
  });

  it("returns a base64url string", () => {
    const token = createCsrfToken("session-id-abc");
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThan(0);
  });

  it("produces distinct tokens for distinct session ids", () => {
    const a = createCsrfToken("session-a");
    const b = createCsrfToken("session-b");
    expect(a).not.toEqual(b);
  });

  it("produces the same token for the same session id (deterministic)", () => {
    const a = createCsrfToken("session-x");
    const b = createCsrfToken("session-x");
    expect(a).toEqual(b);
  });

  it("verifyCsrfToken returns false for undefined token", () => {
    expect(verifyCsrfToken("session-x", undefined)).toBe(false);
  });

  it("verifyCsrfToken returns false for wrong-length token (timing guard)", () => {
    const valid = createCsrfToken("session-x");
    const truncated = valid.slice(0, valid.length - 1);
    expect(verifyCsrfToken("session-x", truncated)).toBe(false);

    const padded = `${valid}A`;
    expect(verifyCsrfToken("session-x", padded)).toBe(false);
  });

  it("verifyCsrfToken accepts the token its own session minted", () => {
    const token = createCsrfToken("session-x");
    expect(verifyCsrfToken("session-x", token)).toBe(true);
  });

  it("verifyCsrfToken rejects a token minted for a different session", () => {
    const token = createCsrfToken("session-x");
    expect(verifyCsrfToken("session-y", token)).toBe(false);
  });
});
