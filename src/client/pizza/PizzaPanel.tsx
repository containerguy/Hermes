import { useEffect, useMemo, useState } from "react";
import { getErrorMessage } from "../errors/errors";
import { useI18n, type TFunction } from "../i18n/I18nContext";
import {
  addPizzaLine,
  archivePizzaSession,
  choosePizzaPaymentMethod,
  deletePizzaLine,
  fetchPizzaState,
  markPizzaPayment,
  transitionPizzaSession,
  updatePizzaLine
} from "./api";
import { PizzaArchive } from "./PizzaArchive";
import { PizzaMenuEditor } from "./PizzaMenuEditor";
import { formatEuro } from "./price";
import type {
  PizzaItem,
  PizzaOrder,
  PizzaOrderLine,
  PizzaOrderWithUser,
  PizzaPanelState,
  PizzaPaymentMethod,
  PizzaSessionState,
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

function buildPaypalUrl(handle: string, cents: number): string | null {
  const trimmed = handle.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?paypal\.me\//i, "");
  if (!trimmed) return null;
  return `https://www.paypal.me/${encodeURIComponent(trimmed)}/${(cents / 100).toFixed(2)}EUR`;
}

function orderTotal(order: PizzaOrder | null): number {
  if (!order) return 0;
  return order.lines.reduce((sum, line) => sum + line.qty * line.priceCentsSnapshot, 0);
}

function methodLabel(t: TFunction, method: PizzaPaymentMethod | null): string {
  if (method === "cash") return t("pizza.payment.cash");
  if (method === "paypal") return t("pizza.payment.paypal");
  return t("pizza.payment.notChosen");
}

/**
 * Bezahlart, die für die Anzeige gilt: die gewählte, oder die einzig angebotene.
 */
function effectiveMethod(order: PizzaOrder, offered: PizzaPaymentMethod[]): PizzaPaymentMethod | null {
  if (order.paymentMethod) return order.paymentMethod;
  return offered.length === 1 ? offered[0] : null;
}

export function PizzaPanel({
  currentUserId,
  currentUserRole,
  paypalHandle,
  paypalName,
  cashRecipient
}: PizzaPanelProps) {
  const { t, locale } = useI18n();
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
      setError(getErrorMessage(err, locale));
    } finally {
      setLoading(false);
    }
  }

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await reload();
    } catch (err) {
      setError(getErrorMessage(err, locale));
    }
  }

  useEffect(() => {
    void reload();
    const onRefresh = () => void reload();
    window.addEventListener("hermes:events-refresh", onRefresh);
    return () => window.removeEventListener("hermes:events-refresh", onRefresh);
  }, []);

  const isManager = currentUserRole === "admin" || currentUserRole === "manager";
  const myTotalCents = useMemo(() => orderTotal(state?.myOrder ?? null), [state]);

  if (loading) return <p className="muted pizza-loading">{t("pizza.panel.loading")}</p>;
  if (!state) return null;

  const session = state.session;
  const sessionState: PizzaSessionState = session?.state ?? "draft";
  const offered = state.paymentMethods ?? ["cash"];

  if (!isManager && sessionState === "draft") {
    return null;
  }

  return (
    <section className="pizza-panel" aria-label={t("pizza.panel.aria")}>
      <header className="pizza-panel__header">
        <h3>
          {session?.label
            ? t("pizza.panel.titleWithLabel", { label: session.label })
            : t("pizza.panel.title")}
        </h3>
        <span className={`pizza-panel__pill pizza-panel__pill--${sessionState}`}>
          {t(`pizza.state.${sessionState}`)}
        </span>
      </header>

      {error ? (
        <p className="pizza-panel__error" role="alert">
          {error}
        </p>
      ) : null}

      {isManager ? (
        <PizzaManagerControls
          state={state}
          onTransition={(transition) => run(() => transitionPizzaSession(transition))}
          onArchive={(sessionId) => run(() => archivePizzaSession(sessionId))}
          onMenuChanged={reload}
        />
      ) : null}

      {sessionState === "open" ? (
        <PizzaOrderEditor
          state={state}
          showMenu={showMenu}
          onToggleMenu={() => setShowMenu((v) => !v)}
          run={run}
        />
      ) : null}

      {state.myOrder && state.myOrder.lines.length > 0 && state.myOrder.paymentStatus === "unpaid" ? (
        <PaymentMethodPicker
          offered={offered}
          value={state.myOrder.paymentMethod}
          onChange={(method) => run(() => choosePizzaPaymentMethod(method))}
        />
      ) : null}

      {(sessionState === "locked" || sessionState === "delivered") && state.myOrder ? (
        <MyShareView
          order={state.myOrder}
          menu={state.menu}
          offered={offered}
          totalCents={myTotalCents}
          paypalHandle={paypalHandle}
          paypalName={paypalName}
          cashRecipient={cashRecipient}
        />
      ) : null}

      {session && sessionState !== "draft" ? (
        <AllOrdersOverview
          state={state}
          isManager={isManager}
          run={run}
          currentUserId={currentUserId}
        />
      ) : null}
    </section>
  );
}

interface ManagerControlsProps {
  state: PizzaPanelState;
  onTransition: (transition: PizzaSessionTransition) => Promise<void>;
  onArchive: (sessionId: string) => Promise<void>;
  onMenuChanged: () => Promise<void>;
}

function PizzaManagerControls({ state, onTransition, onArchive, onMenuChanged }: ManagerControlsProps) {
  const { t } = useI18n();
  const [panel, setPanel] = useState<"none" | "menu" | "archive">("none");
  const session = state.session;
  const sessionState = session?.state ?? "draft";

  function confirmArchive() {
    if (!session) return;
    const message =
      sessionState === "delivered" || sessionState === "draft"
        ? t("pizza.admin.archiveConfirm")
        : t("pizza.admin.archiveConfirmActive");
    if (!window.confirm(message)) return;
    void onArchive(session.id);
  }

  return (
    <>
      <div className="pizza-panel__admin">
        {sessionState === "draft" ? (
          <button type="button" className="primary" onClick={() => onTransition("open")}>
            {t("pizza.admin.open")}
          </button>
        ) : null}
        {sessionState === "open" ? (
          <button type="button" className="primary" onClick={() => onTransition("lock")}>
            {t("pizza.admin.lock")}
          </button>
        ) : null}
        {sessionState === "locked" ? (
          <>
            <button type="button" className="secondary" onClick={() => onTransition("reopen")}>
              {t("pizza.admin.reopen")}
            </button>
            <button type="button" className="primary" onClick={() => onTransition("deliver")}>
              {t("pizza.admin.deliver")}
            </button>
            <a
              className="secondary pizza-panel__pdf-link"
              href={`/api/pizza/print/pizzeria.pdf`}
              target="_blank"
              rel="noreferrer"
            >
              {t("pizza.admin.pdfPizzeria")}
            </a>
          </>
        ) : null}
        {sessionState === "locked" || sessionState === "delivered" ? (
          <a
            className="secondary pizza-panel__pdf-link"
            href={`/api/pizza/print/kassenliste.pdf`}
            target="_blank"
            rel="noreferrer"
          >
            {t("pizza.admin.pdfKasse")}
          </a>
        ) : null}
        {sessionState === "delivered" ? (
          <button type="button" className="primary" onClick={() => onTransition("open")}>
            {t("pizza.admin.newRound")}
          </button>
        ) : null}
        {session ? (
          <button type="button" className="secondary" onClick={confirmArchive}>
            {t("pizza.admin.archive")}
          </button>
        ) : null}
        <button
          type="button"
          className="secondary"
          aria-expanded={panel === "menu"}
          onClick={() => setPanel((current) => (current === "menu" ? "none" : "menu"))}
        >
          {panel === "menu" ? t("pizza.admin.hideMenuEditor") : t("pizza.admin.manageMenu")}
        </button>
        <button
          type="button"
          className="secondary"
          aria-expanded={panel === "archive"}
          onClick={() => setPanel((current) => (current === "archive" ? "none" : "archive"))}
        >
          {panel === "archive" ? t("pizza.admin.hideArchive") : t("pizza.admin.showArchive")}
        </button>
      </div>
      {panel === "menu" ? <PizzaMenuEditor onChanged={onMenuChanged} /> : null}
      {panel === "archive" ? <PizzaArchive /> : null}
    </>
  );
}

function PaymentMethodPicker({
  offered,
  value,
  onChange
}: {
  offered: PizzaPaymentMethod[];
  value: PizzaPaymentMethod | null;
  onChange: (method: PizzaPaymentMethod) => Promise<void>;
}) {
  const { t } = useI18n();
  if (offered.length <= 1) {
    return (
      <p className="muted pizza-payment-picker__only">
        {t("pizza.payment.only", { method: methodLabel(t, offered[0] ?? "cash") })}
      </p>
    );
  }
  return (
    <fieldset className="pizza-payment-picker">
      <legend>{t("pizza.payment.legend")}</legend>
      {offered.map((method) => (
        <label key={method} className="pizza-payment-picker__option">
          <input
            type="radio"
            name="pizza-payment-method"
            value={method}
            checked={value === method}
            onChange={() => void onChange(method)}
          />
          {methodLabel(t, method)}
        </label>
      ))}
    </fieldset>
  );
}

interface OrderEditorProps {
  state: PizzaPanelState;
  showMenu: boolean;
  onToggleMenu: () => void;
  run: (action: () => Promise<unknown>) => Promise<void>;
}

function PizzaOrderEditor({ state, showMenu, onToggleMenu, run }: OrderEditorProps) {
  const { t } = useI18n();
  const myLines = state.myOrder?.lines ?? [];
  const myTotal = orderTotal(state.myOrder);
  const remaining = 3 - myLines.length;

  return (
    <div className="pizza-panel__editor">
      <h4>{t("pizza.editor.title")}</h4>
      {myLines.length === 0 ? (
        <p className="muted">{t("pizza.editor.empty")}</p>
      ) : (
        <ul className="pizza-line-list">
          {myLines.map((line) => (
            <li key={line.id} className="pizza-line">
              <div className="pizza-line__main">
                <span className="pizza-line__name">{lineTitle(t, state.menu, line, true)}</span>
                <span className="pizza-line__price">
                  {formatEuro(line.qty * line.priceCentsSnapshot)}
                </span>
              </div>
              <div className="pizza-line__controls">
                <label>
                  {t("pizza.editor.qty")}
                  <select
                    value={line.qty}
                    onChange={(ev) =>
                      void run(() => updatePizzaLine(line.id, { qty: Number(ev.target.value) }))
                    }
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
                  placeholder={t("pizza.editor.notePlaceholder")}
                  aria-label={t("pizza.editor.notePlaceholder")}
                  defaultValue={line.customNote ?? ""}
                  maxLength={200}
                  onBlur={(ev) => {
                    const value = ev.target.value;
                    if (value === (line.customNote ?? "")) return;
                    void run(() => updatePizzaLine(line.id, { customNote: value }));
                  }}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void run(() => deletePizzaLine(line.id))}
                >
                  {t("pizza.editor.remove")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="pizza-line-list__total">
        {t("pizza.editor.subtotal")} <strong>{formatEuro(myTotal)}</strong>
      </p>

      <div className="pizza-menu-toggle">
        <button type="button" className="secondary" onClick={onToggleMenu} disabled={remaining === 0}>
          {showMenu
            ? t("pizza.editor.hideMenu")
            : remaining === 0
              ? t("pizza.editor.maxReached")
              : t("pizza.editor.openMenu", { count: remaining })}
        </button>
      </div>

      {showMenu && remaining > 0 ? (
        <PizzaMenuBrowser
          menu={state.menu}
          onAdd={(variantId) => run(() => addPizzaLine({ variantId, qty: 1 }))}
        />
      ) : null}
    </div>
  );
}

function PizzaMenuBrowser({
  menu,
  onAdd
}: {
  menu: PizzaItem[];
  onAdd: (variantId: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const pizzas = menu.filter((item) => item.category === "pizza");
  const pasta = menu.filter((item) => item.category === "pasta");
  return (
    <div className="pizza-menu-browser">
      {pizzas.length > 0 ? (
        <details open>
          <summary>{t("pizza.menu.pizza", { count: pizzas.length })}</summary>
          <PizzaMenuList items={pizzas} onAdd={onAdd} />
        </details>
      ) : null}
      {pasta.length > 0 ? (
        <details>
          <summary>{t("pizza.menu.pasta", { count: pasta.length })}</summary>
          <PizzaMenuList items={pasta} onAdd={onAdd} />
        </details>
      ) : null}
    </div>
  );
}

function PizzaMenuList({
  items,
  onAdd
}: {
  items: PizzaItem[];
  onAdd: (variantId: string) => Promise<void>;
}) {
  const { t } = useI18n();
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
                onClick={() => void onAdd(variant.id)}
              >
                {variant.sizeLabel ?? t("pizza.menu.standardSize")} · {formatEuro(variant.priceCents)}
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

/**
 * Bezeichnung einer Bestellzeile. Der Server liefert Name/Größe mit, damit auch deaktivierte
 * Artikel lesbar bleiben; das Menü dient nur als Rückfall.
 */
function lineTitle(t: TFunction, menu: PizzaItem[], line: PizzaOrderLine, withNumber: boolean) {
  const variant = findVariant(menu, line.variantId);
  const item = variant ? findItem(menu, variant.itemId) : null;
  const name = line.itemName ?? item?.name ?? t("pizza.line.removed");
  const number = line.itemNumber !== undefined ? line.itemNumber : (item?.number ?? null);
  const size = line.sizeLabel !== undefined ? line.sizeLabel : (variant?.sizeLabel ?? null);
  return `${withNumber && number ? `${number} ` : ""}${name}${size ? ` (${size})` : ""}`;
}

interface MyShareProps {
  order: PizzaOrder;
  menu: PizzaItem[];
  offered: PizzaPaymentMethod[];
  totalCents: number;
  paypalHandle: string;
  paypalName: string;
  cashRecipient: string;
}

function MyShareView({
  order,
  menu,
  offered,
  totalCents,
  paypalHandle,
  paypalName,
  cashRecipient
}: MyShareProps) {
  const { t } = useI18n();
  const method = effectiveMethod(order, offered);
  const paypalUrl =
    offered.includes("paypal") && method !== "cash" ? buildPaypalUrl(paypalHandle, totalCents) : null;
  const showCash = offered.includes("cash") && method !== "paypal";
  const amount = formatEuro(totalCents);
  return (
    <div className="pizza-my-share">
      <h4>{t("pizza.share.title")}</h4>
      <ul className="pizza-line-list pizza-line-list--readonly">
        {order.lines.map((line) => (
          <li key={line.id} className="pizza-line">
            <span>
              {line.qty}× {lineTitle(t, menu, line, false)}
              {line.customNote ? ` — ${line.customNote}` : ""}
            </span>
            <span>{formatEuro(line.qty * line.priceCentsSnapshot)}</span>
          </li>
        ))}
      </ul>
      <p className="pizza-my-share__total">
        {t("pizza.share.total")} <strong>{amount}</strong>
      </p>
      <p className="pizza-my-share__status">
        {t("pizza.share.status")}{" "}
        {order.paymentStatus === "unpaid"
          ? t("pizza.share.statusUnpaid")
          : order.paymentStatus === "paid_paypal"
            ? t("pizza.share.statusPaypal")
            : t("pizza.share.statusCash")}
      </p>
      {order.paymentStatus === "unpaid" ? (
        <div className="pizza-my-share__pay">
          {paypalUrl ? (
            <a className="primary" href={paypalUrl} target="_blank" rel="noreferrer">
              {paypalName
                ? t("pizza.share.payPaypalTo", { name: paypalName, amount })
                : t("pizza.share.payPaypal", { amount })}
            </a>
          ) : null}
          {showCash ? (
            <p className="muted">
              {cashRecipient
                ? t("pizza.share.cashTo", { name: cashRecipient })
                : t("pizza.share.cashHint", { amount })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface OverviewProps {
  state: PizzaPanelState;
  isManager: boolean;
  run: (action: () => Promise<unknown>) => Promise<void>;
  currentUserId: string;
}

function AllOrdersOverview({ state, isManager, run, currentUserId }: OverviewProps) {
  const { t } = useI18n();
  if (state.orders.length === 0) {
    return <p className="muted pizza-overview__empty">{t("pizza.overview.empty")}</p>;
  }
  const offered = state.paymentMethods ?? ["cash"];
  const totalsByUser = new Map(state.guestTotals.map((g) => [g.userId, g.totalCents]));
  const canMark = state.session?.state === "locked" || state.session?.state === "delivered";
  return (
    <div className="pizza-overview">
      <h4>{t("pizza.overview.title", { count: state.orders.length })}</h4>
      <ul className="pizza-overview__list">
        {state.orders.map((order) => {
          const total = totalsByUser.get(order.userId) ?? 0;
          const isMe = order.userId === currentUserId;
          const name = order.user.displayName ?? order.user.username;
          return (
            <li key={order.id} className="pizza-overview__guest">
              <div className="pizza-overview__guest-head">
                <strong>
                  {name}
                  {isMe ? t("pizza.overview.you") : ""}
                </strong>
                <span>{formatEuro(total)}</span>
                <span className="pizza-overview__method">
                  {t("pizza.overview.method", {
                    method: methodLabel(t, effectiveMethod(order, offered))
                  })}
                </span>
                <span className={`pizza-overview__pay-pill pizza-overview__pay-pill--${order.paymentStatus}`}>
                  {paymentLabel(t, order.paymentStatus)}
                </span>
              </div>
              <ul className="pizza-overview__lines">
                {order.lines.map((line) => (
                  <li key={line.id}>
                    {line.qty}× {lineTitle(t, state.menu, line, true)}
                    {line.customNote ? ` — ${line.customNote}` : ""}
                  </li>
                ))}
              </ul>
              {isManager && canMark ? (
                <PaymentControls
                  name={name}
                  current={order.paymentStatus}
                  onMark={(method) => run(() => markPizzaPayment(order.id, method))}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function paymentLabel(t: TFunction, status: PizzaOrderWithUser["paymentStatus"]): string {
  switch (status) {
    case "paid_paypal":
      return t("pizza.overview.paidPaypal");
    case "paid_cash":
      return t("pizza.overview.paidCash");
    default:
      return t("pizza.overview.unpaid");
  }
}

function PaymentControls({
  name,
  current,
  onMark
}: {
  name: string;
  current: PizzaOrderWithUser["paymentStatus"];
  onMark: (method: "paypal" | "cash" | "unpaid") => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <div
      className="pizza-overview__pay-controls"
      role="group"
      aria-label={t("pizza.overview.markAria", { name })}
    >
      <button
        type="button"
        className={current === "paid_cash" ? "primary" : "secondary"}
        aria-pressed={current === "paid_cash"}
        onClick={() => void onMark("cash")}
      >
        {t("pizza.overview.markCash")}
      </button>
      <button
        type="button"
        className={current === "paid_paypal" ? "primary" : "secondary"}
        aria-pressed={current === "paid_paypal"}
        onClick={() => void onMark("paypal")}
      >
        {t("pizza.overview.markPaypal")}
      </button>
      <button
        type="button"
        className="secondary"
        aria-pressed={current === "unpaid"}
        onClick={() => void onMark("unpaid")}
      >
        {t("pizza.overview.markUnpaid")}
      </button>
    </div>
  );
}
