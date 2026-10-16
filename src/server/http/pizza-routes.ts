import { eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { tryWriteAuditLog } from "../audit-log";
import { requireCsrf } from "../auth/csrf";
import { requireUser } from "../auth/current-user";
import { enforceApiTokenWriteAccess } from "../auth/hermes-auth";
import type { DatabaseContext } from "../db/client";
import { pizzaMenuItems, pizzaMenuVariants, users } from "../db/schema";
import {
  getItemById,
  getVariantById,
  listActiveMenu,
  listAllMenu,
  removeItem,
  removeVariant,
  setItemActive,
  setVariantActive,
  upsertItem,
  upsertVariant,
  type PizzaMenuItemRow
} from "../domain/pizza/menu";
import {
  addLine,
  deleteLine,
  getOrderForUser,
  listOrdersForSession,
  markPayment,
  setPaymentMethod,
  updateLine
} from "../domain/pizza/orders";
import { defaultPaymentMethod, offeredPaymentMethods } from "../domain/pizza/payment";
import {
  archiveSession,
  deleteArchivedSession,
  getActiveSession,
  getSessionById,
  listArchivedSessions,
  transitionSession
} from "../domain/pizza/sessions";
import { guestTotals } from "../domain/pizza/totals";
import { canManagePizza } from "../domain/users";
import { buildKassenlistePdf, buildPizzeriaPdf } from "../pdf/pizza-print";
import { sendPushToEnabledUsers } from "../push/push-service";
import { broadcastEventsChanged } from "../realtime/event-bus";
import { readSettings } from "../settings";
import { handleDomainError } from "./errors";

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

const paymentMethodSchema = z.object({
  method: z.enum(["paypal", "cash"])
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
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional()
});

const activeSchema = z.object({ active: z.boolean() });

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
              sortOrder: z.number().int().optional(),
              active: z.boolean().optional()
            })
          )
          .max(8)
      })
    )
    .max(500)
});

type LineLabel = { itemNumber: string | null; itemName: string; sizeLabel: string | null };

/**
 * Bezeichnungen aller Varianten (auch deaktivierter), damit vergangene Bestellzeilen ihren
 * Namen behalten, selbst wenn der Artikel nicht mehr im bestellbaren Menü steht.
 */
function buildLineLabels(menu: PizzaMenuItemRow[]) {
  const labels = new Map<string, LineLabel>();
  for (const item of menu) {
    for (const variant of item.variants) {
      labels.set(variant.id, {
        itemNumber: item.number,
        itemName: item.name,
        sizeLabel: variant.sizeLabel
      });
    }
  }
  return labels;
}

function labelFor(labels: Map<string, LineLabel>, variantId: string): LineLabel {
  return labels.get(variantId) ?? { itemNumber: null, itemName: "[entfernt]", sizeLabel: null };
}

type OrderWithLines = ReturnType<typeof listOrdersForSession>[number];

function decorateOrder(order: OrderWithLines, labels: Map<string, LineLabel>) {
  return {
    ...order,
    lines: order.lines.map((line) => ({ ...line, ...labelFor(labels, line.variantId) }))
  };
}

function loadUsers(context: DatabaseContext, userIds: string[]) {
  const byId = new Map<string, { username: string; displayName: string | null }>();
  for (const userId of new Set(userIds)) {
    const found = context.db.select().from(users).where(eq(users.id, userId)).get();
    if (found) {
      byId.set(userId, { username: found.username, displayName: found.displayName });
    }
  }
  return byId;
}

function loadSerializedState(context: DatabaseContext, currentUserId: string) {
  const settings = readSettings(context);
  const session = getActiveSession(context);
  const menu = listActiveMenu(context);
  const labels = buildLineLabels(listAllMenu(context));
  const myOrder = session ? getOrderForUser(context, session.id, currentUserId) : null;
  const allOrders = session ? listOrdersForSession(context, session.id) : [];
  const usersById = loadUsers(
    context,
    allOrders.map((order) => order.userId)
  );

  return {
    session: session ?? null,
    menu,
    paymentMethods: offeredPaymentMethods(settings),
    myOrder: myOrder ? decorateOrder(myOrder, labels) : null,
    orders: allOrders.map((order) => ({
      ...decorateOrder(order, labels),
      user: usersById.get(order.userId) ?? { username: "unbekannt", displayName: null }
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

function requirePizzaManager(context: DatabaseContext, request: Request, response: Response) {
  const actor = requireUser(context, request)!;
  if (!canManagePizza(actor)) {
    response.status(403).json({ error: "manager_erforderlich" });
    return null;
  }
  return actor;
}

function respondDomainError(error: unknown, response: Response, logLabel: string) {
  if (!handleDomainError(error, response)) {
    console.error(`[Hermes] ${logLabel}`, error);
    response.status(500).json({ error: "interner_fehler" });
  }
}

/** Druck-Routen: Standard ist die aktuelle Runde, `?sessionId=` erlaubt archivierte Runden. */
function resolvePrintSession(context: DatabaseContext, request: Request) {
  const requested = typeof request.query.sessionId === "string" ? request.query.sessionId : "";
  return requested ? getSessionById(context, requested) : getActiveSession(context);
}

export function createPizzaRouter(context: DatabaseContext) {
  const router = Router();

  router.use((_request, response, next) => {
    if (!readSettings(context).featuresPizzaEnabled) {
      response.status(404).json({ error: "feature_deaktiviert" });
      return;
    }
    next();
  });

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
      if (!requireCsrf(context, request, response)) return;
    }
    next();
  });

  router.get("/state", (request, response) => {
    const actor = requireUser(context, request)!;
    response.json(loadSerializedState(context, actor.id));
  });

  router.post("/transitions", (request, response) => {
    const actor = requirePizzaManager(context, request, response);
    if (!actor) return;
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
      respondDomainError(error, response, "pizza transition failed");
    }
  });

  router.get("/sessions/archived", (request, response) => {
    if (!requirePizzaManager(context, request, response)) return;
    response.json({ sessions: listArchivedSessions(context) });
  });

  router.post("/sessions/:id/archive", (request, response) => {
    const actor = requirePizzaManager(context, request, response);
    if (!actor) return;
    try {
      const session = archiveSession(context, request.params.id, actor);
      tryWriteAuditLog(context, {
        actor,
        action: "pizza.session.archive",
        entityType: "pizza_session",
        entityId: session.id,
        summary: `Pizzarunde archiviert${session.label ? `: ${session.label}` : ""}`,
        metadata: { state: session.state }
      });
      broadcastEventsChanged("pizza_session_archived");
      response.json({ session });
    } catch (error) {
      respondDomainError(error, response, "pizza archive failed");
    }
  });

  router.delete("/sessions/:id", (request, response) => {
    const actor = requirePizzaManager(context, request, response);
    if (!actor) return;
    try {
      const { session, orderCount } = deleteArchivedSession(context, request.params.id);
      tryWriteAuditLog(context, {
        actor,
        action: "pizza.session.delete",
        entityType: "pizza_session",
        entityId: session.id,
        summary: `Archivierte Pizzarunde gelöscht${session.label ? `: ${session.label}` : ""}`,
        metadata: { orderCount, state: session.state }
      });
      response.status(204).end();
    } catch (error) {
      respondDomainError(error, response, "pizza session delete failed");
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
        customNote: parsed.data.customNote ?? null,
        defaultPaymentMethod: defaultPaymentMethod(offeredPaymentMethods(readSettings(context)))
      });
      broadcastEventsChanged("pizza_line_added");
      response.status(201).json({ lineId, orderId });
    } catch (error) {
      respondDomainError(error, response, "pizza addLine failed");
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
      respondDomainError(error, response, "pizza updateLine failed");
    }
  });

  router.delete("/lines/:lineId", (request, response) => {
    const actor = requireUser(context, request)!;
    try {
      deleteLine(context, request.params.lineId, actor.id);
      broadcastEventsChanged("pizza_line_deleted");
      response.status(204).end();
    } catch (error) {
      respondDomainError(error, response, "pizza deleteLine failed");
    }
  });

  router.post("/orders/mine/payment-method", (request, response) => {
    const actor = requireUser(context, request)!;
    const parsed = paymentMethodSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_methode" });
      return;
    }
    const session = getActiveSession(context);
    if (!session) {
      response.status(404).json({ error: "keine_session" });
      return;
    }
    try {
      setPaymentMethod(context, {
        sessionId: session.id,
        userId: actor.id,
        method: parsed.data.method,
        offered: offeredPaymentMethods(readSettings(context))
      });
      broadcastEventsChanged("pizza_payment_method");
      response.status(204).end();
    } catch (error) {
      respondDomainError(error, response, "pizza payment method failed");
    }
  });

  router.post("/orders/:orderId/payment", (request, response) => {
    const parsed = paymentSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_methode" });
      return;
    }
    const actor = requirePizzaManager(context, request, response);
    if (!actor) return;
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
      respondDomainError(error, response, "pizza payment failed");
    }
  });

  // --- Menüpflege (ab manager) ---------------------------------------------------------------

  router.get("/admin/menu", (request, response) => {
    if (!requirePizzaManager(context, request, response)) return;
    response.json({ items: listAllMenu(context) });
  });

  router.post("/admin/items", (request, response) => {
    const actor = requirePizzaManager(context, request, response);
    if (!actor) return;
    const parsed = itemUpsertSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_eingabe" });
      return;
    }
    const existed = parsed.data.id ? Boolean(getItemById(context, parsed.data.id)) : false;
    const id = upsertItem(context, parsed.data);
    tryWriteAuditLog(context, {
      actor,
      action: existed ? "pizza.menu.item.update" : "pizza.menu.item.create",
      entityType: "pizza_menu_item",
      entityId: id,
      summary: `Pizza-Menüeintrag ${existed ? "geändert" : "angelegt"}: ${parsed.data.name}`
    });
    broadcastEventsChanged("pizza_menu_changed");
    response.json({ id });
  });

  router.post("/admin/items/:id/active", (request, response) => {
    const actor = requirePizzaManager(context, request, response);
    if (!actor) return;
    const parsed = activeSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_eingabe" });
      return;
    }
    const item = getItemById(context, request.params.id);
    if (!item) {
      response.status(404).json({ error: "pizza_artikel_nicht_gefunden" });
      return;
    }
    setItemActive(context, item.id, parsed.data.active);
    tryWriteAuditLog(context, {
      actor,
      action: parsed.data.active ? "pizza.menu.item.activate" : "pizza.menu.item.deactivate",
      entityType: "pizza_menu_item",
      entityId: item.id,
      summary: `Pizza-Menüeintrag ${parsed.data.active ? "aktiviert" : "deaktiviert"}: ${item.name}`
    });
    broadcastEventsChanged("pizza_menu_changed");
    response.status(204).end();
  });

  router.delete("/admin/items/:id", (request, response) => {
    const actor = requirePizzaManager(context, request, response);
    if (!actor) return;
    const item = getItemById(context, request.params.id);
    const result = removeItem(context, request.params.id);
    if (!item || !result) {
      response.status(404).json({ error: "pizza_artikel_nicht_gefunden" });
      return;
    }
    tryWriteAuditLog(context, {
      actor,
      action: result === "deleted" ? "pizza.menu.item.delete" : "pizza.menu.item.deactivate",
      entityType: "pizza_menu_item",
      entityId: item.id,
      summary:
        result === "deleted"
          ? `Pizza-Menüeintrag gelöscht: ${item.name}`
          : `Pizza-Menüeintrag deaktiviert (in Bestellungen verwendet): ${item.name}`
    });
    broadcastEventsChanged("pizza_menu_changed");
    response.json({ result });
  });

  router.post("/admin/variants", (request, response) => {
    const actor = requirePizzaManager(context, request, response);
    if (!actor) return;
    const parsed = variantUpsertSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_eingabe" });
      return;
    }
    const previous = parsed.data.id ? getVariantById(context, parsed.data.id) : undefined;
    try {
      const id = upsertVariant(context, parsed.data);
      tryWriteAuditLog(context, {
        actor,
        action: previous ? "pizza.menu.variant.update" : "pizza.menu.variant.create",
        entityType: "pizza_menu_variant",
        entityId: id,
        summary: `Pizza-Variante ${previous ? "geändert" : "angelegt"}: ${parsed.data.sizeLabel ?? "Standard"}`,
        metadata: {
          itemId: previous?.itemId ?? parsed.data.itemId,
          priceCents: parsed.data.priceCents,
          previousPriceCents: previous?.priceCents ?? null
        }
      });
      broadcastEventsChanged("pizza_menu_changed");
      response.json({ id });
    } catch (error) {
      respondDomainError(error, response, "pizza variant upsert failed");
    }
  });

  router.post("/admin/variants/:id/active", (request, response) => {
    const actor = requirePizzaManager(context, request, response);
    if (!actor) return;
    const parsed = activeSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_eingabe" });
      return;
    }
    const variant = getVariantById(context, request.params.id);
    if (!variant) {
      response.status(404).json({ error: "pizza_variante_nicht_gefunden" });
      return;
    }
    setVariantActive(context, variant.id, parsed.data.active);
    tryWriteAuditLog(context, {
      actor,
      action: parsed.data.active ? "pizza.menu.variant.activate" : "pizza.menu.variant.deactivate",
      entityType: "pizza_menu_variant",
      entityId: variant.id,
      summary: `Pizza-Variante ${parsed.data.active ? "aktiviert" : "deaktiviert"}: ${variant.sizeLabel ?? "Standard"}`,
      metadata: { itemId: variant.itemId }
    });
    broadcastEventsChanged("pizza_menu_changed");
    response.status(204).end();
  });

  router.delete("/admin/variants/:id", (request, response) => {
    const actor = requirePizzaManager(context, request, response);
    if (!actor) return;
    const variant = getVariantById(context, request.params.id);
    const result = removeVariant(context, request.params.id);
    if (!variant || !result) {
      response.status(404).json({ error: "pizza_variante_nicht_gefunden" });
      return;
    }
    tryWriteAuditLog(context, {
      actor,
      action: result === "deleted" ? "pizza.menu.variant.delete" : "pizza.menu.variant.deactivate",
      entityType: "pizza_menu_variant",
      entityId: variant.id,
      summary:
        result === "deleted"
          ? `Pizza-Variante gelöscht: ${variant.sizeLabel ?? "Standard"}`
          : `Pizza-Variante deaktiviert (in Bestellungen verwendet): ${variant.sizeLabel ?? "Standard"}`,
      metadata: { itemId: variant.itemId }
    });
    broadcastEventsChanged("pizza_menu_changed");
    response.json({ result });
  });

  router.get("/admin/menu/export", (request, response) => {
    if (!requirePizzaManager(context, request, response)) return;
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
        sortOrder: variant.sortOrder,
        active: variant.active
      }))
    }));
    response.json({ items });
  });

  router.put("/admin/menu/import", (request, response) => {
    const actor = requirePizzaManager(context, request, response);
    if (!actor) return;
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
              sortOrder: variantInput.sortOrder ?? 0,
              active: variantInput.active ?? true
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
        let variantsDeactivated = 0;
        for (const dbVariant of allDbVariants) {
          if (seenVariantIds.has(dbVariant.id)) continue;
          // Referenzierte Varianten (Bestellhistorie) werden deaktiviert statt gelöscht.
          const result = removeVariant(context, dbVariant.id);
          if (result === "deleted") variantsRemoved += 1;
          if (result === "deactivated" && dbVariant.active) variantsDeactivated += 1;
        }

        return { deactivated, variantsRemoved, variantsDeactivated };
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
          variantsRemoved: stats.variantsRemoved,
          variantsDeactivated: stats.variantsDeactivated
        }
      });
      broadcastEventsChanged("pizza_menu_changed");

      response.json({
        ok: true,
        itemCount: parsed.data.items.length,
        deactivated: stats.deactivated,
        variantsRemoved: stats.variantsRemoved,
        variantsDeactivated: stats.variantsDeactivated
      });
    } catch (error) {
      console.error("[Hermes] pizza menu import failed", error);
      response.status(500).json({ error: "import_fehler" });
    }
  });

  // --- Druck (ab manager) --------------------------------------------------------------------

  router.get("/print/pizzeria.pdf", async (request, response) => {
    if (!requirePizzaManager(context, request, response)) return;
    const session = resolvePrintSession(context, request);
    if (!session) {
      response.status(404).json({ error: "keine_session" });
      return;
    }
    const orders = listOrdersForSession(context, session.id);
    const settings = readSettings(context);
    const menu = listAllMenu(context);
    const itemsById = new Map(menu.map((item) => [item.id, item]));

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
        const item = itemsById.get(variant.itemId);
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
    if (!requirePizzaManager(context, request, response)) return;
    const session = resolvePrintSession(context, request);
    if (!session) {
      response.status(404).json({ error: "keine_session" });
      return;
    }
    const orders = listOrdersForSession(context, session.id);
    const settings = readSettings(context);
    const labels = buildLineLabels(listAllMenu(context));
    const usersById = loadUsers(
      context,
      orders.map((order) => order.userId)
    );
    const offered = offeredPaymentMethods(settings);

    const guests = orders
      .map((order) => {
        const user = usersById.get(order.userId);
        const totalCents = order.lines.reduce(
          (sum, line) => sum + line.qty * line.priceCentsSnapshot,
          0
        );
        return {
          username: user?.username ?? "[gelöschter user]",
          displayName: user?.displayName ?? null,
          totalCents,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          lines: order.lines.map((line) => {
            const label = labelFor(labels, line.variantId);
            return {
              number: label.itemNumber,
              name: label.itemName,
              sizeLabel: label.sizeLabel,
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
        paypalName: offered.includes("paypal") ? settings.pizzaPaypalName || null : null,
        paypalHandle: offered.includes("paypal") ? settings.pizzaPaypalHandle || null : null,
        cashRecipient: offered.includes("cash") ? settings.pizzaCashRecipient || null : null,
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
