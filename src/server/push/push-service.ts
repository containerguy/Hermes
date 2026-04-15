import { and, eq, isNull } from "drizzle-orm";
import webpush from "web-push";
import type { DatabaseContext } from "../db/client";
import { pushSubscriptions, users } from "../db/schema";

type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

let configured = false;

export function getVapidPublicKey() {
  return process.env.HERMES_VAPID_PUBLIC_KEY?.trim() ?? "";
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
      } catch (error) {
        const statusCode =
          typeof error === "object" && error && "statusCode" in error
            ? Number((error as { statusCode: unknown }).statusCode)
            : 0;

        if (statusCode === 404 || statusCode === 410) {
          context.db
            .update(pushSubscriptions)
            .set({ revokedAt: new Date().toISOString() })
            .where(eq(pushSubscriptions.id, subscription.id))
            .run();
        } else {
          console.error("[Hermes] Push delivery failed", error);
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
