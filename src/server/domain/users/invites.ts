import { randomBytes } from "node:crypto";
import type { DatabaseContext } from "../../db/client";
import type { inviteCodes } from "../../db/schema";

export function normalizeInviteCode(code: string) {
  return code.trim().toUpperCase();
}

export function generateInviteCode() {
  // 10 random bytes = 80 bits entropy; encoded as 16 Crockford-base32 characters.
  const bytes = randomBytes(10);
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(buffer >> bits) & 31] ?? "0";
    }
  }

  if (bits > 0) {
    out += alphabet[(buffer << (5 - bits)) & 31] ?? "0";
  }

  return out.slice(0, 16);
}

export function getInviteUsedCount(context: DatabaseContext, inviteCodeId: string) {
  const row = context.sqlite
    .prepare("SELECT COUNT(*) AS count FROM invite_code_uses WHERE invite_code_id = ?")
    .get(inviteCodeId) as { count: number };
  return row.count;
}

export function serializeInviteCode(
  context: DatabaseContext,
  invite: typeof inviteCodes.$inferSelect
) {
  return {
    ...invite,
    usedCount: getInviteUsedCount(context, invite.id)
  };
}
