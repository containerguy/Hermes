export interface PizzaLineForTotal {
  qty: number;
  priceCentsSnapshot: number;
}

export interface PizzaOrderForTotal {
  userId: string;
  lines: PizzaLineForTotal[];
}

export interface PizzaGuestTotal {
  userId: string;
  totalCents: number;
}

export function lineTotalCents(line: PizzaLineForTotal): number {
  return line.qty * line.priceCentsSnapshot;
}

export function orderTotalCents(lines: PizzaLineForTotal[]): number {
  return lines.reduce((sum, line) => sum + lineTotalCents(line), 0);
}

export function guestTotals(orders: PizzaOrderForTotal[]): PizzaGuestTotal[] {
  return orders.map((order) => ({
    userId: order.userId,
    totalCents: orderTotalCents(order.lines)
  }));
}

export function sessionTotalCents(orders: PizzaOrderForTotal[]): number {
  return orders.reduce((sum, order) => sum + orderTotalCents(order.lines), 0);
}

export function formatEuro(cents: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR"
  }).format(cents / 100);
}

export function buildPaypalMeUrl(handle: string, cents: number): string | null {
  const trimmed = handle.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?paypal\.me\//i, "");
  if (!trimmed) return null;
  const amount = (cents / 100).toFixed(2);
  return `https://www.paypal.me/${encodeURIComponent(trimmed)}/${amount}EUR`;
}
