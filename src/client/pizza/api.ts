import { getCsrfToken } from "../api/csrf";
import { requestJson } from "../api/request";
import type { PizzaPanelState, PizzaSessionTransition } from "./types";

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
  await fetch(`/api/pizza/lines/${encodeURIComponent(lineId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Hermes-CSRF": await getCsrfToken() },
    body: JSON.stringify(patch)
  });
}

export async function deletePizzaLine(lineId: string) {
  await fetch(`/api/pizza/lines/${encodeURIComponent(lineId)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { "X-Hermes-CSRF": await getCsrfToken() }
  });
}

export async function markPizzaPayment(orderId: string, method: "paypal" | "cash" | "unpaid") {
  return requestJson<unknown>(`/api/pizza/orders/${encodeURIComponent(orderId)}/payment`, {
    method: "POST",
    body: JSON.stringify({ method })
  });
}
