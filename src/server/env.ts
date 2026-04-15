import path from "node:path";

export function getDatabasePath() {
  return process.env.HERMES_DB_PATH ?? path.join(process.cwd(), "data", "hermes.sqlite");
}

export function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
