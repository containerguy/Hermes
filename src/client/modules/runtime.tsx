import React, { useEffect, useState } from "react";
import * as ReactDOM from "react-dom";
import { requestJson } from "../api/request";
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
    onRealtime: (event, handler) => subscribe({ module: info.id, event, handler }),
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
  quiet = false,
  render,
}: {
  info: RuntimeModuleInfo;
  locale: string;
  pick: (definition: ModuleClientDefinition) => React.ComponentType<never> | undefined;
  fallback?: React.ReactNode;
  /** Nichts anzeigen, solange geladen wird oder wenn das Laden scheitert (für Hinweise). */
  quiet?: boolean;
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

  if (state.error && quiet) return null;
  if (state.error) {
    return (
      <section className="notice" role="alert">
        <strong>Modul „{info.name}“ konnte nicht geladen werden.</strong>
        <p className="muted">{state.error}</p>
      </section>
    );
  }
  if (!state.definition) return quiet ? null : <p className="muted">…</p>;
  const Component = pick(state.definition);
  if (!Component) return <>{fallback ?? null}</>;
  return <ModuleErrorBoundary moduleId={info.id}>{render(Component)}</ModuleErrorBoundary>;
}

/** Hinweise aktiver Module oben auf der Startseite (Manifest `startNotice`). */
export function ModuleNotices({ modules, locale, user }: { modules: RuntimeModuleInfo[]; locale: string; user: User }) {
  return (
    <>
      {modules
        .filter((info) => info.startNotice && info.clientUrl)
        .map((info) => (
          <ModuleSlot
            key={info.id}
            info={info}
            locale={locale}
            quiet
            pick={(definition) => definition.Notice as React.ComponentType<never> | undefined}
            render={(Notice) => {
              const Component = Notice as unknown as React.ComponentType<import("./types").ModuleNoticeProps>;
              return <Component user={user} />;
            }}
          />
        ))}
    </>
  );
}

/** Profilbereich eines Moduls (`#login/m-<id>`). */
export function ModuleProfileSection({ info, locale, user }: { info: RuntimeModuleInfo; locale: string; user: User }) {
  return (
    <ModuleSlot
      info={info}
      locale={locale}
      pick={(definition) => definition.Profile as React.ComponentType<never> | undefined}
      fallback={<p className="muted">Dieses Modul hat keinen Profilbereich.</p>}
      render={(Profile) => {
        const Component = Profile as unknown as React.ComponentType<import("./types").ModuleProfileProps>;
        return <Component user={user} />;
      }}
    />
  );
}

/** Ein Menüeintrag eines aktiven Moduls, wie er auf der Sammelseite „Mitmachen" erscheint. */
export type ModuleMenuEntry = {
  info: RuntimeModuleInfo;
  entry: RuntimeModuleInfo["menu"][number];
  /** Slug unter `#mitmachen/<slug>`, z. B. `presence` oder `demo/liste`. */
  slug: string;
};

/** Alle Menüeinträge aktiver Module, sortiert nach ihrer `order` für die Sammelseite „Mitmachen". */
export function moduleMenuEntries(infos: RuntimeModuleInfo[]): ModuleMenuEntry[] {
  return infos
    .flatMap((info) =>
      info.menu.map((entry) => ({ info, entry, slug: entry.path ? `${info.id}/${entry.path}` : info.id })),
    )
    .sort((a, b) => a.entry.order - b.entry.order || a.slug.localeCompare(b.slug));
}

/**
 * Findet den Menüeintrag zu einem Unterpfad unter „Mitmachen" (`#mitmachen/<subPath>`). Wie bei
 * `resolvePage` gewinnt der längste passende Slug, damit ein Modul eigene Unterseiten jenseits
 * seiner registrierten Menüeinträge selbst weiterrouten kann.
 */
export function resolveModuleMenuEntry(
  infos: RuntimeModuleInfo[],
  subPath: string,
): { match: ModuleMenuEntry; innerSubPath: string } | undefined {
  const match = moduleMenuEntries(infos)
    .filter((candidate) => subPath === candidate.slug || subPath.startsWith(`${candidate.slug}/`))
    .sort((a, b) => b.slug.length - a.slug.length)[0];
  if (!match) return undefined;
  return { match, innerSubPath: subPath.slice(match.slug.length + 1) };
}

/** Seite eines Modul-Menüeintrags auf der Sammelseite „Mitmachen" (`#mitmachen/<slug>`). */
export function ModuleMenuEntryPage({
  info,
  entry,
  locale,
  user,
  subPath,
}: {
  info: RuntimeModuleInfo;
  entry: RuntimeModuleInfo["menu"][number];
  locale: string;
  user: User;
  subPath: string;
}) {
  return (
    <div className="page-card module-page">
      <ModuleSlot
        info={info}
        locale={locale}
        pick={(definition) => definition.Page as React.ComponentType<never> | undefined}
        fallback={<p className="muted">Dieses Modul hat keine eigene Seite.</p>}
        render={(Page) => {
          const Component = Page as unknown as React.ComponentType<import("./types").ModulePageProps>;
          return <Component path={entry.path} subPath={subPath} user={user} permissions={info.permissions} />;
        }}
      />
    </div>
  );
}

/** Lädt die Liste der aktiven Module, sobald sich die Anmeldung ändert. */
export function useRuntimeModules(currentUser: User | null, locale?: string) {
  const [modules, setModules] = useState<RuntimeModuleInfo[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    if (!currentUser) {
      setModules([]);
      return;
    }
    let cancelled = false;
    // Menü- und Profiltexte in der Sprache der Oberfläche (die Benutzer-Einstellung kann leer sein).
    requestJson<{ modules: RuntimeModuleInfo[] }>(locale ? `/api/modules?locale=${encodeURIComponent(locale)}` : "/api/modules")
      .then((result) => !cancelled && setModules(result.modules ?? []))
      .catch(() => !cancelled && setModules([]));
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, currentUser?.role, reloadToken, locale]);

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
