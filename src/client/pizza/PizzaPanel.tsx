import { useEffect, useMemo, useState } from "react";
import {
  addPizzaLine,
  deletePizzaLine,
  fetchPizzaState,
  markPizzaPayment,
  transitionPizzaSession,
  updatePizzaLine
} from "./api";
import type {
  PizzaItem,
  PizzaOrderWithUser,
  PizzaPanelState,
  PizzaSessionTransition,
  PizzaVariant
} from "./types";

interface PizzaPanelProps {
  currentUserId: string;
  currentUserRole: "user" | "organizer" | "manager" | "admin";
  paypalHandle: string;
  paypalName: string;
  cashRecipient: string;
}

function formatEuro(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function buildPaypalUrl(handle: string, cents: number): string | null {
  const trimmed = handle.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?paypal\.me\//i, "");
  if (!trimmed) return null;
  return `https://www.paypal.me/${encodeURIComponent(trimmed)}/${(cents / 100).toFixed(2)}EUR`;
}

export function PizzaPanel({
  currentUserId,
  currentUserRole,
  paypalHandle,
  paypalName,
  cashRecipient
}: PizzaPanelProps) {
  const [state, setState] = useState<PizzaPanelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showMenu, setShowMenu] = useState(false);

  async function reload() {
    try {
      const next = await fetchPizzaState();
      setState(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch_failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    const onRefresh = () => void reload();
    window.addEventListener("hermes:events-refresh", onRefresh);
    return () => window.removeEventListener("hermes:events-refresh", onRefresh);
  }, []);

  const isManager = currentUserRole === "admin" || currentUserRole === "manager";

  const myTotalCents = useMemo(() => {
    if (!state?.myOrder) return 0;
    return state.myOrder.lines.reduce((sum, line) => sum + line.qty * line.priceCentsSnapshot, 0);
  }, [state]);

  if (loading) return <p className="muted pizza-loading">Pizza-Bestellung lädt…</p>;
  if (!state) return null;

  const session = state.session;
  const sessionState = session?.state ?? "draft";

  if (!isManager && sessionState !== "open" && sessionState !== "locked" && sessionState !== "delivered") {
    return null;
  }

  async function doTransition(transition: PizzaSessionTransition) {
    try {
      await transitionPizzaSession(transition);
      await reload();
    } catch (err) {
      setError((err as { message?: string }).message ?? "transition_failed");
    }
  }

  return (
    <section className="pizza-panel" aria-label="Pizzabestellung">
      <header className="pizza-panel__header">
        <h3>Pizzabestellung{session?.label ? ` — ${session.label}` : ""}</h3>
        <span className={`pizza-panel__pill pizza-panel__pill--${sessionState}`}>
          {labelForState(sessionState)}
        </span>
      </header>

      {error ? (
        <p className="pizza-panel__error" role="alert">
          {error}
        </p>
      ) : null}

      {isManager ? <PizzaAdminControls state={state} onTransition={doTransition} /> : null}

      {sessionState === "open" ? (
        <PizzaOrderEditor
          state={state}
          showMenu={showMenu}
          onToggleMenu={() => setShowMenu((v) => !v)}
          onChanged={reload}
        />
      ) : null}

      {(sessionState === "locked" || sessionState === "delivered") && state.myOrder ? (
        <MyShareView
          order={state.myOrder}
          menu={state.menu}
          totalCents={myTotalCents}
          paypalHandle={paypalHandle}
          paypalName={paypalName}
          cashRecipient={cashRecipient}
        />
      ) : null}

      {sessionState !== "draft" ? (
        <AllOrdersOverview
          state={state}
          isManager={isManager}
          onPaymentChanged={reload}
          currentUserId={currentUserId}
        />
      ) : null}
    </section>
  );
}

function labelForState(state: string): string {
  switch (state) {
    case "draft":
      return "Noch nicht offen";
    case "open":
      return "Bestellung offen";
    case "locked":
      return "Geschlossen";
    case "delivered":
      return "Geliefert";
    default:
      return state;
  }
}

interface AdminProps {
  state: PizzaPanelState;
  onTransition: (transition: PizzaSessionTransition) => Promise<void>;
}

function PizzaAdminControls({ state, onTransition }: AdminProps) {
  const sessionState = state.session?.state ?? "draft";

  return (
    <div className="pizza-panel__admin">
      {sessionState === "draft" ? (
        <button type="button" className="primary" onClick={() => onTransition("open")}>
          Bestellung öffnen
        </button>
      ) : null}
      {sessionState === "open" ? (
        <button type="button" className="primary" onClick={() => onTransition("lock")}>
          Bestellung schließen
        </button>
      ) : null}
      {sessionState === "locked" ? (
        <>
          <button type="button" className="secondary" onClick={() => onTransition("reopen")}>
            Wieder öffnen
          </button>
          <button type="button" className="primary" onClick={() => onTransition("deliver")}>
            Als geliefert markieren
          </button>
          <a
            className="secondary pizza-panel__pdf-link"
            href={`/api/pizza/print/pizzeria.pdf`}
            target="_blank"
            rel="noreferrer"
          >
            PDF: An Pizzeria
          </a>
          <a
            className="secondary pizza-panel__pdf-link"
            href={`/api/pizza/print/kassenliste.pdf`}
            target="_blank"
            rel="noreferrer"
          >
            PDF: Kassenliste
          </a>
        </>
      ) : null}
      {sessionState === "delivered" ? (
        <a
          className="secondary"
          href={`/api/pizza/print/kassenliste.pdf`}
          target="_blank"
          rel="noreferrer"
        >
          PDF: Kassenliste
        </a>
      ) : null}
    </div>
  );
}

interface OrderEditorProps {
  state: PizzaPanelState;
  showMenu: boolean;
  onToggleMenu: () => void;
  onChanged: () => Promise<void>;
}

function PizzaOrderEditor({ state, showMenu, onToggleMenu, onChanged }: OrderEditorProps) {
  const myLines = state.myOrder?.lines ?? [];
  const myTotal = myLines.reduce((sum, line) => sum + line.qty * line.priceCentsSnapshot, 0);
  const remaining = 3 - myLines.length;

  return (
    <div className="pizza-panel__editor">
      <h4>Meine Bestellung</h4>
      {myLines.length === 0 ? (
        <p className="muted">Noch keine Position. Wähle unten aus dem Menü.</p>
      ) : (
        <ul className="pizza-line-list">
          {myLines.map((line) => {
            const variant = findVariant(state.menu, line.variantId);
            const item = variant ? findItem(state.menu, variant.itemId) : null;
            return (
              <li key={line.id} className="pizza-line">
                <div className="pizza-line__main">
                  <span className="pizza-line__name">
                    {item ? `${item.number ? `${item.number} ${item.name}` : item.name}` : "[entfernt]"}
                    {variant?.sizeLabel ? ` (${variant.sizeLabel})` : ""}
                  </span>
                  <span className="pizza-line__price">
                    {formatEuro(line.qty * line.priceCentsSnapshot)}
                  </span>
                </div>
                <div className="pizza-line__controls">
                  <label>
                    Menge:
                    <select
                      value={line.qty}
                      onChange={async (ev) => {
                        await updatePizzaLine(line.id, { qty: Number(ev.target.value) });
                        await onChanged();
                      }}
                    >
                      {[1, 2, 3].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    className="pizza-line__note"
                    type="text"
                    placeholder="Sonderwunsch (optional)"
                    defaultValue={line.customNote ?? ""}
                    maxLength={200}
                    onBlur={async (ev) => {
                      await updatePizzaLine(line.id, { customNote: ev.target.value });
                      await onChanged();
                    }}
                  />
                  <button
                    type="button"
                    className="secondary"
                    onClick={async () => {
                      await deletePizzaLine(line.id);
                      await onChanged();
                    }}
                  >
                    Entfernen
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="pizza-line-list__total">
        Zwischensumme: <strong>{formatEuro(myTotal)}</strong>
      </p>

      <div className="pizza-menu-toggle">
        <button type="button" className="secondary" onClick={onToggleMenu} disabled={remaining === 0}>
          {showMenu ? "Menü ausblenden" : remaining === 0 ? "Maximum erreicht" : `Menü öffnen (${remaining} frei)`}
        </button>
      </div>

      {showMenu && remaining > 0 ? <PizzaMenuBrowser menu={state.menu} onAdded={onChanged} /> : null}
    </div>
  );
}

interface MenuBrowserProps {
  menu: PizzaItem[];
  onAdded: () => Promise<void>;
}

function PizzaMenuBrowser({ menu, onAdded }: MenuBrowserProps) {
  const pizzas = menu.filter((item) => item.category === "pizza");
  const pasta = menu.filter((item) => item.category === "pasta");
  return (
    <div className="pizza-menu-browser">
      {pizzas.length > 0 ? (
        <details open>
          <summary>Pizza ({pizzas.length})</summary>
          <PizzaMenuList items={pizzas} onAdded={onAdded} />
        </details>
      ) : null}
      {pasta.length > 0 ? (
        <details>
          <summary>Pasta &amp; Aufläufe ({pasta.length})</summary>
          <PizzaMenuList items={pasta} onAdded={onAdded} />
        </details>
      ) : null}
    </div>
  );
}

function PizzaMenuList({
  items,
  onAdded
}: {
  items: PizzaItem[];
  onAdded: () => Promise<void>;
}) {
  return (
    <ul className="pizza-menu-list">
      {items.map((item) => (
        <li key={item.id} className="pizza-menu-item">
          <div className="pizza-menu-item__head">
            <span className="pizza-menu-item__number">{item.number ?? "—"}</span>
            <span className="pizza-menu-item__name">{item.name}</span>
            {item.allergens ? (
              <span className="pizza-menu-item__allergens">[{item.allergens}]</span>
            ) : null}
          </div>
          {item.ingredients ? (
            <p className="pizza-menu-item__ingredients">{item.ingredients}</p>
          ) : null}
          <div className="pizza-menu-item__variants">
            {item.variants.map((variant) => (
              <button
                key={variant.id}
                type="button"
                className="secondary"
                onClick={async () => {
                  await addPizzaLine({ variantId: variant.id, qty: 1 });
                  await onAdded();
                }}
              >
                {variant.sizeLabel ?? "Standard"} · {formatEuro(variant.priceCents)}
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function findVariant(menu: PizzaItem[], variantId: string): PizzaVariant | null {
  for (const item of menu) {
    const found = item.variants.find((variant) => variant.id === variantId);
    if (found) return found;
  }
  return null;
}

function findItem(menu: PizzaItem[], itemId: string): PizzaItem | null {
  return menu.find((item) => item.id === itemId) ?? null;
}

interface MyShareProps {
  order: PizzaPanelState["myOrder"];
  menu: PizzaItem[];
  totalCents: number;
  paypalHandle: string;
  paypalName: string;
  cashRecipient: string;
}

function MyShareView({ order, menu, totalCents, paypalHandle, paypalName, cashRecipient }: MyShareProps) {
  if (!order) return null;
  const paypalUrl = buildPaypalUrl(paypalHandle, totalCents);
  return (
    <div className="pizza-my-share">
      <h4>Mein Anteil</h4>
      <ul className="pizza-line-list pizza-line-list--readonly">
        {order.lines.map((line) => {
          const variant = findVariant(menu, line.variantId);
          const item = variant ? findItem(menu, variant.itemId) : null;
          return (
            <li key={line.id} className="pizza-line">
              <span>
                {line.qty}× {item?.name ?? "[entfernt]"}
                {variant?.sizeLabel ? ` (${variant.sizeLabel})` : ""}
                {line.customNote ? ` — ${line.customNote}` : ""}
              </span>
              <span>{formatEuro(line.qty * line.priceCentsSnapshot)}</span>
            </li>
          );
        })}
      </ul>
      <p className="pizza-my-share__total">
        Summe: <strong>{formatEuro(totalCents)}</strong>
      </p>
      <p className="pizza-my-share__status">
        Status:{" "}
        {order.paymentStatus === "unpaid"
          ? "Offen"
          : order.paymentStatus === "paid_paypal"
            ? "Mit PayPal bezahlt"
            : "Bar bezahlt"}
      </p>
      {order.paymentStatus === "unpaid" ? (
        <div className="pizza-my-share__pay">
          {paypalUrl ? (
            <a className="primary" href={paypalUrl} target="_blank" rel="noreferrer">
              PayPal{paypalName ? ` an ${paypalName}` : ""} bezahlen ({formatEuro(totalCents)})
            </a>
          ) : null}
          {cashRecipient ? <p className="muted">Bargeld an: {cashRecipient}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

interface OverviewProps {
  state: PizzaPanelState;
  isManager: boolean;
  onPaymentChanged: () => Promise<void>;
  currentUserId: string;
}

function AllOrdersOverview({ state, isManager, onPaymentChanged, currentUserId }: OverviewProps) {
  if (state.orders.length === 0) {
    return <p className="muted pizza-overview__empty">Noch keine Bestellungen.</p>;
  }
  const totalsByUser = new Map(state.guestTotals.map((g) => [g.userId, g.totalCents]));
  return (
    <div className="pizza-overview">
      <h4>Alle Bestellungen ({state.orders.length})</h4>
      <ul className="pizza-overview__list">
        {state.orders.map((order) => {
          const total = totalsByUser.get(order.userId) ?? 0;
          const isMe = order.userId === currentUserId;
          return (
            <li key={order.id} className="pizza-overview__guest">
              <div className="pizza-overview__guest-head">
                <strong>
                  {order.user.displayName ?? order.user.username}
                  {isMe ? " (du)" : ""}
                </strong>
                <span>{formatEuro(total)}</span>
                <span className={`pizza-overview__pay-pill pizza-overview__pay-pill--${order.paymentStatus}`}>
                  {paymentLabel(order.paymentStatus)}
                </span>
              </div>
              <ul className="pizza-overview__lines">
                {order.lines.map((line) => {
                  const variant = findVariant(state.menu, line.variantId);
                  const item = variant ? findItem(state.menu, variant.itemId) : null;
                  return (
                    <li key={line.id}>
                      {line.qty}× {item?.number ? `${item.number} ` : ""}
                      {item?.name ?? "[entfernt]"}
                      {variant?.sizeLabel ? ` (${variant.sizeLabel})` : ""}
                      {line.customNote ? ` — ${line.customNote}` : ""}
                    </li>
                  );
                })}
              </ul>
              {isManager && (state.session?.state === "locked" || state.session?.state === "delivered") ? (
                <PaymentControls
                  orderId={order.id}
                  current={order.paymentStatus}
                  onChanged={onPaymentChanged}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function paymentLabel(status: PizzaOrderWithUser["paymentStatus"]): string {
  switch (status) {
    case "paid_paypal":
      return "PayPal bezahlt";
    case "paid_cash":
      return "Bar bezahlt";
    default:
      return "Offen";
  }
}

function PaymentControls({
  orderId,
  current,
  onChanged
}: {
  orderId: string;
  current: PizzaOrderWithUser["paymentStatus"];
  onChanged: () => Promise<void>;
}) {
  return (
    <div className="pizza-overview__pay-controls">
      <button
        type="button"
        className={current === "paid_paypal" ? "primary" : "secondary"}
        onClick={async () => {
          await markPizzaPayment(orderId, "paypal");
          await onChanged();
        }}
      >
        PayPal
      </button>
      <button
        type="button"
        className={current === "paid_cash" ? "primary" : "secondary"}
        onClick={async () => {
          await markPizzaPayment(orderId, "cash");
          await onChanged();
        }}
      >
        Bar
      </button>
      <button
        type="button"
        className="secondary"
        onClick={async () => {
          await markPizzaPayment(orderId, "unpaid");
          await onChanged();
        }}
      >
        Offen
      </button>
    </div>
  );
}
