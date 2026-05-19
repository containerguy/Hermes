import { describe, expect, it } from "vitest";
import { resolveDeviceName, validateDeviceName } from "./device-names";

describe("validateDeviceName", () => {
  it("rejects empty string", () => {
    expect(validateDeviceName("").ok).toBe(false);
  });

  it("rejects whitespace-only string", () => {
    expect(validateDeviceName("   ").ok).toBe(false);
  });

  it("rejects names over 120 chars", () => {
    expect(validateDeviceName("x".repeat(121)).ok).toBe(false);
  });

  it("accepts a normal trimmed name", () => {
    const result = validateDeviceName("  My iPhone  ");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe("My iPhone");
    }
  });

  it("returns the German error code on failure", () => {
    const result = validateDeviceName("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("ungueltiger_geraetename");
    }
  });
});

describe("resolveDeviceName", () => {
  it("prefers a valid submitted name over UA detection", () => {
    expect(
      resolveDeviceName("Mein Gaming-PC", "Mozilla/5.0 (Windows NT 10.0) Chrome/120")
    ).toBe("Mein Gaming-PC");
  });

  it("falls back to UA detection when no name is submitted", () => {
    expect(
      resolveDeviceName(undefined, "Mozilla/5.0 (Windows NT 10.0) Chrome/120")
    ).toBe("Windows-Desktop · Chrome");
  });

  it("falls back to UA detection when submitted name fails validation", () => {
    expect(
      resolveDeviceName("", "Mozilla/5.0 (Windows NT 10.0) Chrome/120")
    ).toBe("Windows-Desktop · Chrome");
    expect(
      resolveDeviceName("   ", "Mozilla/5.0 (Windows NT 10.0) Chrome/120")
    ).toBe("Windows-Desktop · Chrome");
  });

  it("returns the German unknown-device sentinel for empty UA", () => {
    expect(resolveDeviceName(undefined, undefined)).toBe("Unbekanntes Geraet");
    expect(resolveDeviceName(undefined, "")).toBe("Unbekanntes Geraet");
  });

  describe("UA detection matrix", () => {
    it("iPhone + Safari", () => {
      const ua =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
      expect(resolveDeviceName(undefined, ua)).toBe("iPhone · Safari");
    });

    it("iPhone + Chrome (CriOS)", () => {
      const ua =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0.0.0 Mobile/15E148 Safari/604.1";
      expect(resolveDeviceName(undefined, ua)).toBe("iPhone · Chrome");
    });

    it("Windows + Edge", () => {
      const ua =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
      expect(resolveDeviceName(undefined, ua)).toBe("Windows-Desktop · Edge");
    });

    it("Android Mobile + Firefox", () => {
      const ua =
        "Mozilla/5.0 (Android 14; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0";
      expect(resolveDeviceName(undefined, ua)).toBe("Android-Smartphone · Firefox");
    });

    it("Android tablet + Chrome", () => {
      const ua =
        "Mozilla/5.0 (Linux; Android 14; Tab) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      expect(resolveDeviceName(undefined, ua)).toBe("Android-Tablet · Chrome");
    });

    it("Macintosh + Safari", () => {
      const ua =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
      expect(resolveDeviceName(undefined, ua)).toBe("Mac · Safari");
    });

    it("Linux + Firefox", () => {
      const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0";
      expect(resolveDeviceName(undefined, ua)).toBe("Linux-PC · Firefox");
    });

    it("unknown OS still produces the PC fallback with browser label when detected", () => {
      const ua = "Mozilla/5.0 (Unknown) AppleWebKit/537.36 Chrome/120.0";
      expect(resolveDeviceName(undefined, ua)).toBe("PC · Chrome");
    });
  });
});
