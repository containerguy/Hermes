import { requestJson } from "../api/request";
import type {
  PizzaArchivedSession,
  PizzaCategory,
  PizzaItem,
  PizzaPanelState,
  PizzaPaymentMethod,
  PizzaPaymentMode,
  PizzaSessionTransition
} from "./types";

export type PizzaRemovalResult = "deleted" | "deactivated";

export async function fetchPizzaState(): Promise<PizzaPanelState> {
  return requestJson<PizzaPanelState>(`/api/pizza/state`);
}

export async function transitionPizzaSession(
  transition: PizzaSessionTransition,
  label?: string | null
) {
  return requestJson<{ session: unknown }>(`/api/pizza/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition, ...(label !== undefined ? { label } : {}) })
  });
}

export async function addPizzaLine(input: {
  variantId: string;
  qty: number;
  customNote?: string | null;
}) {
  return requestJson<{ lineId: string; orderId: string }>(`/api/pizza/lines`, {
    method: "POST",
    body: JSON.stringify({
      variantId: input.variantId,
      qty: input.qty,
      customNote: input.customNote ?? null
    })
  });
}

export async function updatePizzaLine(
  lineId: string,
  patch: { qty?: number; customNote?: string | null }
) {
  await requestJson<void>(`/api/pizza/lines/${encodeURIComponent(lineId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export async function deletePizzaLine(lineId: string) {
  await requestJson<void>(`/api/pizza/lines/${encodeURIComponent(lineId)}`, {
    method: "DELETE"
  });
}

export async function markPizzaPayment(orderId: string, method: "paypal" | "cash" | "unpaid") {
  return requestJson<unknown>(`/api/pizza/orders/${encodeURIComponent(orderId)}/payment`, {
    method: "POST",
    body: JSON.stringify({ method })
  });
}

export async function choosePizzaPaymentMethod(method: PizzaPaymentMethod) {
  await requestJson<void>(`/api/pizza/orders/mine/payment-method`, {
    method: "POST",
    body: JSON.stringify({ method })
  });
}

export async function archivePizzaSession(sessionId: string) {
  return requestJson<{ session: unknown }>(
    `/api/pizza/sessions/${encodeURIComponent(sessionId)}/archive`,
    { method: "POST", body: JSON.stringify({}) }
  );
}

export async function fetchArchivedPizzaSessions() {
  const response = await requestJson<{ sessions: PizzaArchivedSession[] }>(
    `/api/pizza/sessions/archived`
  );
  return response.sessions;
}

export async function deleteArchivedPizzaSession(sessionId: string) {
  await requestJson<void>(`/api/pizza/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE"
  });
}

export interface PizzaAdminMenu {
  items: PizzaItem[];
  categories: PizzaCategory[];
}

export async function fetchPizzaAdminMenu(): Promise<PizzaAdminMenu> {
  const response = await requestJson<Partial<PizzaAdminMenu>>(`/api/pizza/admin/menu`);
  return {
    items: response.items ?? [],
    categories: response.categories ?? []
  };
}

export interface PizzaItemInput {
  id?: string;
  number: string | null;
  name: string;
  ingredients: string | null;
  allergens: string | null;
  categoryId: string;
  sortOrder?: number;
}

export interface PizzaCategoryInput {
  id?: string;
  name: string;
  sortOrder?: number;
  active?: boolean;
}

export async function savePizzaCategory(input: PizzaCategoryInput) {
  return requestJson<{ id: string }>(`/api/pizza/admin/categories`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function setPizzaCategoryActive(categoryId: string, active: boolean) {
  await requestJson<void>(`/api/pizza/admin/categories/${encodeURIComponent(categoryId)}/active`, {
    method: "POST",
    body: JSON.stringify({ active })
  });
}

export async function reorderPizzaCategories(ids: string[]) {
  await requestJson<void>(`/api/pizza/admin/categories/order`, {
    method: "POST",
    body: JSON.stringify({ ids })
  });
}

export async function deletePizzaCategory(categoryId: string) {
  await requestJson<void>(`/api/pizza/admin/categories/${encodeURIComponent(categoryId)}`, {
    method: "DELETE"
  });
}

export async function savePizzaItem(input: PizzaItemInput) {
  return requestJson<{ id: string }>(`/api/pizza/admin/items`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function setPizzaItemActive(itemId: string, active: boolean) {
  await requestJson<void>(`/api/pizza/admin/items/${encodeURIComponent(itemId)}/active`, {
    method: "POST",
    body: JSON.stringify({ active })
  });
}

export async function removePizzaItem(itemId: string) {
  const response = await requestJson<{ result: PizzaRemovalResult }>(
    `/api/pizza/admin/items/${encodeURIComponent(itemId)}`,
    { method: "DELETE" }
  );
  return response.result;
}

export interface PizzaVariantInput {
  id?: string;
  itemId: string;
  sizeLabel: string | null;
  priceCents: number;
  sortOrder?: number;
}

export async function savePizzaVariant(input: PizzaVariantInput) {
  return requestJson<{ id: string }>(`/api/pizza/admin/variants`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function setPizzaVariantActive(variantId: string, active: boolean) {
  await requestJson<void>(`/api/pizza/admin/variants/${encodeURIComponent(variantId)}/active`, {
    method: "POST",
    body: JSON.stringify({ active })
  });
}

export async function removePizzaVariant(variantId: string) {
  const response = await requestJson<{ result: PizzaRemovalResult }>(
    `/api/pizza/admin/variants/${encodeURIComponent(variantId)}`,
    { method: "DELETE" }
  );
  return response.result;
}

export async function setPizzaPaymentMode(mode: PizzaPaymentMode) {
  return requestJson<{ paymentMode: PizzaPaymentMode; paymentMethods: PizzaPaymentMethod[] }>(
    `/api/pizza/payment-mode`,
    { method: "PUT", body: JSON.stringify({ pizzaPaymentMethods: mode }) }
  );
}
