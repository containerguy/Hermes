export type PizzaSessionState = "draft" | "open" | "locked" | "delivered";
export type PizzaSessionTransition = "open" | "lock" | "deliver" | "reopen";
export type PizzaCategory = "pizza" | "pasta";
export type PizzaPaymentStatus = "unpaid" | "paid_paypal" | "paid_cash";

export interface PizzaVariant {
  id: string;
  itemId: string;
  sizeLabel: string | null;
  priceCents: number;
  sortOrder: number;
}

export interface PizzaItem {
  id: string;
  number: string | null;
  name: string;
  ingredients: string | null;
  allergens: string | null;
  category: PizzaCategory;
  active: boolean;
  sortOrder: number;
  variants: PizzaVariant[];
}

export interface PizzaSession {
  id: string;
  state: PizzaSessionState;
  label: string | null;
  openedAt: string | null;
  lockedAt: string | null;
  deliveredAt: string | null;
}

export interface PizzaOrderLine {
  id: string;
  orderId: string;
  variantId: string;
  qty: number;
  priceCentsSnapshot: number;
  customNote: string | null;
  createdAt: string;
}

export interface PizzaOrder {
  id: string;
  sessionId: string;
  userId: string;
  paymentStatus: PizzaPaymentStatus;
  paidAt: string | null;
  paidByAdminId: string | null;
  lines: PizzaOrderLine[];
}

export interface PizzaOrderWithUser extends PizzaOrder {
  user: { username: string; displayName: string | null };
}

export interface PizzaGuestTotal {
  userId: string;
  totalCents: number;
}

export interface PizzaPanelState {
  session: PizzaSession | null;
  menu: PizzaItem[];
  myOrder: PizzaOrder | null;
  orders: PizzaOrderWithUser[];
  guestTotals: PizzaGuestTotal[];
}
