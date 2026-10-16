import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { tryWriteAuditLog } from "../../audit-log";
import { validateDeviceName } from "../../auth/device-names";
import { sessionIdleCutoffIso } from "../../auth/sessions";
import type { DatabaseContext } from "../../db/client";
import { devices, sessions, users } from "../../db/schema";
import { syncSessionDeviceNames } from "./devices";

export type SessionRow = typeof sessions.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type CurrentAuth = { user: UserRow; session: SessionRow };

export type SerializedSession = {
  id: string;
  deviceName: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
};

export const renameSessionSchema = z.object({ deviceName: z.string() });

function nowIso() {
  return new Date().toISOString();
}

function serialize(row: SessionRow, currentSessionId: string): SerializedSession {
  return {
    id: row.id,
    deviceName: row.deviceName,
    userAgent: row.userAgent,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    current: row.id === currentSessionId
  };
}

export function listUserSessions(
  context: DatabaseContext,
  current: CurrentAuth
): SerializedSession[] {
  const rows = context.db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, current.user.id),
        isNull(sessions.revokedAt),
        gte(sessions.lastSeenAt, sessionIdleCutoffIso())
      )
    )
    .orderBy(desc(sessions.lastSeenAt))
    .all();
  return rows.map((row) => serialize(row, current.session.id));
}

export type RenameSessionResult =
  | { ok: true; session: SerializedSession }
  | { ok: false; status: 400 | 404; error: string };

export function renameUserSession(
  context: DatabaseContext,
  current: CurrentAuth,
  sessionId: string,
  deviceName: string
): RenameSessionResult {
  const validated = validateDeviceName(deviceName);
  if (!validated.ok) {
    return { ok: false, status: 400, error: validated.error };
  }

  const target = context.db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, current.user.id),
        isNull(sessions.revokedAt)
      )
    )
    .get();

  if (!target) {
    return { ok: false, status: 404, error: "session_nicht_gefunden" };
  }

  context.sqlite.transaction(() => {
    context.db
      .update(sessions)
      .set({ deviceName: validated.name })
      .where(eq(sessions.id, target.id))
      .run();
    if (target.deviceId) {
      context.db
        .update(devices)
        .set({ name: validated.name })
        .where(and(eq(devices.id, target.deviceId), eq(devices.userId, current.user.id)))
        .run();
      syncSessionDeviceNames(context, target.deviceId, validated.name);
    }
  })();

  const updated = context.db.select().from(sessions).where(eq(sessions.id, target.id)).get();

  tryWriteAuditLog(context, {
    actor: current.user,
    action: "auth.session_rename",
    entityType: "session",
    entityId: target.id,
    summary: `${current.user.username} hat ein Gerät umbenannt.`,
    metadata: { deviceName: validated.name, current: target.id === current.session.id }
  });

  return { ok: true, session: serialize(updated ?? { ...target, deviceName: validated.name }, current.session.id) };
}

export type RevokeSessionResult =
  | { ok: true; revokedCurrent: boolean }
  | { ok: false; status: 404; error: "session_nicht_gefunden" };

export function revokeUserSession(
  context: DatabaseContext,
  current: CurrentAuth,
  sessionId: string
): RevokeSessionResult {
  const target = context.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, current.user.id)))
    .get();

  if (!target) {
    return { ok: false, status: 404, error: "session_nicht_gefunden" };
  }

  context.db
    .update(sessions)
    .set({ revokedAt: nowIso() })
    .where(eq(sessions.id, target.id))
    .run();

  tryWriteAuditLog(context, {
    actor: current.user,
    action: "auth.session_revoke",
    entityType: "session",
    entityId: target.id,
    summary: `${current.user.username} hat ein Gerät abgemeldet.`,
    metadata: { deviceName: target.deviceName, current: target.id === current.session.id }
  });

  return { ok: true, revokedCurrent: target.id === current.session.id };
}
