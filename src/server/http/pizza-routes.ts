import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { tryWriteAuditLog } from "../audit-log";
import { requireUser } from "../auth/current-user";
import { enforceApiTokenWriteAccess } from "../auth/hermes-auth";
import type { DatabaseContext } from "../db/client";
import { gameEvents, pizzaMenuItems, pizzaMenuVariants, users } from "../db/schema";
import { canManageEvent } from "../domain/users";
import { PizzaLifecycleError } from "../domain/pizza/lifecycle";
import {
  countActiveItems,
  deleteVariant,
  getVariantById,
  listActiveMenu,
  listAllMenu,
  setItemActive,
  upsertItem,
  upsertVariant
} from "../domain/pizza/menu";
import {
  PizzaOrderError,
  addLine,
  cancelOpenOrderForUser,
  deleteLine,
  getOrderForUser,
  listOrdersForSession,
  markPayment,
  updateLine
} from "../domain/pizza/orders";
import { getOrCreateDraftSession, getSessionForEvent, transitionSession } from "../domain/pizza/sessions";
import { guestTotals } from "../domain/pizza/totals";
import { buildKassenlistePdf, buildPizzeriaPdf } from "../pdf/pizza-print";
import { sendPushToEnabledUsers } from "../push/push-service";
import { broadcastEventsChanged } from "../realtime/event-bus";
import { readSettings } from "../settings";

const transitionSchema = z.object({
  transition: z.enum(["open", "lock", "deliver", "reopen"])
});

const addLineSchema = z.object({
  variantId: z.string().min(1),
  qty: z.number().int().min(1).max(3),
  customNote: z.string().trim().max(200).nullable().optional()
});

const updateLineSchema = z.object({
  qty: z.number().int().min(1).max(3).optional(),
  customNote: z.string().trim().max(200).nullable().optional()
});

const paymentSchema = z.object({
  method: z.enum(["paypal", "cash", "unpaid"])
});

const itemUpsertSchema = z.object({
  id: z.string().optional(),
  number: z.string().trim().max(16).nullable().optional(),
  name: z.string().trim().min(1).max(120),
  ingredients: z.string().trim().max(500).nullable().optional(),
  allergens: z.string().trim().max(120).nullable().optional(),
  category: z.enum(["pizza", "pasta"]),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional()
});

const variantUpsertSchema = z.object({
  id: z.string().optional(),
  itemId: z.string().min(1),
  sizeLabel: z.string().trim().max(32).nullable(),
  priceCents: z.number().int().min(0).max(100_000),
  sortOrder: z.number().int().optional()
});

function findEvent(context: DatabaseContext, eventId: string) {
  return context.db.select().from(gameEvents).where(eq(gameEvents.id, eventId)).get();
}

function loadSerializedState(context: DatabaseContext, eventId: string, currentUserId: string) {
  const event = findEvent(context, eventId);
  if (!event) return null;

  const session = getSessionForEvent(context, eventId);
  const menu = listActiveMenu(context);
  const myOrder = session ? getOrderForUser(context, session.id, currentUserId) : null;
  const allOrders = session ? listOrdersForSession(context, session.id) : [];

  const usernamesById = new Map<string, { username: string; displayName: string | null }>();
  for (const order of allOrders) {
    const found = context.db.select().from(users).where(eq(users.id, order.userId)).get();
    if (found) {
      usernamesById.set(order.userId, {
        username: found.username,
        displayName: found.displayName
      });
    }
  }

  return {
    event: {
      id: event.id,
      gameTitle: event.gameTitle,
      createdByUserId: event.createdByUserId
    },
    session,
    menu,
    myOrder,
    orders: allOrders.map((order) => ({
      ...order,
      user: usernamesById.get(order.userId) ?? { username: "unbekannt", displayName: null }
    })),
    guestTotals: guestTotals(
      allOrders.map((order) => ({
        userId: order.userId,
        lines: order.lines.map((line) => ({
          qty: line.qty,
          priceCentsSnapshot: line.priceCentsSnapshot
        }))
      }))
    )
  };
}

function handleDomainError(error: unknown, response: import("express").Response) {
  if (error instanceof PizzaOrderError) {
    response.status(error.status).json({ error: error.code });
    return true;
  }
  if (error instanceof PizzaLifecycleError) {
    response.status(409).json({ error: error.code });
    return true;
  }
  if (error instanceof Error) {
    const code = (error as unknown as { code?: unknown }).code;
    if (typeof code === "string") {
      response.status(400).json({ error: code });
      return true;
    }
  }
  return false;
}

export function createPizzaRouter(context: DatabaseContext) {
  const router = Router();

  router.use((request, response, next) => {
    if (!requireUser(context, request)) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }
    next();
  });

  router.use((request, response, next) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
      if (!enforceApiTokenWriteAccess(request, response)) return;
    }
    next();
  });

  router.get("/events/:eventId/state", (request, response) => {
    const actor = requireUser(context, request)!;
    const state = loadSerializedState(context, request.params.eventId, actor.id);
    if (!state) {
      response.status(404).json({ error: "event_nicht_gefunden" });
      return;
    }
    response.json(state);
  });

  router.post("/events/:eventId/transitions", (request, response) => {
    const actor = requireUser(context, request)!;
    const event = findEvent(context, request.params.eventId);
    if (!event) {
      response.status(404).json({ error: "event_nicht_gefunden" });
      return;
    }
    if (!canManageEvent(actor, event)) {
      response.status(403).json({ error: "manager_erforderlich" });
      return;
    }
    const parsed = transitionSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_uebergang" });
      return;
    }
    try {
      const session = transitionSession(context, event.id, parsed.data.transition, actor);
      tryWriteAuditLog(context, {
        actor,
        action: `pizza.session.${parsed.data.transition}`,
        entityType: "pizza_session",
        entityId: session.id,
        summary: `Pizzabestellung: ${parsed.data.transition} (Event ${event.gameTitle})`
      });
      broadcastEventsChanged(`pizza_session_${parsed.data.transition}`);

      if (parsed.data.transition === "open") {
        sendPushToEnabledUsers(context, {
          title: "Pizzabestellung offen",
          body: `Bestelle für ${event.gameTitle}, bis Admin schließt`,
          url: `/#start`
        }).catch(() => undefined);
      }

      response.json({ session });
    } catch (error) {
      if (!handleDomainError(error, response)) {
        console.error("[Hermes] pizza transition failed", error);
        response.status(500).json({ error: "interner_fehler" });
      }
    }
  });

  router.post("/events/:eventId/lines", (request, response) => {
    const actor = requireUser(context, request)!;
    const session = getSessionForEvent(context, request.params.eventId);
    if (!session) {
      response.status(404).json({ error: "session_nicht_offen" });
      return;
    }
    const parsed = addLineSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_eingabe" });
      return;
    }
    try {
      const { lineId, orderId } = addLine(context, {
        sessionId: session.id,
        userId: actor.id,
        variantId: parsed.data.variantId,
        qty: parsed.data.qty,
        customNote: parsed.data.customNote ?? null
      });
      broadcastEventsChanged("pizza_line_added");
      response.status(201).json({ lineId, orderId });
    } catch (error) {
      if (!handleDomainError(error, response)) {
        console.error("[Hermes] pizza addLine failed", error);
        response.status(500).json({ error: "interner_fehler" });
      }
    }
  });

  router.patch("/lines/:lineId", (request, response) => {
    const actor = requireUser(context, request)!;
    const parsed = updateLineSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_eingabe" });
      return;
    }
    try {
      updateLine(context, {
        lineId: request.params.lineId,
        userId: actor.id,
        qty: parsed.data.qty,
        customNote: parsed.data.customNote
      });
      broadcastEventsChanged("pizza_line_updated");
      response.status(204).end();
    } catch (error) {
      if (!handleDomainError(error, response)) {
        response.status(500).json({ error: "interner_fehler" });
      }
    }
  });

  router.delete("/lines/:lineId", (request, response) => {
    const actor = requireUser(context, request)!;
    try {
      deleteLine(context, request.params.lineId, actor.id);
      broadcastEventsChanged("pizza_line_deleted");
      response.status(204).end();
    } catch (error) {
      if (!handleDomainError(error, response)) {
        response.status(500).json({ error: "interner_fehler" });
      }
    }
  });

  router.post("/orders/:orderId/payment", (request, response) => {
    const actor = requireUser(context, request)!;
    const parsed = paymentSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_methode" });
      return;
    }
    if (actor.role !== "admin" && actor.role !== "manager") {
      response.status(403).json({ error: "manager_erforderlich" });
      return;
    }
    try {
      markPayment(context, {
        orderId: request.params.orderId,
        method: parsed.data.method,
        adminId: actor.id
      });
      tryWriteAuditLog(context, {
        actor,
        action: "pizza.payment.mark",
        entityType: "pizza_order",
        entityId: request.params.orderId,
        summary: `Zahlung markiert: ${parsed.data.method}`
      });
      broadcastEventsChanged("pizza_payment_marked");
      response.status(204).end();
    } catch (error) {
      if (!handleDomainError(error, response)) {
        response.status(500).json({ error: "interner_fehler" });
      }
    }
  });

  router.get("/admin/menu", (_request, response) => {
    response.json({ items: listAllMenu(context) });
  });

  router.post("/admin/items", (request, response) => {
    const actor = requireUser(context, request)!;
    if (actor.role !== "admin") {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }
    const parsed = itemUpsertSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_eingabe" });
      return;
    }
    const id = upsertItem(context, parsed.data);
    tryWriteAuditLog(context, {
      actor,
      action: "pizza.menu.item.upsert",
      entityType: "pizza_menu_item",
      entityId: id,
      summary: `Menüeintrag gespeichert: ${parsed.data.name}`
    });
    response.json({ id });
  });

  router.post("/admin/items/:id/active", (request, response) => {
    const actor = requireUser(context, request)!;
    if (actor.role !== "admin") {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }
    const active = z.object({ active: z.boolean() }).safeParse(request.body);
    if (!active.success) {
      response.status(400).json({ error: "ungueltige_eingabe" });
      return;
    }
    setItemActive(context, request.params.id, active.data.active);
    tryWriteAuditLog(context, {
      actor,
      action: "pizza.menu.item.active",
      entityType: "pizza_menu_item",
      entityId: request.params.id,
      summary: `Menüeintrag ${active.data.active ? "aktiviert" : "deaktiviert"}`
    });
    response.status(204).end();
  });

  router.post("/admin/variants", (request, response) => {
    const actor = requireUser(context, request)!;
    if (actor.role !== "admin") {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }
    const parsed = variantUpsertSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_eingabe" });
      return;
    }
    const id = upsertVariant(context, parsed.data);
    response.json({ id });
  });

  router.delete("/admin/variants/:id", (request, response) => {
    const actor = requireUser(context, request)!;
    if (actor.role !== "admin") {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }
    deleteVariant(context, request.params.id);
    response.status(204).end();
  });

  router.get("/events/:eventId/print/pizzeria.pdf", async (request, response) => {
    const actor = requireUser(context, request)!;
    const event = findEvent(context, request.params.eventId);
    if (!event) {
      response.status(404).json({ error: "event_nicht_gefunden" });
      return;
    }
    if (!canManageEvent(actor, event)) {
      response.status(403).json({ error: "manager_erforderlich" });
      return;
    }
    const session = getSessionForEvent(context, event.id);
    if (!session) {
      response.status(404).json({ error: "keine_session" });
      return;
    }
    const orders = listOrdersForSession(context, session.id);

    type Aggregate = {
      number: string | null;
      name: string;
      sizeLabel: string | null;
      qty: number;
      customNotes: string[];
      sortKey: string;
    };

    const aggregateMap = new Map<string, Aggregate>();
    for (const order of orders) {
      for (const line of order.lines) {
        const variant = getVariantById(context, line.variantId);
        if (!variant) continue;
        const item = context.db
          .select()
          .from(pizzaMenuItems)
          .where(eq(pizzaMenuItems.id, variant.itemId))
          .get();
        if (!item) continue;
        const key = `${item.id}:${variant.id}`;
        const existing = aggregateMap.get(key);
        const note = line.customNote;
        if (existing) {
          existing.qty += line.qty;
          if (note) existing.customNotes.push(`${line.qty}× ${note}`);
        } else {
          aggregateMap.set(key, {
            number: item.number,
            name: item.name,
            sizeLabel: variant.sizeLabel,
            qty: line.qty,
            customNotes: note ? [`${line.qty}× ${note}`] : [],
            sortKey: `${item.number ?? "zzz"}:${variant.sortOrder}`
          });
        }
      }
    }

    const rows = Array.from(aggregateMap.values())
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .map((row) => ({
        number: row.number,
        name: row.name,
        sizeLabel: row.sizeLabel,
        qty: row.qty,
        customNote: row.customNotes.length > 0 ? row.customNotes.join("; ") : null
      }));

    try {
      const buffer = await buildPizzeriaPdf({
        eventTitle: event.gameTitle,
        printedAt: new Date(),
        rows
      });
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="pizzeria-${event.id}.pdf"`
      );
      response.send(buffer);
    } catch (error) {
      console.error("[Hermes] pizzeria pdf failed", error);
      response.status(500).json({ error: "pdf_fehler" });
    }
  });

  router.get("/events/:eventId/print/kassenliste.pdf", async (request, response) => {
    const actor = requireUser(context, request)!;
    const event = findEvent(context, request.params.eventId);
    if (!event) {
      response.status(404).json({ error: "event_nicht_gefunden" });
      return;
    }
    if (!canManageEvent(actor, event)) {
      response.status(403).json({ error: "manager_erforderlich" });
      return;
    }
    const session = getSessionForEvent(context, event.id);
    if (!session) {
      response.status(404).json({ error: "keine_session" });
      return;
    }
    const orders = listOrdersForSession(context, session.id);
    const settings = readSettings(context);

    const guests = orders
      .map((order) => {
        const user = context.db.select().from(users).where(eq(users.id, order.userId)).get();
        const totalCents = order.lines.reduce(
          (sum, line) => sum + line.qty * line.priceCentsSnapshot,
          0
        );
        return {
          username: user?.username ?? "[gelöschter user]",
          displayName: user?.displayName ?? null,
          totalCents,
          paymentStatus: order.paymentStatus,
          lines: order.lines.map((line) => {
            const variant = getVariantById(context, line.variantId);
            const item = variant
              ? context.db
                  .select()
                  .from(pizzaMenuItems)
                  .where(eq(pizzaMenuItems.id, variant.itemId))
                  .get()
              : null;
            return {
              number: item?.number ?? null,
              name: item?.name ?? "[entfernt]",
              sizeLabel: variant?.sizeLabel ?? null,
              qty: line.qty,
              priceCentsSnapshot: line.priceCentsSnapshot,
              customNote: line.customNote
            };
          })
        };
      })
      .sort((a, b) => (a.displayName ?? a.username).localeCompare(b.displayName ?? b.username));

    try {
      const buffer = await buildKassenlistePdf({
        eventTitle: event.gameTitle,
        printedAt: new Date(),
        paypalName: settings.pizzaPaypalName || null,
        paypalHandle: settings.pizzaPaypalHandle || null,
        cashRecipient: settings.pizzaCashRecipient || null,
        guests
      });
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="kassenliste-${event.id}.pdf"`
      );
      response.send(buffer);
    } catch (error) {
      console.error("[Hermes] kassenliste pdf failed", error);
      response.status(500).json({ error: "pdf_fehler" });
    }
  });

  return router;
}

export { cancelOpenOrderForUser, countActiveItems, getOrCreateDraftSession, pizzaMenuVariants };
