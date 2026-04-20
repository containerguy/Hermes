import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SOURCE_REPO_URL = "https://github.com/containerguy/Hermes";

export type AppReleaseInfo = {
  version: string;
  repoUrl: string;
};

let cached: AppReleaseInfo | null = null;

/** @internal Vitest */
export function clearReleaseInfoCache() {
  cached = null;
}

/**
 * Version from `package.json` next to the process cwd; repo URL from `HERMES_SOURCE_REPO_URL` or default.
 * Cached for the lifetime of the process.
 */
export function getReleaseInfo(): AppReleaseInfo {
  if (cached) {
    return cached;
  }

  let version = "0.0.0";
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    if (typeof pkg.version === "string" && pkg.version.trim()) {
      version = pkg.version.trim();
    }
  } catch {
    // keep fallback
  }

  const fromEnv = process.env.HERMES_SOURCE_REPO_URL?.trim();
  const repoUrl = fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_SOURCE_REPO_URL;

  cached = { version, repoUrl };
  return cached;
}
