import { and, eq, inArray, isNull } from "drizzle-orm";
import webpush from "web-push";
import type { DatabaseContext } from "../db/client";
import { pushSubscriptions, users } from "../db/schema";

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  vibrate?: number[];
  requireInteraction?: boolean;
};

let configured = false;

export function getVapidPublicKey() {
  return process.env.HERMES_VAPID_PUBLIC_KEY?.trim() ?? "";
}

function nowIso() {
  return new Date().toISOString();
}

function configureWebPush() {
  if (configured) {
    return true;
  }

  const publicKey = getVapidPublicKey();
  const privateKey = process.env.HERMES_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.HERMES_VAPID_SUBJECT?.trim() ?? "mailto:admin@example.test";

  if (!publicKey || !privateKey) {
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export async function sendPushToUser(
  context: DatabaseContext,
  userId: string,
  payload: PushPayload
) {
  if (!configureWebPush()) {
    console.warn("[Hermes] Push skipped: VAPID keys are missing.");
    return;
  }

  const user = context.db.select().from(users).where(eq(users.id, userId)).get();

  if (!user?.notificationsEnabled) {
    return;
  }

  const subscriptions = context.db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.revokedAt)))
    .all();

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth
            }
          },
          JSON.stringify(payload)
        );

        context.db
          .update(pushSubscriptions)
          .set({
            failureCount: 0,
            lastSuccessAt: nowIso()
          })
          .where(eq(pushSubscriptions.id, subscription.id))
          .run();
      } catch (error) {
        const statusCode =
          typeof error === "object" && error && "statusCode" in error
            ? Number((error as { statusCode: unknown }).statusCode)
            : 0;

        const failedAt = nowIso();
        const currentFailures = Number(subscription.failureCount ?? 0);
        const nextFailures = currentFailures + 1;

        if (statusCode === 404 || statusCode === 410) {
          context.db
            .update(pushSubscriptions)
            .set({
              revokedAt: failedAt,
              failureCount: nextFailures,
              lastFailureAt: failedAt
            })
            .where(eq(pushSubscriptions.id, subscription.id))
            .run();
          return;
        }

        context.db
          .update(pushSubscriptions)
          .set({
            failureCount: nextFailures,
            lastFailureAt: failedAt,
            revokedAt: nextFailures >= 3 ? failedAt : null
          })
          .where(eq(pushSubscriptions.id, subscription.id))
          .run();

        if (nextFailures < 3) {
          console.error("[Hermes] Push delivery failed", error);
        } else {
          console.warn("[Hermes] Push subscription revoked after repeated failures.");
        }
      }
    })
  );
}

export async function sendPushToEnabledUsers(context: DatabaseContext, payload: PushPayload) {
  const targets = context.db
    .select()
    .from(users)
    .where(eq(users.notificationsEnabled, true))
    .all();

  await Promise.all(targets.map((target) => sendPushToUser(context, target.id, payload)));
}

export async function sendPushToOperators(context: DatabaseContext, payload: PushPayload) {
  const targets = context.db
    .select()
    .from(users)
    .where(
      and(
        eq(users.notificationsEnabled, true),
        inArray(users.role, ["admin", "manager", "organizer"])
      )
    )
    .all();

  await Promise.all(targets.map((target) => sendPushToUser(context, target.id, payload)));
}
