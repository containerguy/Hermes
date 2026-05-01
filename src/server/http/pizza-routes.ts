import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { tryWriteAuditLog } from "../audit-log";
import { requireUser } from "../auth/current-user";
import { enforceApiTokenWriteAccess } from "../auth/hermes-auth";
import type { DatabaseContext } from "../db/client";
import { pizzaMenuItems, pizzaMenuVariants, users } from "../db/schema";
import { PizzaLifecycleError } from "../domain/pizza/lifecycle";
import {
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
  deleteLine,
  getOrderForUser,
  listOrdersForSession,
  markPayment,
  updateLine
} from "../domain/pizza/orders";
import {
  getActiveSession,
  getOrCreateDraftSession,
  transitionSession
} from "../domain/pizza/sessions";
import { guestTotals } from "../domain/pizza/totals";
import { buildKassenlistePdf, buildPizzeriaPdf } from "../pdf/pizza-print";
import { sendPushToEnabledUsers } from "../push/push-service";
import { broadcastEventsChanged } from "../realtime/event-bus";
import { readSettings } from "../settings";

const transitionSchema = z.object({
  transition: z.enum(["open", "lock", "deliver", "reopen"]),
  label: z.string().trim().max(120).optional()
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

const menuImportSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        number: z.string().trim().max(16).nullable().optional(),
        name: z.string().trim().min(1).max(120),
        ingredients: z.string().trim().max(500).nullable().optional(),
        allergens: z.string().trim().max(120).nullable().optional(),
        category: z.enum(["pizza", "pasta"]),
        active: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
        variants: z
          .array(
            z.object({
              id: z.string().optional(),
              sizeLabel: z.string().trim().max(32).nullable(),
              priceCents: z.number().int().min(0).max(100_000),
              sortOrder: z.number().int().optional()
            })
          )
          .max(8)
      })
    )
    .max(500)
});

function loadSerializedState(context: DatabaseContext, currentUserId: string) {
  const session = getActiveSession(context);
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
    session: session ?? null,
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

function isManager(role: string): boolean {
  return role === "admin" || role === "manager";
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

  router.get("/state", (request, response) => {
    const actor = requireUser(context, request)!;
    response.json(loadSerializedState(context, actor.id));
  });

  router.post("/transitions", (request, response) => {
    const actor = requireUser(context, request)!;
    if (!isManager(actor.role)) {
      response.status(403).json({ error: "manager_erforderlich" });
      return;
    }
    const parsed = transitionSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltiger_uebergang" });
      return;
    }
    try {
      const session = transitionSession(context, parsed.data.transition, actor, parsed.data.label);
      tryWriteAuditLog(context, {
        actor,
        action: `pizza.session.${parsed.data.transition}`,
        entityType: "pizza_session",
        entityId: session.id,
        summary: `Pizzabestellung: ${parsed.data.transition}`
      });
      broadcastEventsChanged(`pizza_session_${parsed.data.transition}`);

      if (parsed.data.transition === "open") {
        sendPushToEnabledUsers(context, {
          title: "Pizzabestellung offen",
          body: `Bestelle jetzt — Admin schließt manuell.`,
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

  router.post("/lines", (request, response) => {
    const actor = requireUser(context, request)!;
    const session = getActiveSession(context);
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
    if (!isManager(actor.role)) {
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

  router.get("/admin/menu/export", (request, response) => {
    const actor = requireUser(context, request)!;
    if (actor.role !== "admin") {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }
    const items = listAllMenu(context).map((item) => ({
      id: item.id,
      number: item.number,
      name: item.name,
      ingredients: item.ingredients,
      allergens: item.allergens,
      category: item.category,
      active: item.active,
      sortOrder: item.sortOrder,
      variants: item.variants.map((variant) => ({
        id: variant.id,
        sizeLabel: variant.sizeLabel,
        priceCents: variant.priceCents,
        sortOrder: variant.sortOrder
      }))
    }));
    response.json({ items });
  });

  router.put("/admin/menu/import", (request, response) => {
    const actor = requireUser(context, request)!;
    if (actor.role !== "admin") {
      response.status(403).json({ error: "admin_erforderlich" });
      return;
    }
    const parsed = menuImportSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: "ungueltiges_menu",
        details: parsed.error.issues.slice(0, 5).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
      return;
    }

    const seenItemIds = new Set<string>();
    const seenVariantIds = new Set<string>();

    try {
      const tx = context.sqlite.transaction(() => {
        for (const itemInput of parsed.data.items) {
          const itemId = upsertItem(context, {
            id: itemInput.id,
            number: itemInput.number ?? null,
            name: itemInput.name,
            ingredients: itemInput.ingredients ?? null,
            allergens: itemInput.allergens ?? null,
            category: itemInput.category,
            active: itemInput.active ?? true,
            sortOrder: itemInput.sortOrder ?? 0
          });
          seenItemIds.add(itemId);
          for (const variantInput of itemInput.variants) {
            const variantId = upsertVariant(context, {
              id: variantInput.id,
              itemId,
              sizeLabel: variantInput.sizeLabel,
              priceCents: variantInput.priceCents,
              sortOrder: variantInput.sortOrder ?? 0
            });
            seenVariantIds.add(variantId);
          }
        }

        const allDbItems = context.db.select().from(pizzaMenuItems).all();
        let deactivated = 0;
        for (const dbItem of allDbItems) {
          if (!seenItemIds.has(dbItem.id) && dbItem.active) {
            setItemActive(context, dbItem.id, false);
            deactivated += 1;
          }
        }
        const allDbVariants = context.db.select().from(pizzaMenuVariants).all();
        let variantsRemoved = 0;
        for (const dbVariant of allDbVariants) {
          if (seenVariantIds.has(dbVariant.id)) continue;
          try {
            deleteVariant(context, dbVariant.id);
            variantsRemoved += 1;
          } catch {
            // referenced by existing order line — leave in place
          }
        }

        return { deactivated, variantsRemoved };
      });

      const stats = tx();
      tryWriteAuditLog(context, {
        actor,
        action: "pizza.menu.import",
        entityType: "pizza_menu",
        summary: `Pizza-Menü importiert (${parsed.data.items.length} Einträge)`,
        metadata: {
          itemCount: parsed.data.items.length,
          deactivated: stats.deactivated,
          variantsRemoved: stats.variantsRemoved
        }
      });

      response.json({
        ok: true,
        itemCount: parsed.data.items.length,
        deactivated: stats.deactivated,
        variantsRemoved: stats.variantsRemoved
      });
    } catch (error) {
      console.error("[Hermes] pizza menu import failed", error);
      response.status(500).json({ error: "import_fehler" });
    }
  });

  router.get("/print/pizzeria.pdf", async (request, response) => {
    const actor = requireUser(context, request)!;
    if (!isManager(actor.role)) {
      response.status(403).json({ error: "manager_erforderlich" });
      return;
    }
    const session = getActiveSession(context);
    if (!session) {
      response.status(404).json({ error: "keine_session" });
      return;
    }
    const orders = listOrdersForSession(context, session.id);
    const settings = readSettings(context);

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
        eventTitle: session.label ?? settings.appName ?? "Pizzabestellung",
        printedAt: new Date(),
        rows
      });
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="pizzeria-${session.id}.pdf"`
      );
      response.send(buffer);
    } catch (error) {
      console.error("[Hermes] pizzeria pdf failed", error);
      response.status(500).json({ error: "pdf_fehler" });
    }
  });

  router.get("/print/kassenliste.pdf", async (request, response) => {
    const actor = requireUser(context, request)!;
    if (!isManager(actor.role)) {
      response.status(403).json({ error: "manager_erforderlich" });
      return;
    }
    const session = getActiveSession(context);
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
        eventTitle: session.label ?? settings.appName ?? "Pizzabestellung",
        printedAt: new Date(),
        paypalName: settings.pizzaPaypalName || null,
        paypalHandle: settings.pizzaPaypalHandle || null,
        cashRecipient: settings.pizzaCashRecipient || null,
        guests
      });
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="kassenliste-${session.id}.pdf"`
      );
      response.send(buffer);
    } catch (error) {
      console.error("[Hermes] kassenliste pdf failed", error);
      response.status(500).json({ error: "pdf_fehler" });
    }
  });

  return router;
}

export { getOrCreateDraftSession };
