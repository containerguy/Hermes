import { createHmac, randomBytes } from "node:crypto";

export const PAIR_TOKEN_BYTES = 32;
export const PAIR_TOKEN_TTL_MS = 10 * 60 * 1000;

function pairTokenSecret() {
  return process.env.HERMES_PAIR_TOKEN_SECRET ?? "hermes-dev-pair-token-secret";
}

export function createPairingToken(): string {
  return randomBytes(PAIR_TOKEN_BYTES).toString("base64url");
}

export function hashPairingToken(token: string): string {
  return createHmac("sha256", pairTokenSecret()).update(token).digest("hex");
}
