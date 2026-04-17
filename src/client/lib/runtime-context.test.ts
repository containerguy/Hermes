import { describe, expect, it } from "vitest";
import { getSecureContextInfo, isLikelyIosSafari, isPwaDisplayMode } from "./runtime-context";

function mockWin(input: {
  protocol: string;
  hostname: string;
  isSecureContext: boolean;
  matchMedia?: (q: string) => MediaQueryList;
  navigator?: Partial<Navigator> & { standalone?: boolean };
}): Pick<Window, "location" | "isSecureContext" | "matchMedia" | "navigator"> {
  const matchMedia =
    input.matchMedia ??
    ((query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
      }) as unknown as MediaQueryList);

  return {
    location: { protocol: input.protocol, hostname: input.hostname } as Location,
    isSecureContext: input.isSecureContext,
    matchMedia,
    navigator: {
      userAgent: "Mozilla/5.0",
      platform: "Win32",
      maxTouchPoints: 0,
      ...input.navigator
    } as unknown as Navigator
  };
}

describe("getSecureContextInfo", () => {
  it("describes HTTPS + secure context like production", () => {
    const info = getSecureContextInfo(
      mockWin({ protocol: "https:", hostname: "hermes.familie-keller.info", isSecureContext: true })
    );
    expect(info.isHttps).toBe(true);
    expect(info.isSecureContext).toBe(true);
    expect(info.headline).toContain("HTTPS");
  });

  it("warns on plain HTTP", () => {
    const info = getSecureContextInfo(
      mockWin({ protocol: "http:", hostname: "192.168.1.10", isSecureContext: false })
    );
    expect(info.isHttps).toBe(false);
    expect(info.headline.toLowerCase()).toMatch(/http|kontext/);
  });

  it("treats localhost as secure dev context", () => {
    const info = getSecureContextInfo(
      mockWin({ protocol: "http:", hostname: "localhost", isSecureContext: true })
    );
    expect(info.isLocalhost).toBe(true);
    expect(info.headline).toMatch(/Lokal/);
  });
});

describe("isPwaDisplayMode", () => {
  it("returns false when matchMedia is missing (e.g. jsdom)", () => {
    const win = {
      location: { protocol: "http:", hostname: "localhost" } as Location,
      isSecureContext: true,
      navigator: { standalone: undefined } as unknown as Navigator
    } as Pick<Window, "location" | "isSecureContext" | "matchMedia" | "navigator">;
    expect(isPwaDisplayMode(win)).toBe(false);
  });

  it("detects standalone matchMedia", () => {
    const win = mockWin({
      protocol: "https:",
      hostname: "x.test",
      isSecureContext: true,
      matchMedia: (q: string) =>
        ({
          matches: q === "(display-mode: standalone)",
          media: q,
          addEventListener: () => undefined,
          removeEventListener: () => undefined
        }) as unknown as MediaQueryList
    });
    expect(isPwaDisplayMode(win)).toBe(true);
  });
});

describe("isLikelyIosSafari", () => {
  it("returns false for desktop test UA", () => {
    const win = mockWin({
      protocol: "https:",
      hostname: "x.test",
      isSecureContext: true
    });
    expect(isLikelyIosSafari(win)).toBe(false);
  });

  it("returns true for iPhone WebKit without CriOS", () => {
    const win = mockWin({
      protocol: "https:",
      hostname: "x.test",
      isSecureContext: true,
      navigator: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        platform: "iPhone"
      }
    });
    expect(isLikelyIosSafari(win)).toBe(true);
  });
});
