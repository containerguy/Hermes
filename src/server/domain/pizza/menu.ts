import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DatabaseContext } from "../../db/client";
import { pizzaMenuItems, pizzaMenuVariants } from "../../db/schema";

export interface PizzaMenuVariantRow {
  id: string;
  itemId: string;
  sizeLabel: string | null;
  priceCents: number;
  sortOrder: number;
}

export interface PizzaMenuItemRow {
  id: string;
  number: string | null;
  name: string;
  ingredients: string | null;
  allergens: string | null;
  category: "pizza" | "pasta";
  active: boolean;
  sortOrder: number;
  variants: PizzaMenuVariantRow[];
}

function nowIso() {
  return new Date().toISOString();
}

export function listActiveMenu(context: DatabaseContext): PizzaMenuItemRow[] {
  const items = context.db
    .select()
    .from(pizzaMenuItems)
    .where(eq(pizzaMenuItems.active, true))
    .orderBy(asc(pizzaMenuItems.sortOrder), asc(pizzaMenuItems.name))
    .all();

  if (items.length === 0) return [];

  const variants = context.db
    .select()
    .from(pizzaMenuVariants)
    .orderBy(asc(pizzaMenuVariants.sortOrder))
    .all();

  const variantsByItem = new Map<string, PizzaMenuVariantRow[]>();
  for (const variant of variants) {
    const list = variantsByItem.get(variant.itemId) ?? [];
    list.push(variant);
    variantsByItem.set(variant.itemId, list);
  }

  return items.map((item) => ({
    ...item,
    variants: variantsByItem.get(item.id) ?? []
  }));
}

export function listAllMenu(context: DatabaseContext): PizzaMenuItemRow[] {
  const items = context.db
    .select()
    .from(pizzaMenuItems)
    .orderBy(asc(pizzaMenuItems.sortOrder), asc(pizzaMenuItems.name))
    .all();

  const variants = context.db
    .select()
    .from(pizzaMenuVariants)
    .orderBy(asc(pizzaMenuVariants.sortOrder))
    .all();

  const variantsByItem = new Map<string, PizzaMenuVariantRow[]>();
  for (const variant of variants) {
    const list = variantsByItem.get(variant.itemId) ?? [];
    list.push(variant);
    variantsByItem.set(variant.itemId, list);
  }

  return items.map((item) => ({
    ...item,
    variants: variantsByItem.get(item.id) ?? []
  }));
}

export function getVariantById(context: DatabaseContext, variantId: string) {
  return context.db
    .select()
    .from(pizzaMenuVariants)
    .where(eq(pizzaMenuVariants.id, variantId))
    .get();
}

export function getVariantWithItem(context: DatabaseContext, variantId: string) {
  const variant = getVariantById(context, variantId);
  if (!variant) return null;
  const item = context.db
    .select()
    .from(pizzaMenuItems)
    .where(eq(pizzaMenuItems.id, variant.itemId))
    .get();
  if (!item || !item.active) return null;
  return { variant, item };
}

export function countActiveItems(context: DatabaseContext): number {
  return context.db
    .select()
    .from(pizzaMenuItems)
    .where(eq(pizzaMenuItems.active, true))
    .all().length;
}

export interface UpsertItemInput {
  id?: string;
  number?: string | null;
  name: string;
  ingredients?: string | null;
  allergens?: string | null;
  category: "pizza" | "pasta";
  active?: boolean;
  sortOrder?: number;
}

export function upsertItem(context: DatabaseContext, input: UpsertItemInput) {
  const id = input.id ?? randomUUID();
  const existing = context.db
    .select()
    .from(pizzaMenuItems)
    .where(eq(pizzaMenuItems.id, id))
    .get();

  if (existing) {
    context.db
      .update(pizzaMenuItems)
      .set({
        number: input.number ?? null,
        name: input.name,
        ingredients: input.ingredients ?? null,
        allergens: input.allergens ?? null,
        category: input.category,
        active: input.active ?? existing.active,
        sortOrder: input.sortOrder ?? existing.sortOrder,
        updatedAt: nowIso()
      })
      .where(eq(pizzaMenuItems.id, id))
      .run();
  } else {
    context.db
      .insert(pizzaMenuItems)
      .values({
        id,
        number: input.number ?? null,
        name: input.name,
        ingredients: input.ingredients ?? null,
        allergens: input.allergens ?? null,
        category: input.category,
        active: input.active ?? true,
        sortOrder: input.sortOrder ?? 0,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
      .run();
  }
  return id;
}

export interface UpsertVariantInput {
  id?: string;
  itemId: string;
  sizeLabel: string | null;
  priceCents: number;
  sortOrder?: number;
}

export function upsertVariant(context: DatabaseContext, input: UpsertVariantInput) {
  const id = input.id ?? randomUUID();
  const existing = context.db
    .select()
    .from(pizzaMenuVariants)
    .where(eq(pizzaMenuVariants.id, id))
    .get();

  if (existing) {
    context.db
      .update(pizzaMenuVariants)
      .set({
        sizeLabel: input.sizeLabel,
        priceCents: input.priceCents,
        sortOrder: input.sortOrder ?? existing.sortOrder
      })
      .where(eq(pizzaMenuVariants.id, id))
      .run();
  } else {
    context.db
      .insert(pizzaMenuVariants)
      .values({
        id,
        itemId: input.itemId,
        sizeLabel: input.sizeLabel,
        priceCents: input.priceCents,
        sortOrder: input.sortOrder ?? 0
      })
      .run();
  }
  return id;
}

export function deleteVariant(context: DatabaseContext, variantId: string) {
  context.db.delete(pizzaMenuVariants).where(eq(pizzaMenuVariants.id, variantId)).run();
}

export function setItemActive(context: DatabaseContext, itemId: string, active: boolean) {
  context.db
    .update(pizzaMenuItems)
    .set({ active, updatedAt: nowIso() })
    .where(eq(pizzaMenuItems.id, itemId))
    .run();
}

export function listVariantsForItem(context: DatabaseContext, itemId: string) {
  return context.db
    .select()
    .from(pizzaMenuVariants)
    .where(eq(pizzaMenuVariants.itemId, itemId))
    .orderBy(asc(pizzaMenuVariants.sortOrder))
    .all();
}

export { and, eq };
