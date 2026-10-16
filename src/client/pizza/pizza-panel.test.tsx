/* @vitest-environment jsdom */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { requestJson } from "../api/request";
import { I18nProvider } from "../i18n/I18nContext";
import { PizzaPanel } from "./PizzaPanel";
import { PizzaMenuEditor } from "./PizzaMenuEditor";
import { PizzaArchive } from "./PizzaArchive";
import { parseEuroToCents } from "./price";
import type { PizzaItem, PizzaOrderWithUser, PizzaPanelState } from "./types";

vi.mock("../api/request", () => ({ requestJson: vi.fn() }));

const requestJsonMock = vi.mocked(requestJson);

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

function mockApi(routes: Record<string, unknown | ((call: Call) => unknown)>) {
  requestJsonMock.mockImplementation(async (url: string, options?: RequestInit) => {
    const method = (options?.method ?? "GET").toUpperCase();
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    const call = { url, method, body };
    calls.push(call);
    const handler = routes[`${method} ${url}`];
    if (handler === undefined) return undefined;
    return typeof handler === "function" ? (handler as (call: Call) => unknown)(call) : handler;
  });
}

let mounted: { root: Root; container: HTMLElement } | null = null;

async function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<I18nProvider locale="de">{element}</I18nProvider>);
    await flushMicrotasks();
  });
  mounted = { root, container };
  return container;
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error("Element nicht gefunden");
  await act(async () => {
    (element as HTMLElement).click();
    await flushMicrotasks();
  });
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === text
  );
}

function byAriaLabel<T extends Element>(container: HTMLElement, label: string) {
  return container.querySelector<T>(`[aria-label="${label}"]`);
}

const menu: PizzaItem[] = [
  {
    id: "pi-001",
    number: "01",
    name: "Margherita",
    ingredients: null,
    allergens: null,
    category: "pizza",
    active: true,
    sortOrder: 1,
    variants: [
      { id: "v-001-30", itemId: "pi-001", sizeLabel: "30cm", priceCents: 700, sortOrder: 1, active: true }
    ]
  }
];

function order(overrides: Partial<PizzaOrderWithUser> = {}): PizzaOrderWithUser {
  return {
    id: "o1",
    sessionId: "s1",
    userId: "u1",
    paymentStatus: "unpaid",
    paymentMethod: null,
    paidAt: null,
    paidByAdminId: null,
    user: { username: "gast", displayName: "Gast" },
    lines: [
      {
        id: "l1",
        orderId: "o1",
        variantId: "v-001-30",
        qty: 2,
        priceCentsSnapshot: 700,
        customNote: null,
        createdAt: "2026-10-01T18:00:00.000Z",
        itemNumber: "01",
        itemName: "Margherita",
        sizeLabel: "30cm"
      }
    ],
    ...overrides
  };
}

function panelState(overrides: Partial<PizzaPanelState> = {}): PizzaPanelState {
  const own = order();
  return {
    session: {
      id: "s1",
      state: "locked",
      label: null,
      openedAt: "2026-10-01T18:00:00.000Z",
      lockedAt: null,
      deliveredAt: null
    },
    menu,
    paymentMethods: ["cash", "paypal"],
    myOrder: own,
    orders: [own],
    guestTotals: [{ userId: "u1", totalCents: 1400 }],
    ...overrides
  };
}

const panelProps = {
  currentUserId: "u1",
  paypalHandle: "lanpizza",
  paypalName: "Rene",
  cashRecipient: "Kasse am Eingang"
};

beforeEach(() => {
  calls = [];
  requestJsonMock.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(async () => {
  if (mounted) {
    const { root, container } = mounted;
    await act(async () => {
      root.unmount();
      await flushMicrotasks();
    });
    container.remove();
    mounted = null;
  }
  vi.restoreAllMocks();
});

describe("PizzaPanel – Bezahlart", () => {
  it("lässt Gäste zwischen Bargeld und PayPal wählen", async () => {
    mockApi({ "GET /api/pizza/state": panelState() });
    const container = await render(<PizzaPanel {...panelProps} currentUserRole="user" />);

    const radios = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[name="pizza-payment-method"]')
    );
    expect(radios.map((radio) => radio.value)).toEqual(["cash", "paypal"]);
    expect(container.textContent).toContain("Bezahlart: noch nicht gewählt");

    await click(radios[0]);
    expect(calls).toContainEqual({
      url: "/api/pizza/orders/mine/payment-method",
      method: "POST",
      body: { method: "cash" }
    });
    // Manager-Steuerung ist für normale User nicht sichtbar
    expect(buttonByText(container, "Menü verwalten")).toBeUndefined();
    expect(buttonByText(container, "Runde archivieren")).toBeUndefined();
  });

  it("zeigt bei nur Bargeld keinen PayPal-Link und keine Auswahl", async () => {
    const own = order({ paymentMethod: "cash" });
    mockApi({
      "GET /api/pizza/state": panelState({ paymentMethods: ["cash"], myOrder: own, orders: [own] })
    });
    const container = await render(<PizzaPanel {...panelProps} currentUserRole="user" />);

    expect(container.querySelector('input[name="pizza-payment-method"]')).toBeNull();
    expect(container.textContent).toContain("Bezahlart: Bargeld");
    expect(container.textContent).toContain("Bargeld an: Kasse am Eingang");
    expect(container.querySelector('a[href^="https://www.paypal.me/"]')).toBeNull();
  });

  it("zeigt bei gewähltem PayPal den PayPal-Link mit Betrag", async () => {
    const own = order({ paymentMethod: "paypal" });
    mockApi({ "GET /api/pizza/state": panelState({ myOrder: own, orders: [own] }) });
    const container = await render(<PizzaPanel {...panelProps} currentUserRole="user" />);

    const link = container.querySelector<HTMLAnchorElement>('a[href^="https://www.paypal.me/"]');
    expect(link?.getAttribute("href")).toBe("https://www.paypal.me/lanpizza/14.00EUR");
    expect(container.textContent).not.toContain("Bargeld an:");
  });
});

describe("PizzaPanel – Manager", () => {
  it("bietet in gelieferter Runde Archivieren und Neue Runde an", async () => {
    const delivered = panelState();
    delivered.session = { ...delivered.session!, state: "delivered" };
    mockApi({ "GET /api/pizza/state": delivered });
    const container = await render(<PizzaPanel {...panelProps} currentUserRole="manager" />);

    expect(buttonByText(container, "Neue Runde starten")).toBeDefined();
    expect(container.textContent).toContain("Bezahlart: noch nicht gewählt");

    await click(buttonByText(container, "Runde archivieren"));
    expect(window.confirm).toHaveBeenCalled();
    expect(calls).toContainEqual({
      url: "/api/pizza/sessions/s1/archive",
      method: "POST",
      body: {}
    });

    await click(buttonByText(container, "Neue Runde starten"));
    expect(calls).toContainEqual({
      url: "/api/pizza/transitions",
      method: "POST",
      body: { transition: "open" }
    });
  });

  it("archiviert nicht, wenn die Bestätigung abgelehnt wird", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    mockApi({ "GET /api/pizza/state": panelState() });
    const container = await render(<PizzaPanel {...panelProps} currentUserRole="admin" />);
    await click(buttonByText(container, "Runde archivieren"));
    expect(calls.some((call) => call.url.endsWith("/archive"))).toBe(false);
  });

  it("markiert Zahlungen als bar bezahlt", async () => {
    mockApi({ "GET /api/pizza/state": panelState() });
    const container = await render(<PizzaPanel {...panelProps} currentUserRole="manager" />);
    const group = byAriaLabel<HTMLElement>(container, "Zahlung für Gast");
    await click(Array.from(group!.querySelectorAll("button")).find((b) => b.textContent === "Bar"));
    expect(calls).toContainEqual({
      url: "/api/pizza/orders/o1/payment",
      method: "POST",
      body: { method: "cash" }
    });
  });

  it("öffnet die Menüverwaltung und das Archiv", async () => {
    mockApi({
      "GET /api/pizza/state": panelState({ session: null, myOrder: null, orders: [], guestTotals: [] }),
      "GET /api/pizza/admin/menu": { items: menu },
      "GET /api/pizza/sessions/archived": { sessions: [] }
    });
    const container = await render(<PizzaPanel {...panelProps} currentUserRole="manager" />);
    expect(buttonByText(container, "Runde archivieren")).toBeUndefined();

    await click(buttonByText(container, "Menü verwalten"));
    expect(container.querySelector('[aria-label="Pizza-Menü verwalten"]')).not.toBeNull();
    expect(container.textContent).toContain("1 von 1 Artikeln");

    await click(buttonByText(container, "Archiv anzeigen"));
    expect(container.textContent).toContain("Noch keine archivierten Runden.");
  });
});

describe("PizzaMenuEditor", () => {
  it("ändert Preise und meldet Deaktivieren statt Löschen", async () => {
    mockApi({
      "GET /api/pizza/admin/menu": { items: menu },
      "POST /api/pizza/admin/variants": { id: "v-001-30" },
      "DELETE /api/pizza/admin/variants/v-001-30": { result: "deactivated" }
    });
    const onChanged = vi.fn();
    const container = await render(<PizzaMenuEditor onChanged={onChanged} />);

    await click(byAriaLabel(container, "Bearbeiten: Margherita"));
    const price = byAriaLabel<HTMLInputElement>(container, "Preis in €: Margherita 30cm")!;
    expect(price.value).toBe("7,00");
    await act(async () => {
      setValue(price, "9,50");
      await flushMicrotasks();
    });
    await click(byAriaLabel(container, "Speichern: Margherita 30cm"));
    expect(calls).toContainEqual({
      url: "/api/pizza/admin/variants",
      method: "POST",
      body: { id: "v-001-30", itemId: "pi-001", sizeLabel: "30cm", priceCents: 950 }
    });
    expect(onChanged).toHaveBeenCalled();

    await click(byAriaLabel(container, "Entfernen: Margherita 30cm"));
    expect(container.textContent).toContain("Wurde schon bestellt – deaktiviert statt gelöscht.");
  });

  it("lehnt ungültige Preise ab und legt neue Artikel an", async () => {
    mockApi({
      "GET /api/pizza/admin/menu": { items: menu },
      "POST /api/pizza/admin/items": { id: "neu" }
    });
    const container = await render(<PizzaMenuEditor />);

    await click(byAriaLabel(container, "Bearbeiten: Margherita"));
    const newPrice = byAriaLabel<HTMLInputElement>(
      container,
      "Variante hinzufügen Preis in €: Margherita"
    )!;
    await act(async () => {
      setValue(newPrice, "abc");
      await flushMicrotasks();
    });
    await click(buttonByText(container, "Variante hinzufügen"));
    expect(container.textContent).toContain("Bitte einen gültigen Preis eingeben");
    expect(calls.some((call) => call.url === "/api/pizza/admin/variants")).toBe(false);

    await click(buttonByText(container, "Neuer Artikel"));
    const form = container.querySelector<HTMLFormElement>(".pizza-menu-editor__form")!;
    const nameInput = Array.from(form.querySelectorAll("label")).find((label) =>
      label.textContent?.startsWith("Name")
    )!.querySelector("input")!;
    await act(async () => {
      setValue(nameInput, "Hausspezial");
      await flushMicrotasks();
    });
    await click(buttonByText(container, "Artikel anlegen"));
    expect(calls).toContainEqual(
      expect.objectContaining({
        url: "/api/pizza/admin/items",
        method: "POST",
        body: expect.objectContaining({ name: "Hausspezial", category: "pizza" })
      })
    );
  });
});

describe("PizzaArchive", () => {
  it("listet archivierte Runden und löscht nach Bestätigung", async () => {
    mockApi({
      "GET /api/pizza/sessions/archived": {
        sessions: [
          {
            id: "alt",
            state: "delivered",
            label: "Mai-LAN",
            createdAt: "2026-05-01T18:00:00.000Z",
            openedAt: "2026-05-01T18:00:00.000Z",
            deliveredAt: "2026-05-01T20:00:00.000Z",
            archivedAt: "2026-05-02T10:00:00.000Z",
            orderCount: 4,
            unpaidCount: 1,
            totalCents: 4200
          }
        ]
      }
    });
    const container = await render(<PizzaArchive />);

    expect(container.textContent).toContain("Mai-LAN");
    expect(container.textContent).toContain("4 Bestellungen");
    const pdf = container.querySelector<HTMLAnchorElement>('a[href*="kassenliste.pdf"]');
    expect(pdf?.getAttribute("href")).toBe("/api/pizza/print/kassenliste.pdf?sessionId=alt");

    await click(buttonByText(container, "Endgültig löschen"));
    expect(window.confirm).toHaveBeenCalled();
    expect(calls).toContainEqual({ url: "/api/pizza/sessions/alt", method: "DELETE", body: undefined });
  });
});

describe("parseEuroToCents", () => {
  it("parst deutsche und englische Schreibweisen", () => {
    expect(parseEuroToCents("9,50")).toBe(950);
    expect(parseEuroToCents("9.5")).toBe(950);
    expect(parseEuroToCents("12")).toBe(1200);
    expect(parseEuroToCents(" 7,00 € ")).toBe(700);
  });

  it("lehnt ungültige Werte ab", () => {
    expect(parseEuroToCents("")).toBeNull();
    expect(parseEuroToCents("-1")).toBeNull();
    expect(parseEuroToCents("abc")).toBeNull();
    expect(parseEuroToCents("1,234")).toBeNull();
    expect(parseEuroToCents("5000")).toBeNull();
  });
});
