import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeLegacyEnv, getDatabasePath, readEnv, readRequiredEnv, warnAboutLegacyEnv } from "./env";

const touched = ["MATCHDESK_ENVTEST", "HERMES_ENVTEST", "MATCHDESK_DB_PATH", "HERMES_DB_PATH"];
const saved = Object.fromEntries(touched.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of touched) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe("readEnv", () => {
  it("liest MATCHDESK_* und fällt auf HERMES_* zurück", () => {
    delete process.env.MATCHDESK_ENVTEST;
    delete process.env.HERMES_ENVTEST;
    expect(readEnv("ENVTEST")).toBeUndefined();
    process.env.HERMES_ENVTEST = "alt";
    expect(readEnv("ENVTEST")).toBe("alt");
    process.env.MATCHDESK_ENVTEST = "neu";
    expect(readEnv("ENVTEST")).toBe("neu");
  });

  it("readRequiredEnv nennt beide Namen in der Fehlermeldung", () => {
    delete process.env.MATCHDESK_ENVTEST;
    delete process.env.HERMES_ENVTEST;
    expect(() => readRequiredEnv("ENVTEST")).toThrow(/MATCHDESK_ENVTEST.*HERMES_ENVTEST/);
    process.env.HERMES_ENVTEST = " wert ";
    expect(readRequiredEnv("ENVTEST")).toBe("wert");
  });
});

describe("Hinweise auf alte Variablen", () => {
  it("meldet nur Namen, nie Werte", () => {
    const result = describeLegacyEnv({
      HERMES_DEVICE_KEY_SECRET: "geheim",
      HERMES_PORT: "3000",
      MATCHDESK_PORT: "3000",
      HERMES_CSRF_SECRET: "a",
      MATCHDESK_CSRF_SECRET: "b"
    });
    expect(result).toEqual({ legacyOnly: ["DEVICE_KEY_SECRET"], conflicting: ["CSRF_SECRET"] });
  });

  it("schreibt die Warnung ohne Werte ins Log", () => {
    process.env.HERMES_ENVTEST = "streng-geheim";
    delete process.env.MATCHDESK_ENVTEST;
    const log = vi.fn();
    warnAboutLegacyEnv(log);
    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("HERMES_ENVTEST");
    expect(output).not.toContain("streng-geheim");
  });
});

describe("getDatabasePath", () => {
  function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "matchdesk-env-"));
  }

  it("nutzt eine vorhandene hermes.sqlite, solange matchdesk.sqlite fehlt", () => {
    const dir = tempDir();
    delete process.env.HERMES_DB_PATH;
    process.env.MATCHDESK_DB_PATH = path.join(dir, "matchdesk.sqlite");
    expect(getDatabasePath()).toBe(path.join(dir, "matchdesk.sqlite"));

    fs.writeFileSync(path.join(dir, "hermes.sqlite"), "");
    expect(getDatabasePath()).toBe(path.join(dir, "hermes.sqlite"));

    fs.writeFileSync(path.join(dir, "matchdesk.sqlite"), "");
    expect(getDatabasePath()).toBe(path.join(dir, "matchdesk.sqlite"));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lässt explizit gesetzte andere Dateinamen unverändert", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "hermes.sqlite"), "");
    delete process.env.MATCHDESK_DB_PATH;
    process.env.HERMES_DB_PATH = path.join(dir, "eigene.sqlite");
    expect(getDatabasePath()).toBe(path.join(dir, "eigene.sqlite"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
