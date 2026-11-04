import { describe, expect, it } from "vitest";
import type { AppSettings, User } from "../types/core";
import { appPages } from "./modules";
import { menuPages, parseHash, resolvePage, type NavContext } from "./registry";

const settings = {
  featuresPizzaEnabled: false,
  featuresGamePresenceEnabled: false,
  infosEnabled: false,
  shellStartTitle: "",
  shellStartDescription: ""
} as unknown as AppSettings;

function user(role: User["role"]): User {
  return { id: "u-1", username: "anna", role } as unknown as User;
}

function ctx(overrides: Partial<NavContext> = {}): NavContext {
  return { currentUser: user("user"), settings, ...overrides };
}

describe("navigation registry", () => {
  it("splits hash into page and sub path, ignoring the query", () => {
    expect(parseHash("#admin/design?x=1")).toEqual({ head: "admin", subPath: "design" });
    expect(parseHash("#login?pair=abc")).toEqual({ head: "login", subPath: "" });
    expect(parseHash("")).toEqual({ head: "", subPath: "" });
  });

  it("orders the menu as Runden, Events, Pizza, Infos, Admin", () => {
    const admin = ctx({
      currentUser: user("admin"),
      settings: { ...settings, featuresPizzaEnabled: true, infosEnabled: true }
    });
    expect(menuPages(appPages, admin).map((page) => page.id)).toEqual(["events", "main-events", "pizza", "infos", "admin"]);
  });

  it("hides modules that are switched off and admin for non-admins", () => {
    expect(menuPages(appPages, ctx()).map((page) => page.id)).toEqual(["events", "main-events"]);
    expect(menuPages(appPages, ctx({ currentUser: null })).map((page) => page.id)).toEqual(["events"]);
  });

  it("falls back to the rounds board for unknown or disabled pages", () => {
    expect(resolvePage(appPages, ctx(), "#pizza").page.id).toBe("events");
    expect(resolvePage(appPages, ctx(), "#gibtsnicht").page.id).toBe("events");
    expect(resolvePage(appPages, ctx(), "#manager").page.id).toBe("events");
    const withPizza = ctx({ settings: { ...settings, featuresPizzaEnabled: true } });
    expect(resolvePage(appPages, withPizza, "#pizza").page.id).toBe("pizza");
  });

  it("keeps the sub path for admin and profile sections", () => {
    expect(resolvePage(appPages, ctx({ currentUser: user("admin") }), "#admin/audit")).toMatchObject({
      subPath: "audit"
    });
    expect(resolvePage(appPages, ctx(), "#login/geraete").page.id).toBe("login");
  });

  it("offers the admin sub menu only to admins and the profile sub menu only when logged in", () => {
    const t = ((key: string) => key) as never;
    const adminPage = appPages.find((page) => page.id === "admin")!;
    expect(adminPage.subnav!(t, ctx()).length).toBe(0);
    expect(adminPage.subnav!(t, ctx({ currentUser: user("admin") })).map((entry) => entry.slug)).toContain("audit");
    const profilePage = appPages.find((page) => page.id === "login")!;
    expect(profilePage.subnav!(t, ctx({ currentUser: null }))).toEqual([]);
    expect(profilePage.subnav!(t, ctx()).map((entry) => entry.slug)).toEqual([
      "konto",
      "benachrichtigungen",
      "geraete",
      "tokens"
    ]);
  });

  it("resolves module pages with multi-part hashes, longest match first", () => {
    const base = appPages[0];
    const moduleStart = { ...base, id: "m-demo", hash: "m/demo" };
    const moduleAdmin = { ...base, id: "m-demo-verwaltung", hash: "m/demo/verwaltung" };
    const pages = [...appPages, moduleStart, moduleAdmin];
    expect(resolvePage(pages, ctx(), "#m/demo")).toEqual({ page: moduleStart, subPath: "" });
    expect(resolvePage(pages, ctx(), "#m/demo/liste/7")).toEqual({ page: moduleStart, subPath: "liste/7" });
    expect(resolvePage(pages, ctx(), "#m/demo/verwaltung/x")).toEqual({ page: moduleAdmin, subPath: "x" });
    expect(resolvePage(pages, ctx(), "#m/demox").page.id).toBe("events");
    expect(resolvePage(pages, ctx(), "#m/andere").page.id).toBe("events");
  });
});
