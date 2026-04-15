import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;

export function generateOtp() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOtp(code: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(code, salt, KEY_LENGTH).toString("base64url");

  return `scrypt:v1:${salt}:${hash}`;
}

export function verifyOtp(code: string, storedHash: string) {
  const [algorithm, version, salt, hash] = storedHash.split(":");

  if (algorithm !== "scrypt" || version !== "v1" || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(code, salt, KEY_LENGTH);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
