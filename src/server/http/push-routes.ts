import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCurrentSession, publicUser, requireUser } from "../auth/current-user";
import { enforceApiTokenWriteAccess } from "../auth/hermes-auth";
import type { DatabaseContext } from "../db/client";
import { pushSubscriptions, users } from "../db/schema";
import { getVapidPublicKey } from "../push/push-service";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  })
});

const preferenceSchema = z.object({
  enabled: z.boolean()
});

function nowIso() {
  return new Date().toISOString();
}

export function createPushRouter(context: DatabaseContext) {
  const router = Router();

  router.use((request, response, next) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
      if (!enforceApiTokenWriteAccess(request, response)) {
        return;
      }
    }
    next();
  });

  router.get("/public-key", (_request, response) => {
    const publicKey = getVapidPublicKey();

    if (!publicKey) {
      response.status(503).json({ error: "push_nicht_konfiguriert" });
      return;
    }

    response.json({ publicKey });
  });

  router.post("/subscriptions", (request, response) => {
    const current = getCurrentSession(context, request);
    const user = requireUser(context, request);
    const parsed = subscriptionSchema.safeParse(request.body);

    if (!user) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_subscription" });
      return;
    }

    const sessionId = current?.session.id ?? null;

    const existing = context.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, parsed.data.endpoint))
      .get();
    const timestamp = nowIso();

    context.db
      .insert(pushSubscriptions)
      .values({
        id: existing?.id ?? randomUUID(),
        userId: user.id,
        sessionId,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        createdAt: existing?.createdAt ?? timestamp,
        revokedAt: null
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: user.id,
          sessionId,
          p256dh: parsed.data.keys.p256dh,
          auth: parsed.data.keys.auth,
          revokedAt: null
        }
      })
      .run();

    response.status(201).json({ ok: true });
  });

  router.delete("/subscriptions", (request, response) => {
    const user = requireUser(context, request);
    const parsed = z.object({ endpoint: z.string().url() }).safeParse(request.body);

    if (!user) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_subscription" });
      return;
    }

    context.db
      .update(pushSubscriptions)
      .set({ revokedAt: nowIso() })
      .where(
        and(
          eq(pushSubscriptions.endpoint, parsed.data.endpoint),
          eq(pushSubscriptions.userId, user.id)
        )
      )
      .run();

    response.status(204).send();
  });

  router.patch("/preferences", (request, response) => {
    const user = requireUser(context, request);
    const parsed = preferenceSchema.safeParse(request.body);

    if (!user) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }

    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_preferenz" });
      return;
    }

    context.db
      .update(users)
      .set({
        notificationsEnabled: parsed.data.enabled,
        updatedAt: nowIso()
      })
      .where(eq(users.id, user.id))
      .run();

    const updated = context.db.select().from(users).where(eq(users.id, user.id)).get();
    response.json({ user: updated ? publicUser(updated) : undefined });
  });

  return router;
}
