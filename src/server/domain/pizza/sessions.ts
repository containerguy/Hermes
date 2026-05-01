import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DatabaseContext } from "../../db/client";
import { pizzaSessions } from "../../db/schema";
import { PizzaLifecycleError, nextState, type PizzaSessionTransition } from "./lifecycle";
import { countActiveItems } from "./menu";

function nowIso() {
  return new Date().toISOString();
}

export function getSessionForEvent(context: DatabaseContext, eventId: string) {
  return context.db
    .select()
    .from(pizzaSessions)
    .where(eq(pizzaSessions.eventId, eventId))
    .get();
}

export function getOrCreateDraftSession(context: DatabaseContext, eventId: string) {
  const existing = getSessionForEvent(context, eventId);
  if (existing) return existing;

  const id = randomUUID();
  const now = nowIso();
  context.db
    .insert(pizzaSessions)
    .values({
      id,
      eventId,
      state: "draft",
      createdAt: now,
      updatedAt: now
    })
    .run();
  return getSessionForEvent(context, eventId)!;
}

export function transitionSession(
  context: DatabaseContext,
  eventId: string,
  transition: PizzaSessionTransition,
  actor: { id: string }
) {
  const session = getOrCreateDraftSession(context, eventId);

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

  return getSessionForEvent(context, eventId)!;
}
