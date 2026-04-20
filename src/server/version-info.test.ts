import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearReleaseInfoCache, DEFAULT_SOURCE_REPO_URL, getReleaseInfo } from "./version-info";

describe("version-info", () => {
  const originalCwd = process.cwd();
  const originalEnv = process.env.HERMES_SOURCE_REPO_URL;

  beforeEach(() => {
    clearReleaseInfoCache();
  });

  afterEach(() => {
    clearReleaseInfoCache();
    process.chdir(originalCwd);
    if (originalEnv === undefined) {
      delete process.env.HERMES_SOURCE_REPO_URL;
    } else {
      process.env.HERMES_SOURCE_REPO_URL = originalEnv;
    }
  });

  it("reads version from package.json and default repo URL", () => {
    const dir = path.join(os.tmpdir(), `hermes-ver-${randomUUID()}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "9.8.7" }), "utf8");
    process.chdir(dir);
    delete process.env.HERMES_SOURCE_REPO_URL;

    const info = getReleaseInfo();
    expect(info.version).toBe("9.8.7");
    expect(info.repoUrl).toBe(DEFAULT_SOURCE_REPO_URL);
  });

  it("uses HERMES_SOURCE_REPO_URL when set", () => {
    const dir = path.join(os.tmpdir(), `hermes-ver-${randomUUID()}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "1.0.0" }), "utf8");
    process.chdir(dir);
    process.env.HERMES_SOURCE_REPO_URL = "https://example.org/my-fork";

    const info = getReleaseInfo();
    expect(info.repoUrl).toBe("https://example.org/my-fork");
  });
});
