import React, { useEffect, useState } from "react";
import * as ReactDOM from "react-dom";
import { requestJson } from "../api/request";
import { LoginRequired } from "../navigation/LoginRequired";
import { NAV_ICONS } from "../navigation/icons";
import type { AppModule, NavPage } from "../navigation/registry";
import type { User } from "../types/core";
import type { ModuleClientDefinition, ModuleClientFactory, ModuleClientHost, RuntimeModuleInfo } from "./types";

export const CLIENT_MODULE_API = 1;

declare global {
  interface Window {
    /** Gemeinsame Bibliotheken für Modul-Pakete (das SDK-Build bündelt React nicht mit). */
    __matchdesk?: { React: typeof React; ReactDOM: typeof ReactDOM; matchdeskApi: number };
  }
}

export function exposeSharedLibraries() {
  if (typeof window !== "undefined" && !window.__matchdesk) {
    window.__matchdesk = { React, ReactDOM, matchdeskApi: CLIENT_MODULE_API };
  }
}

// ---------- Realtime: ein EventSource für alle Module, nur solange jemand zuhört ----------

type Listener = { module: string; event: string; handler: (data: unknown) => void };
const listeners = new Set<Listener>();
let source: EventSource | null = null;

function ensureSource() {
  if (source || typeof EventSource === "undefined") return;
  source = new EventSource("/api/realtime/events", { withCredentials: true });
  source.addEventListener("module_event", (message) => {
    let payload: { module?: string; event?: string; data?: unknown };
    try {
      payload = JSON.parse((message as MessageEvent).data as string);
    } catch {
      return;
    }
    for (const listener of listeners) {
      if (listener.module === payload.module && listener.event === payload.event) {
        try {
          listener.handler(payload.data);
        } catch (error) {
          console.error(`[Matchdesk:${listener.module}]`, error);
        }
      }
    }
  });
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  ensureSource();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && source) {
      source.close();
      source = null;
    }
  };
}

// ---------- Laden ----------

export function createHost(info: RuntimeModuleInfo, locale: string): ModuleClientHost {
  const catalog = locale.startsWith("en") ? { ...info.i18n.de, ...info.i18n.en } : info.i18n.de;
  return {
    id: info.id,
    version: info.version,
    matchdeskApi: CLIENT_MODULE_API,
    React,
    locale,
    t: (key, vars) => {
      let text = catalog[key] ?? key;
      for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(value));
      return text;
    },
    api: (path, init) => requestJson(`/api/m/${info.id}${path.startsWith("/") ? path : `/${path}`}`, init),
    onRealtime: (event, handler) => subscribe({ module: info.id, event, handler })
  };
}

const loaded = new Map<string, Promise<ModuleClientDefinition>>();

/** Lädt client.mjs eines Moduls (gleiche Herkunft, versionierte Adresse). */
export function loadClientModule(info: RuntimeModuleInfo, locale: string): Promise<ModuleClientDefinition> {
  if (!info.clientUrl) return Promise.resolve({});
  const key = `${info.clientUrl}|${locale}`;
  const existing = loaded.get(key);
  if (existing) return existing;
  exposeSharedLibraries();
  const promise = import(/* @vite-ignore */ info.clientUrl).then((entry: { default?: ModuleClientFactory }) => {
    if (typeof entry.default !== "function") {
      throw new Error(`${info.clientUrl} exportiert keine Standardfunktion.`);
    }
    return entry.default(createHost(info, locale)) ?? {};
  });
  loaded.set(key, promise);
  promise.catch(() => loaded.delete(key));
  return promise;
}

class ModuleErrorBoundary extends React.Component<{ moduleId: string; children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[Matchdesk:${this.props.moduleId}]`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="notice" role="alert">
          <strong>Modul „{this.props.moduleId}“ ist abgestürzt.</strong>
          <p className="muted">{this.state.error.message}</p>
        </section>
      );
    }
    return this.props.children;
  }
}

export function ModuleSlot({
  info,
  locale,
  pick,
  fallback,
  render
}: {
  info: RuntimeModuleInfo;
  locale: string;
  pick: (definition: ModuleClientDefinition) => React.ComponentType<never> | undefined;
  fallback?: React.ReactNode;
  render: (Component: React.ComponentType<never>) => React.ReactNode;
}) {
  const [state, setState] = useState<{ definition?: ModuleClientDefinition; error?: string }>({});
  useEffect(() => {
    let cancelled = false;
    loadClientModule(info, locale)
      .then((definition) => !cancelled && setState({ definition }))
      .catch((error: unknown) => !cancelled && setState({ error: error instanceof Error ? error.message : String(error) }));
    return () => {
      cancelled = true;
    };
  }, [info.clientUrl, locale]);

  if (state.error) {
    return (
      <section className="notice" role="alert">
        <strong>Modul „{info.name}“ konnte nicht geladen werden.</strong>
        <p className="muted">{state.error}</p>
      </section>
    );
  }
  if (!state.definition) return <p className="muted">…</p>;
  const Component = pick(state.definition);
  if (!Component) return <>{fallback ?? null}</>;
  return <ModuleErrorBoundary moduleId={info.id}>{render(Component)}</ModuleErrorBoundary>;
}

/** Hash einer Modulseite: #m/<id> oder #m/<id>/<pfad>. */
export function moduleHash(id: string, path: string) {
  return path ? `m/${id}/${path}` : `m/${id}`;
}

/** Baut aus den aktiven Modulen Menüpunkte für die zentrale Menüliste. */
export function buildRuntimeAppModules(infos: RuntimeModuleInfo[], locale: string): AppModule[] {
  return infos.map((info) => ({
    id: `runtime:${info.id}`,
    pages: info.menu.map(
      (entry): NavPage => ({
        id: `m-${info.id}${entry.path ? `-${entry.path}` : ""}`,
        hash: moduleHash(info.id, entry.path),
        order: entry.order,
        label: () => entry.label,
        icon: entry.icon ?? NAV_ICONS.module,
        inMenu: (ctx) => Boolean(ctx.currentUser),
        hero: () => ({ eyebrow: info.name, title: entry.label, description: "" }),
        render: (ctx) =>
          ctx.currentUser ? (
            <ModuleSlot
              info={info}
              locale={locale}
              pick={(definition) => definition.Page as React.ComponentType<never> | undefined}
              fallback={<p className="muted">Dieses Modul hat keine eigene Seite.</p>}
              render={(Page) => {
                const Component = Page as unknown as React.ComponentType<import("./types").ModulePageProps>;
                return (
                  <Component path={entry.path} subPath={ctx.subPath} user={ctx.currentUser as User} permissions={info.permissions} />
                );
              }}
            />
          ) : (
            <LoginRequired eyebrowKey="main.nav.modules" />
          )
      })
    )
  }));
}

/** Lädt die Liste der aktiven Module, sobald sich die Anmeldung ändert. */
export function useRuntimeModules(currentUser: User | null) {
  const [modules, setModules] = useState<RuntimeModuleInfo[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    if (!currentUser) {
      setModules([]);
      return;
    }
    let cancelled = false;
    requestJson<{ modules: RuntimeModuleInfo[] }>("/api/modules")
      .then((result) => !cancelled && setModules(result.modules ?? []))
      .catch(() => !cancelled && setModules([]));
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, currentUser?.role, reloadToken]);

  useEffect(() => {
    const reload = () => setReloadToken((value) => value + 1);
    window.addEventListener(MODULES_CHANGED_EVENT, reload);
    return () => window.removeEventListener(MODULES_CHANGED_EVENT, reload);
  }, []);

  return modules;
}

/** Nach Installieren/Ein-/Ausschalten im Adminbereich: Menü neu laden. */
export const MODULES_CHANGED_EVENT = "matchdesk:modules-changed";

export function notifyModulesChanged() {
  window.dispatchEvent(new Event(MODULES_CHANGED_EVENT));
}
