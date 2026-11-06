import type { ReactNode } from "react";
import type { AppSettings, User } from "../types/core";
import type { TFunction } from "../i18n/I18nContext";
import type { RuntimeModuleInfo } from "../modules/types";

/**
 * Zentrale Menüliste der App.
 *
 * Jeder feste Bereich (Runden, Event, Mitmachen, Admin …) trägt hier einen Menüpunkt ein. Ein
 * eingebautes Modul liefert ein `AppModule` mit seinen Menüpunkten; die Shell baut daraus
 * Hauptmenü, mobile Tab-Leiste und Routing. Ein Modul zu entfernen heißt, es aus `appModules`
 * zu streichen — die Shell selbst kennt keine Modulnamen.
 *
 * Laufzeit-Module (installiert über `GET /api/modules`, z. B. Pizza) bekommen dagegen **keinen**
 * eigenen Hauptmenüpunkt: Ihre Menüeinträge erscheinen nur unter der festen Sammelseite
 * „Mitmachen" (`id: "mitmachen"` in `createCoreModule`), damit die Zahl der Hauptmenüpunkte nicht
 * von der Zahl der installierten Module abhängt (Befund B4). Siehe `moduleMenuEntries` und
 * `resolveModuleMenuEntry` in `../modules/runtime`.
 */

export type NavContext = {
  currentUser: User | null;
  settings: AppSettings;
  /** Aktive Laufzeit-Module (GET /api/modules) für Profilbereiche und Startseiten-Hinweise. */
  runtimeModules?: RuntimeModuleInfo[];
  locale?: string;
};

export type PageHero = {
  eyebrow: string;
  title: string;
  description: string;
};

export type NavPage = {
  /** Eindeutige Kennung, wird auch als CSS-Klasse `page-<id>` genutzt. */
  id: string;
  /** Hash ohne `#`, z. B. `events` → `#events`. */
  hash: string;
  /** Weitere Hashes, die auf diese Seite führen (alte Links). */
  aliases?: string[];
  /** Sortierung im Menü, kleiner = weiter vorne. */
  order: number;
  label: (t: TFunction) => string;
  /** SVG-Pfad (24×24) für die mobile Tab-Leiste. */
  icon: string;
  hero: (t: TFunction, ctx: NavContext) => PageHero;
  /**
   * Gibt es die Seite gerade überhaupt (z. B. Modul eingeschaltet)? Abgeschaltete Seiten sind
   * auch per Hash nicht erreichbar. Fehlt der Eintrag, ist die Seite immer da.
   */
  enabled?: (ctx: NavContext) => boolean;
  /** Im Menü anzeigen? Seiten außerhalb des Menüs bleiben per Hash erreichbar (z. B. Login-Hinweis). */
  inMenu: (ctx: NavContext) => boolean;
  /** Untermenü der Seite, z. B. Admin- oder Profilbereiche. Der erste Eintrag ist der Standard. */
  subnav?: (t: TFunction, ctx: NavContext) => SubnavEntry[];
  subnavLabel?: (t: TFunction) => string;
  render: (ctx: NavPageRenderContext) => ReactNode;
};

/** `group` = Überschrift in der Seitenleiste; Einträge mit gleicher Gruppe stehen zusammen. */
export type SubnavEntry = { slug: string; label: string; group?: string };

/** Unterpunkte im Adminbereich, die Module beisteuern können. */
export type AdminNavEntry = {
  slug: string;
  order: number;
  label: (t: TFunction) => string;
  /** Gruppe in der Admin-Seitenleiste; ohne Angabe landet der Eintrag unter „Module“. */
  group?: AdminNavGroup;
  enabled?: (ctx: NavContext) => boolean;
  render: (ctx: NavPageRenderContext) => ReactNode;
};

export type AdminNavGroup = "people" | "system" | "modules" | "log";

export type AppModule = {
  id: string;
  pages?: NavPage[];
  adminSections?: AdminNavEntry[];
};

export type NavPageRenderContext = NavContext & {
  /** Unterseite aus dem Hash, z. B. `#admin/design` → `design`. */
  subPath: string;
  setCurrentUser: (user: User | null) => void;
  /** Nach dem Speichern im Adminbereich: neue Einstellungen übernehmen und Theme anwenden. */
  applySettings: (settings: AppSettings) => void;
};

export function collectPages(modules: AppModule[]): NavPage[] {
  return modules.flatMap((module) => module.pages ?? []).sort((a, b) => a.order - b.order);
}

export function collectAdminSections(modules: AppModule[]): AdminNavEntry[] {
  return modules.flatMap((module) => module.adminSections ?? []).sort((a, b) => a.order - b.order);
}

export type ParsedHash = {
  /** Erstes Segment, z. B. `admin` bei `#admin/design?x=1`. */
  head: string;
  /** Rest nach dem ersten `/`, ohne Query. */
  subPath: string;
};

export function parseHash(rawHash: string): ParsedHash {
  const withoutHash = rawHash.replace(/^#/, "");
  const queryStart = withoutHash.indexOf("?");
  const path = queryStart >= 0 ? withoutHash.slice(0, queryStart) : withoutHash;
  const slash = path.indexOf("/");
  if (slash < 0) {
    return { head: path, subPath: "" };
  }
  return { head: path.slice(0, slash), subPath: path.slice(slash + 1) };
}

export function isPageEnabled(page: NavPage, ctx: NavContext): boolean {
  return page.enabled ? page.enabled(ctx) : true;
}

export function menuPages(pages: NavPage[], ctx: NavContext): NavPage[] {
  return pages.filter((page) => isPageEnabled(page, ctx) && page.inMenu(ctx));
}

/**
 * Findet die Seite zu einem Hash. Unbekannte oder abgeschaltete Seiten landen auf der ersten Seite.
 */
export function resolvePage(pages: NavPage[], ctx: NavContext, rawHash: string): { page: NavPage; subPath: string } {
  const { head, subPath } = parseHash(rawHash);
  const enabled = pages.filter((page) => isPageEnabled(page, ctx));
  const fallback = enabled[0] ?? pages[0];
  // Seiten mit mehrteiligem Hash (Module: `m/<id>/<pfad>`): längster passender Hash gewinnt.
  const fullPath = subPath ? `${head}/${subPath}` : head;
  const nested = enabled
    .filter((page) => page.hash.includes("/") && (fullPath === page.hash || fullPath.startsWith(`${page.hash}/`)))
    .sort((a, b) => b.hash.length - a.hash.length)[0];
  if (nested) {
    return { page: nested, subPath: fullPath.slice(nested.hash.length + 1) };
  }
  const match = enabled.find((page) => page.hash === head || page.aliases?.includes(head));
  if (!match) {
    return { page: fallback, subPath: "" };
  }
  return { page: match, subPath };
}
