import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DatabaseContext } from "../../db/client";
import { pizzaOrderLines, pizzaOrders, pizzaSessions } from "../../db/schema";
import { canMarkPayment, canPlaceOrder } from "./lifecycle";
import { getVariantWithItem } from "./menu";
import {
  assertCanAddLine,
  assertValidNote,
  assertValidQty,
  normalizeNote,
  PizzaOrderLimitError
} from "./order-limits";

function nowIso() {
  return new Date().toISOString();
}

export class PizzaOrderError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function assertSessionOpen(state: string) {
  if (!canPlaceOrder(state as never)) {
    throw new PizzaOrderError("session_not_open", "Bestellung ist nicht offen");
  }
}

function getOrCreateOrder(context: DatabaseContext, sessionId: string, userId: string) {
  const existing = context.db
    .select()
    .from(pizzaOrders)
    .where(and(eq(pizzaOrders.sessionId, sessionId), eq(pizzaOrders.userId, userId)))
    .get();
  if (existing) return existing;

  const now = nowIso();
  const id = randomUUID();
  context.db
    .insert(pizzaOrders)
    .values({
      id,
      sessionId,
      userId,
      paymentStatus: "unpaid",
      createdAt: now,
      updatedAt: now
    })
    .run();
  return context.db.select().from(pizzaOrders).where(eq(pizzaOrders.id, id)).get()!;
}

function getSession(context: DatabaseContext, sessionId: string) {
  const session = context.db
    .select()
    .from(pizzaSessions)
    .where(eq(pizzaSessions.id, sessionId))
    .get();
  if (!session) throw new PizzaOrderError("session_missing", "Bestell-Session nicht gefunden", 404);
  return session;
}

function listLinesForOrder(context: DatabaseContext, orderId: string) {
  return context.db
    .select()
    .from(pizzaOrderLines)
    .where(eq(pizzaOrderLines.orderId, orderId))
    .orderBy(asc(pizzaOrderLines.createdAt))
    .all();
}

export interface AddLineInput {
  sessionId: string;
  userId: string;
  variantId: string;
  qty: number;
  customNote?: string | null;
}

export function addLine(context: DatabaseContext, input: AddLineInput) {
  const session = getSession(context, input.sessionId);
  assertSessionOpen(session.state);
  assertValidQty(input.qty);
  const note = normalizeNote(input.customNote);
  assertValidNote(note);

  const variantWithItem = getVariantWithItem(context, input.variantId);
  if (!variantWithItem) {
    throw new PizzaOrderError("variant_missing", "Variante nicht gefunden", 404);
  }

  const order = getOrCreateOrder(context, input.sessionId, input.userId);
  const existingLines = listLinesForOrder(context, order.id);
  assertCanAddLine(existingLines);

  const id = randomUUID();
  context.db
    .insert(pizzaOrderLines)
    .values({
      id,
      orderId: order.id,
      variantId: input.variantId,
      qty: input.qty,
      priceCentsSnapshot: variantWithItem.variant.priceCents,
      customNote: note,
      createdAt: nowIso()
    })
    .run();

  return { lineId: id, orderId: order.id };
}

export interface UpdateLineInput {
  lineId: string;
  userId: string;
  qty?: number;
  customNote?: string | null;
}

function findLineWithOrder(context: DatabaseContext, lineId: string) {
  const line = context.db
    .select()
    .from(pizzaOrderLines)
    .where(eq(pizzaOrderLines.id, lineId))
    .get();
  if (!line) return null;
  const order = context.db
    .select()
    .from(pizzaOrders)
    .where(eq(pizzaOrders.id, line.orderId))
    .get();
  if (!order) return null;
  return { line, order };
}

export function updateLine(context: DatabaseContext, input: UpdateLineInput) {
  const found = findLineWithOrder(context, input.lineId);
  if (!found) throw new PizzaOrderError("line_missing", "Position nicht gefunden", 404);
  if (found.order.userId !== input.userId) {
    throw new PizzaOrderError("forbidden", "Position gehört einem anderen User", 403);
  }
  const session = getSession(context, found.order.sessionId);
  assertSessionOpen(session.state);

  const update: Partial<typeof pizzaOrderLines.$inferInsert> = {};
  if (typeof input.qty === "number") {
    assertValidQty(input.qty);
    update.qty = input.qty;
  }
  if (input.customNote !== undefined) {
    const note = normalizeNote(input.customNote);
    assertValidNote(note);
    update.customNote = note;
  }
  if (Object.keys(update).length === 0) return;
  context.db.update(pizzaOrderLines).set(update).where(eq(pizzaOrderLines.id, input.lineId)).run();
}

export function deleteLine(context: DatabaseContext, lineId: string, userId: string) {
  const found = findLineWithOrder(context, lineId);
  if (!found) return;
  if (found.order.userId !== userId) {
    throw new PizzaOrderError("forbidden", "Position gehört einem anderen User", 403);
  }
  const session = getSession(context, found.order.sessionId);
  assertSessionOpen(session.state);
  context.db.delete(pizzaOrderLines).where(eq(pizzaOrderLines.id, lineId)).run();
}

export function listOrdersForSession(context: DatabaseContext, sessionId: string) {
  const orders = context.db
    .select()
    .from(pizzaOrders)
    .where(eq(pizzaOrders.sessionId, sessionId))
    .all();

  return orders.map((order) => ({
    ...order,
    lines: listLinesForOrder(context, order.id)
  }));
}

export function getOrderForUser(context: DatabaseContext, sessionId: string, userId: string) {
  const order = context.db
    .select()
    .from(pizzaOrders)
    .where(and(eq(pizzaOrders.sessionId, sessionId), eq(pizzaOrders.userId, userId)))
    .get();
  if (!order) return null;
  return { ...order, lines: listLinesForOrder(context, order.id) };
}

export function cancelOpenOrderForUser(context: DatabaseContext, sessionId: string, userId: string) {
  const order = context.db
    .select()
    .from(pizzaOrders)
    .where(and(eq(pizzaOrders.sessionId, sessionId), eq(pizzaOrders.userId, userId)))
    .get();
  if (!order) return false;
  context.db.delete(pizzaOrders).where(eq(pizzaOrders.id, order.id)).run();
  return true;
}

export type PaymentMethod = "paypal" | "cash";

export function markPayment(
  context: DatabaseContext,
  input: { orderId: string; method: PaymentMethod | "unpaid"; adminId: string }
) {
  const order = context.db
    .select()
    .from(pizzaOrders)
    .where(eq(pizzaOrders.id, input.orderId))
    .get();
  if (!order) throw new PizzaOrderError("order_missing", "Bestellung nicht gefunden", 404);
  const session = getSession(context, order.sessionId);
  if (!canMarkPayment(session.state as never)) {
    throw new PizzaOrderError(
      "session_not_locked",
      "Zahlung kann erst nach Schließen der Bestellung gebucht werden"
    );
  }

  const now = nowIso();
  const status =
    input.method === "paypal"
      ? "paid_paypal"
      : input.method === "cash"
        ? "paid_cash"
        : "unpaid";

  context.db
    .update(pizzaOrders)
    .set({
      paymentStatus: status,
      paidAt: status === "unpaid" ? null : now,
      paidByAdminId: status === "unpaid" ? null : input.adminId,
      updatedAt: now
    })
    .where(eq(pizzaOrders.id, input.orderId))
    .run();
}

export { PizzaOrderLimitError };
