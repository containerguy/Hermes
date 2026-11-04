import { eq } from "drizzle-orm";
import type { DatabaseContext } from "../../db/client";
import { mainEventServers } from "../../db/schema";

/** Server-Bindungen, die ein Event anbietet; leer = alle Server. */
export function listEventServerIds(context: DatabaseContext, mainEventId: string) {
  return context.db
    .select({ bindingId: mainEventServers.bindingId })
    .from(mainEventServers)
    .where(eq(mainEventServers.mainEventId, mainEventId))
    .all()
    .map((row) => row.bindingId)
    .sort();
}

/** Bietet das Event (oder „ohne Event“) diesen Server an? Ohne Auswahl am Event: alle. */
export function isServerOffered(context: DatabaseContext, mainEventId: string | null, bindingId: string) {
  if (!mainEventId) return true;
  const offered = listEventServerIds(context, mainEventId);
  return offered.length === 0 || offered.includes(bindingId);
}

/** Angebotene Server eines Events setzen (leere Liste = wieder alle). */
export function setEventServers(context: DatabaseContext, mainEventId: string, bindingIds: string[]) {
  const now = new Date().toISOString();
  context.sqlite.transaction(() => {
    context.db.delete(mainEventServers).where(eq(mainEventServers.mainEventId, mainEventId)).run();
    for (const bindingId of new Set(bindingIds)) {
      context.db.insert(mainEventServers).values({ mainEventId, bindingId, createdAt: now }).run();
    }
  })();
}
