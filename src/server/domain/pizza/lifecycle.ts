export type PizzaSessionState = "draft" | "open" | "locked" | "delivered";

export type PizzaSessionTransition = "open" | "lock" | "deliver" | "reopen";

const TRANSITIONS: Record<PizzaSessionTransition, { from: PizzaSessionState; to: PizzaSessionState }> = {
  open: { from: "draft", to: "open" },
  lock: { from: "open", to: "locked" },
  deliver: { from: "locked", to: "delivered" },
  reopen: { from: "locked", to: "open" }
};

export class PizzaLifecycleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function nextState(
  current: PizzaSessionState,
  transition: PizzaSessionTransition
): PizzaSessionState {
  const rule = TRANSITIONS[transition];
  if (!rule) {
    throw new PizzaLifecycleError("unknown_transition", `Unbekannter Übergang: ${transition}`);
  }
  if (rule.from !== current) {
    throw new PizzaLifecycleError(
      "invalid_transition",
      `Übergang ${transition} ist von ${current} nicht erlaubt`
    );
  }
  return rule.to;
}

export function canPlaceOrder(state: PizzaSessionState): boolean {
  return state === "open";
}

export function canMarkPayment(state: PizzaSessionState): boolean {
  return state === "locked" || state === "delivered";
}

export function canEditMenu(state: PizzaSessionState | null): boolean {
  return state === null || state === "draft" || state === "open";
}
