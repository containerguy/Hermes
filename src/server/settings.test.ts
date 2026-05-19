import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  pickPublicSettings,
  settingsPartialSchema,
  settingsSchema
} from "./settings";

describe("pickPublicSettings", () => {
  it("omits server-only keys", () => {
    const picked = pickPublicSettings(defaultSettings);
    expect(picked).not.toHaveProperty("defaultNotificationsEnabled");
    expect(picked).not.toHaveProperty("eventAutoArchiveHours");
    expect(picked).not.toHaveProperty("s3SnapshotEnabled");
    expect(picked).not.toHaveProperty("kioskStreamSecret");
  });

  it("keeps public-facing keys", () => {
    const picked = pickPublicSettings(defaultSettings);
    expect(picked.appName).toBe(defaultSettings.appName);
    expect(picked.brandMark).toBe(defaultSettings.brandMark);
    expect(picked.themePrimaryColor).toBe(defaultSettings.themePrimaryColor);
    expect(picked.kioskStreamEnabled).toBe(defaultSettings.kioskStreamEnabled);
    expect(picked.kioskStreamPath).toBe(defaultSettings.kioskStreamPath);
    expect(picked.pizzaPaypalHandle).toBe(defaultSettings.pizzaPaypalHandle);
  });
});

describe("settingsSchema", () => {
  it("rejects an invalid hex color", () => {
    const result = settingsSchema.safeParse({
      ...defaultSettings,
      themePrimaryColor: "not-a-color"
    });
    expect(result.success).toBe(false);
  });

  it("rejects a kiosk path containing /", () => {
    const result = settingsSchema.safeParse({
      ...defaultSettings,
      kioskStreamPath: "with/slash"
    });
    expect(result.success).toBe(false);
  });

  it("rejects a kiosk path starting with a non-alphanumeric character", () => {
    const result = settingsSchema.safeParse({
      ...defaultSettings,
      kioskStreamPath: "-leading-dash"
    });
    expect(result.success).toBe(false);
  });

  it("rejects kioskStreamEnabled=true with an invalid secret (superRefine)", () => {
    const result = settingsSchema.safeParse({
      ...defaultSettings,
      kioskStreamEnabled: true,
      kioskStreamSecret: "short"
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const kioskIssue = result.error.issues.find(
        (issue) =>
          issue.path[0] === "kioskStreamSecret" &&
          issue.message === "kiosk_geheimnis_erforderlich"
      );
      expect(kioskIssue).toBeDefined();
    }
  });

  it("accepts kioskStreamEnabled=true with a valid 12+ char alnum secret", () => {
    const result = settingsSchema.safeParse({
      ...defaultSettings,
      kioskStreamEnabled: true,
      kioskStreamSecret: "abc123XYZ_-456"
    });
    expect(result.success).toBe(true);
  });

  it("accepts the defaultSettings as a baseline", () => {
    const result = settingsSchema.safeParse(defaultSettings);
    expect(result.success).toBe(true);
  });

  it("rejects gameCatalog over 100 entries", () => {
    const result = settingsSchema.safeParse({
      ...defaultSettings,
      gameCatalog: Array.from({ length: 101 }, (_, index) => `Game ${index}`)
    });
    expect(result.success).toBe(false);
  });

  it("rejects an event auto-archive window outside 1..72", () => {
    expect(
      settingsSchema.safeParse({ ...defaultSettings, eventAutoArchiveHours: 0 }).success
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ ...defaultSettings, eventAutoArchiveHours: 73 }).success
    ).toBe(false);
  });
});

describe("settingsPartialSchema", () => {
  it("accepts a single-field partial update without triggering the kiosk superRefine", () => {
    const result = settingsPartialSchema.safeParse({ appName: "Just the name" });
    expect(result.success).toBe(true);
  });

  it("still validates individual field shape", () => {
    const result = settingsPartialSchema.safeParse({ themePrimaryColor: "not-a-color" });
    expect(result.success).toBe(false);
  });

  it("accepts an empty patch", () => {
    expect(settingsPartialSchema.safeParse({}).success).toBe(true);
  });
});
