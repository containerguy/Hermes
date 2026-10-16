import { and, desc, eq, gte, isNull } from "drizzle-orm";
import type { Request } from "express";
import { tryWriteAuditLog } from "../../audit-log";
import {
  deviceSignalsFingerprint,
  hashDeviceKey,
  normalizeDeviceSignals,
  type NormalizedDeviceSignals
} from "../../auth/device-key";
import { resolveDeviceName, validateDeviceName } from "../../auth/device-names";
import {
  createDeviceKey,
  createSessionId,
  createSessionToken,
  hashSessionToken,
  readDeviceCookie,
  sessionIdleCutoffIso
} from "../../auth/sessions";
import type { DatabaseContext } from "../../db/client";
import { devices, sessions, users } from "../../db/schema";

type UserRow = typeof users.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;

export type IssueLoginSessionInput = {
  user: UserRow;
  request: Request;
  /** Device key the client keeps in localStorage (fallback when the device cookie is gone). */
  submittedDeviceKey?: string;
  /** Optional name typed at login. Empty means: keep the known name / derive one. */
  submittedDeviceName?: string;
  pwa?: boolean;
  timestamp: string;
};

export type IssuedLoginSession = {
  sessionId: string;
  sessionToken: string;
  /** Raw device key to (re)set as device cookie. Never log or persist it in plain text. */
  deviceKey: string;
  deviceId: string;
  deviceName: string;
  /** True when an existing device (or legacy session) was recognized. */
  recognized: boolean;
  signals: NormalizedDeviceSignals;
};

function uniqueKeys(keys: Array<string | undefined>) {
  return [...new Set(keys.filter((key): key is string => Boolean(key)))];
}

function findActiveDevice(context: DatabaseContext, userId: string, deviceKeyHash: string) {
  return context.db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.userId, userId),
        eq(devices.deviceKeyHash, deviceKeyHash),
        isNull(devices.forgottenAt)
      )
    )
    .get();
}

/**
 * Legacy fallback (pre-device sessions without any device key): reuse a session only
 * when exactly one unbound, active session matches the low-entropy signals.
 */
function findLegacySessionBySignals(
  context: DatabaseContext,
  userId: string,
  deviceSignals: string
): SessionRow | undefined {
  const candidates = context.db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.deviceSignals, deviceSignals),
        isNull(sessions.revokedAt),
        isNull(sessions.deviceKeyHash),
        isNull(sessions.deviceId),
        gte(sessions.lastSeenAt, sessionIdleCutoffIso())
      )
    )
    .all();
  return candidates.length === 1 ? candidates[0] : undefined;
}

function findActiveSessionForDevice(context: DatabaseContext, userId: string, deviceId: string) {
  return context.db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.deviceId, deviceId),
        isNull(sessions.revokedAt),
        gte(sessions.lastSeenAt, sessionIdleCutoffIso())
      )
    )
    .orderBy(desc(sessions.lastSeenAt))
    .get();
}

/**
 * Creates (or rotates) the session for a verified login and binds it to a persistent
 * device record. Must be called after the caller verified the user's proof (login code
 * or pairing token); run it inside the caller's transaction.
 *
 * Device lookup order: device cookie, then the client-submitted localStorage key. A device
 * is always scoped to the user, so a shared browser never leaks names across accounts.
 */
export function issueLoginSession(
  context: DatabaseContext,
  input: IssueLoginSessionInput
): IssuedLoginSession {
  const { user, request, timestamp } = input;
  const userAgent = request.get("user-agent") ?? undefined;
  const signals = normalizeDeviceSignals({ userAgent, pwa: input.pwa });
  const deviceSignals = deviceSignalsFingerprint(signals);

  const candidateKeys = uniqueKeys([readDeviceCookie(request), input.submittedDeviceKey]);
  let device: DeviceRow | undefined;
  let deviceKey: string | undefined;
  for (const key of candidateKeys) {
    device = findActiveDevice(context, user.id, hashDeviceKey(key));
    if (device) {
      deviceKey = key;
      break;
    }
  }

  const legacySession = device
    ? undefined
    : findLegacySessionBySignals(context, user.id, deviceSignals);
  deviceKey ??= candidateKeys[0] ?? createDeviceKey();
  const deviceKeyHash = hashDeviceKey(deviceKey);

  const submittedName = input.submittedDeviceName?.trim()
    ? validateDeviceName(input.submittedDeviceName)
    : undefined;
  const customName = submittedName?.ok ? submittedName.name : undefined;

  let deviceId: string;
  let deviceName: string;
  if (device) {
    deviceId = device.id;
    deviceName = customName ?? device.name;
    context.db
      .update(devices)
      .set({ name: deviceName, lastSeenAt: timestamp, deviceSignals })
      .where(eq(devices.id, device.id))
      .run();
  } else {
    deviceId = createSessionId();
    deviceName =
      customName ?? legacySession?.deviceName ?? resolveDeviceName(undefined, userAgent);
    context.db
      .insert(devices)
      .values({
        id: deviceId,
        userId: user.id,
        deviceKeyHash,
        name: deviceName,
        deviceSignals,
        createdAt: timestamp,
        lastSeenAt: timestamp,
        forgottenAt: null
      })
      .run();
  }

  const sessionToken = createSessionToken();
  const tokenHash = hashSessionToken(sessionToken);
  const reusable = legacySession ?? (device ? findActiveSessionForDevice(context, user.id, deviceId) : undefined);

  let sessionId: string;
  if (reusable) {
    sessionId = reusable.id;
    context.db
      .update(sessions)
      .set({
        tokenHash,
        lastSeenAt: timestamp,
        renewedAt: timestamp,
        userAgent: userAgent ?? null,
        deviceName,
        deviceKeyHash,
        deviceSignals,
        deviceId
      })
      .where(eq(sessions.id, reusable.id))
      .run();
  } else {
    sessionId = createSessionId();
    context.db
      .insert(sessions)
      .values({
        id: sessionId,
        userId: user.id,
        deviceName,
        userAgent: userAgent ?? null,
        lastSeenAt: timestamp,
        createdAt: timestamp,
        renewedAt: timestamp,
        tokenHash,
        revokedAt: null,
        deviceKeyHash,
        deviceSignals,
        deviceId
      })
      .run();
  }

  syncSessionDeviceNames(context, deviceId, deviceName);

  return {
    sessionId,
    sessionToken,
    deviceKey,
    deviceId,
    deviceName,
    recognized: Boolean(device || legacySession),
    signals
  };
}

/** Keeps the denormalized `sessions.device_name` of active sessions in line with the device. */
export function syncSessionDeviceNames(context: DatabaseContext, deviceId: string, name: string) {
  context.db
    .update(sessions)
    .set({ deviceName: name })
    .where(and(eq(sessions.deviceId, deviceId), isNull(sessions.revokedAt)))
    .run();
}

export type ForgetDeviceResult = { forgottenDeviceId: string | null; revokedSessions: number };

/**
 * "Forget this device": drops the device record (name), revokes every session bound to it
 * and the current session. The caller clears the session and device cookies.
 */
export function forgetCurrentDevice(
  context: DatabaseContext,
  current: { user: UserRow; session: SessionRow }
): ForgetDeviceResult {
  const timestamp = new Date().toISOString();
  const deviceId = current.session.deviceId;

  const revokedSessions = context.sqlite.transaction(() => {
    let changes = 0;
    if (deviceId) {
      context.db
        .update(devices)
        .set({ forgottenAt: timestamp })
        .where(and(eq(devices.id, deviceId), eq(devices.userId, current.user.id)))
        .run();
      changes += context.db
        .update(sessions)
        .set({ revokedAt: timestamp })
        .where(
          and(
            eq(sessions.deviceId, deviceId),
            eq(sessions.userId, current.user.id),
            isNull(sessions.revokedAt)
          )
        )
        .run().changes;
    }
    changes += context.db
      .update(sessions)
      .set({ revokedAt: timestamp })
      .where(and(eq(sessions.id, current.session.id), isNull(sessions.revokedAt)))
      .run().changes;
    return changes;
  })();

  tryWriteAuditLog(context, {
    actor: current.user,
    action: "auth.device_forget",
    entityType: "device",
    entityId: deviceId ?? current.session.id,
    summary: `${current.user.username} hat ein Gerät vergessen.`,
    metadata: { deviceName: current.session.deviceName, revokedSessions }
  });

  return { forgottenDeviceId: deviceId ?? null, revokedSessions };
}
