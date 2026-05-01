import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DatabaseContext } from "../../db/client";
import { pizzaSessions } from "../../db/schema";
import { PizzaLifecycleError, nextState, type PizzaSessionTransition } from "./lifecycle";
import { countActiveItems } from "./menu";

function nowIso() {
  return new Date().toISOString();
}

export function getActiveSession(context: DatabaseContext) {
  return context.db
    .select()
    .from(pizzaSessions)
    .orderBy(desc(pizzaSessions.createdAt))
    .limit(1)
    .all()[0];
}

export function getOrCreateDraftSession(context: DatabaseContext) {
  const existing = getActiveSession(context);
  if (existing && existing.state !== "delivered") return existing;

  const id = randomUUID();
  const now = nowIso();
  context.db
    .insert(pizzaSessions)
    .values({
      id,
      state: "draft",
      createdAt: now,
      updatedAt: now
    })
    .run();
  return context.db.select().from(pizzaSessions).where(eq(pizzaSessions.id, id)).get()!;
}

export function getSessionById(context: DatabaseContext, sessionId: string) {
  return context.db.select().from(pizzaSessions).where(eq(pizzaSessions.id, sessionId)).get();
}

export function transitionSession(
  context: DatabaseContext,
  transition: PizzaSessionTransition,
  actor: { id: string },
  label?: string | null
) {
  const session = getOrCreateDraftSession(context);

  if (transition === "open") {
    if (countActiveItems(context) === 0) {
      throw new PizzaLifecycleError("menu_empty", "Mindestens ein aktiver Menüeintrag erforderlich");
    }
  }

  const target = nextState(session.state, transition);
  const now = nowIso();

  const update: Partial<typeof pizzaSessions.$inferInsert> = {
    state: target,
    updatedAt: now
  };

  if (transition === "open") {
    update.openedAt = now;
    update.openedByUserId = actor.id;
    update.lockedAt = null;
    update.lockedByUserId = null;
    update.deliveredAt = null;
    update.deliveredByUserId = null;
    if (typeof label === "string") update.label = label.trim() || null;
  } else if (transition === "lock") {
    update.lockedAt = now;
    update.lockedByUserId = actor.id;
  } else if (transition === "deliver") {
    update.deliveredAt = now;
    update.deliveredByUserId = actor.id;
  } else if (transition === "reopen") {
    update.lockedAt = null;
    update.lockedByUserId = null;
  }

  context.db.update(pizzaSessions).set(update).where(eq(pizzaSessions.id, session.id)).run();

  return getSessionById(context, session.id)!;
}
