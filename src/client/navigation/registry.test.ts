import { describe, expect, it } from "vitest";
import type { AppSettings, User } from "../types/core";
import type { RuntimeModuleInfo } from "../modules/types";
import { appPages } from "./modules";
import { menuPages, parseHash, resolvePage, type NavContext } from "./registry";

function moduleInfo(id: string, name: string, menu: RuntimeModuleInfo["menu"]): RuntimeModuleInfo {
  return {
    id,
    version: "1.0.0",
    name,
    clientUrl: `/modules/${id}/1.0.0/client.mjs`,
    adminPage: false,
    permissions: [],
    menu,
    i18n: { de: {}, en: {} }
  };
}

const settings = {
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

  it("orders the menu as Runden, Events, Admin without a separate Infos entry", () => {
    const admin = ctx({
      currentUser: user("admin"),
      settings: { ...settings, infosEnabled: true }
    });
    expect(menuPages(appPages, admin).map((page) => page.id)).toEqual(["events", "main-events", "admin"]);
  });

  it("redirects #infos to the Event sub-page, unaffected by infosEnabled", () => {
    expect(resolvePage(appPages, ctx(), "#main-events/infos").page.id).toBe("infos");
    expect(resolvePage(appPages, ctx({ settings: { ...settings, infosEnabled: true } }), "#main-events/infos").page.id).toBe(
      "infos"
    );
  });

  it("hides modules that are switched off and admin for non-admins", () => {
    expect(menuPages(appPages, ctx()).map((page) => page.id)).toEqual(["events", "main-events"]);
    expect(menuPages(appPages, ctx({ currentUser: null })).map((page) => page.id)).toEqual(["events"]);
  });

  it("falls back to the rounds board for unknown or disabled pages", () => {
    expect(resolvePage(appPages, ctx(), "#pizza").page.id).toBe("events");
    expect(resolvePage(appPages, ctx(), "#gibtsnicht").page.id).toBe("events");
    expect(resolvePage(appPages, ctx(), "#manager").page.id).toBe("events");
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

  it("puts profile sections of active modules right after the account section", () => {
    const t = ((key: string) => key) as never;
    const profilePage = appPages.find((page) => page.id === "login")!;
    const presence = {
      id: "presence",
      version: "1.0.0",
      name: "Spielt gerade",
      clientUrl: "/modules/presence/1.0.0/client.mjs",
      adminPage: false,
      profile: { label: "Spielkonten", order: 10 },
      startNotice: true,
      permissions: [],
      menu: [],
      i18n: { de: {}, en: {} }
    };
    const entries = profilePage.subnav!(t, ctx({ runtimeModules: [presence] }));
    expect(entries.map((entry) => entry.slug)).toEqual(["konto", "m-presence", "benachrichtigungen", "geraete", "tokens"]);
    expect(entries[1].label).toBe("Spielkonten");
    // Ohne Client-Teil gibt es keinen Profilbereich.
    expect(profilePage.subnav!(t, ctx({ runtimeModules: [{ ...presence, clientUrl: null }] })).map((entry) => entry.slug)).not.toContain(
      "m-presence"
    );
  });

  it("resolves pages with multi-part hashes, longest match first", () => {
    // Präfix bewusst nicht „m" (reserviert als Alias der Sammelseite „Mitmachen", siehe unten).
    const base = appPages[0];
    const moduleStart = { ...base, id: "x-demo", hash: "x/demo" };
    const moduleAdmin = { ...base, id: "x-demo-verwaltung", hash: "x/demo/verwaltung" };
    const pages = [...appPages, moduleStart, moduleAdmin];
    expect(resolvePage(pages, ctx(), "#x/demo")).toEqual({ page: moduleStart, subPath: "" });
    expect(resolvePage(pages, ctx(), "#x/demo/liste/7")).toEqual({ page: moduleStart, subPath: "liste/7" });
    expect(resolvePage(pages, ctx(), "#x/demo/verwaltung/x")).toEqual({ page: moduleAdmin, subPath: "x" });
    expect(resolvePage(pages, ctx(), "#x/demox").page.id).toBe("events");
    expect(resolvePage(pages, ctx(), "#x/andere").page.id).toBe("events");
  });

  it("hat mit 7 aktiven Modulen genauso viele Hauptmenüpunkte wie mit 1 (B4: Hauptmenü unabhängig von der Zahl der Module)", () => {
    const oneModule = [moduleInfo("mod-0", "Modul 0", [{ path: "", label: "Modul 0", icon: null, order: 50 }])];
    const sevenModules = Array.from({ length: 7 }, (_, index) =>
      moduleInfo(`mod-${index}`, `Modul ${index}`, [{ path: "", label: `Modul ${index}`, icon: null, order: 50 + index }])
    );
    const withOneModule = menuPages(appPages, ctx({ currentUser: user("admin"), runtimeModules: oneModule }));
    const withSevenModules = menuPages(appPages, ctx({ currentUser: user("admin"), runtimeModules: sevenModules }));
    expect(withSevenModules.length).toBe(withOneModule.length);
    expect(withSevenModules.map((page) => page.id)).toEqual(withOneModule.map((page) => page.id));
    // Mit 0 aktiven Modulen fehlt „Mitmachen" (siehe nächster Test) — ein Eintrag weniger als mit 1–7 Modulen.
    expect(withOneModule.length).toBe(
      menuPages(appPages, ctx({ currentUser: user("admin"), runtimeModules: [] })).length + 1
    );
  });

  it("zeigt „Mitmachen“ nur im Menü, wenn mindestens ein Modul aktiv ist", () => {
    expect(menuPages(appPages, ctx({ runtimeModules: [] })).map((page) => page.id)).not.toContain("mitmachen");
    const presence = moduleInfo("presence", "Spielt gerade", [{ path: "", label: "Spielt gerade", icon: null, order: 25 }]);
    expect(menuPages(appPages, ctx({ runtimeModules: [presence] })).map((page) => page.id)).toContain("mitmachen");
  });

  it("leitet alte #m/<id>-Links per Alias auf die Sammelseite „Mitmachen“ weiter", () => {
    expect(resolvePage(appPages, ctx(), "#m/presence")).toMatchObject({ subPath: "presence" });
    expect(resolvePage(appPages, ctx(), "#m/presence").page.id).toBe("mitmachen");
    expect(resolvePage(appPages, ctx(), "#m/pizza/liste")).toMatchObject({ subPath: "pizza/liste" });
  });

  it("gruppiert Mitmachen-Unterseiten nach Modulnamen nur, wenn ein Modul mehrere Menüeinträge hat", () => {
    const t = ((key: string) => key) as never;
    const mitmachenPage = appPages.find((page) => page.id === "mitmachen")!;
    const presence = moduleInfo("presence", "Spielt gerade", [{ path: "", label: "Spielt gerade", icon: null, order: 25 }]);
    const demo = moduleInfo("demo", "Demo", [
      { path: "", label: "Demo", icon: null, order: 40 },
      { path: "liste", label: "Liste", icon: null, order: 41 }
    ]);
    expect(mitmachenPage.subnav!(t, ctx({ runtimeModules: [presence, demo] }))).toEqual([
      { slug: "presence", label: "Spielt gerade", group: undefined },
      { slug: "demo", label: "Demo", group: "Demo" },
      { slug: "demo/liste", label: "Liste", group: "Demo" }
    ]);
    expect(mitmachenPage.subnav!(t, ctx({ currentUser: null, runtimeModules: [presence] }))).toEqual([]);
  });

  it("rendert für Gäste den Login-Hinweis und für Mitglieder die passende Modulseite", async () => {
    const { LoginRequired } = await import("./LoginRequired");
    const { ModuleMenuEntryPage } = await import("../modules/runtime");
    const mitmachenPage = appPages.find((page) => page.id === "mitmachen")!;
    const demo = moduleInfo("demo", "Demo", [
      { path: "", label: "Demo", icon: null, order: 40 },
      { path: "liste", label: "Liste", icon: null, order: 41 }
    ]);
    const renderCtx = {
      setCurrentUser: () => {},
      applySettings: () => {}
    };

    const guestResult = mitmachenPage.render({ ...ctx({ currentUser: null, runtimeModules: [demo] }), subPath: "demo", ...renderCtx }) as {
      type: unknown;
    };
    expect(guestResult.type).toBe(LoginRequired);

    const memberResult = mitmachenPage.render({
      ...ctx({ runtimeModules: [demo] }),
      subPath: "demo/liste",
      ...renderCtx
    }) as { type: unknown; props: { entry: { path: string }; subPath: string } };
    expect(memberResult.type).toBe(ModuleMenuEntryPage);
    expect(memberResult.props.entry.path).toBe("liste");
    expect(memberResult.props.subPath).toBe("");
  });
});
