import type React from "react";
import type { User } from "../types/core";

/** Was GET /api/modules je aktivem Modul liefert. */
export type RuntimeModuleInfo = {
  id: string;
  version: string;
  name: string;
  clientUrl: string | null;
  adminPage: boolean;
  /** Eigener Profilbereich (`#login/m-<id>`), falls das Modul einen hat. */
  profile?: { label: string; order: number } | null;
  /** Zeigt `Notice` oben auf der Startseite. */
  startNotice?: boolean;
  permissions: string[];
  menu: Array<{ path: string; label: string; icon: string | null; order: number }>;
  i18n: { de: Record<string, string>; en: Record<string, string> };
};

/**
 * Schnittstelle des Kerns für den Client-Teil eines Moduls (`client.mjs`).
 *
 * `client.mjs` exportiert als default eine Funktion `(host) => ModuleClientDefinition`.
 * React kommt vom Kern (`host.React`), damit es nur eine React-Instanz gibt.
 */
export type ModuleClientHost = {
  id: string;
  version: string;
  matchdeskApi: number;
  React: typeof React;
  locale: string;
  /** Übersetzung aus i18n/<locale>.json des Moduls, mit {platzhalter}. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** fetch auf /api/m/<id><path> mit Anmeldung und CSRF; wirft bei Fehlern. */
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
  /** Hört auf `ctx.realtime.broadcast(event, data)` des eigenen Server-Teils. */
  onRealtime: (event: string, handler: (data: unknown) => void) => () => void;
};

export type ModulePageProps = {
  /** Menüpfad aus dem Manifest ("" = Startseite). */
  path: string;
  /** Rest des Hashes hinter #mitmachen/<id>/<path>/ */
  subPath: string;
  user: User;
  permissions: string[];
};

export type ModuleAdminProps = {
  user: User;
  settings: Record<string, unknown>;
  reloadSettings: () => void;
};

export type ModuleProfileProps = { user: User };

export type ModuleNoticeProps = { user: User };

export type ModuleClientDefinition = {
  Page?: React.ComponentType<ModulePageProps>;
  Admin?: React.ComponentType<ModuleAdminProps>;
  /** Bereich im Profil (Manifest `profile`). */
  Profile?: React.ComponentType<ModuleProfileProps>;
  /** Hinweis auf der Startseite (Manifest `startNotice`); rendert `null`, wenn nichts zu sagen ist. */
  Notice?: React.ComponentType<ModuleNoticeProps>;
};

export type ModuleClientFactory = (host: ModuleClientHost) => ModuleClientDefinition;
