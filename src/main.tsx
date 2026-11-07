import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import type { AppReleaseInfo, AppSettings, PublicAppSettings, User } from "./client/types/core";
import { requestJson } from "./client/api/request";
import { clearCsrfToken, primeCsrfToken } from "./client/api/csrf";
import { KioskStreamPage } from "./client/components/KioskStreamPage";
import { MainEventSwitcher } from "./client/components/MainEventSwitcher";
import { appPages } from "./client/navigation/modules";
import { useRuntimeModules } from "./client/modules/runtime";
import {
  menuPages,
  resolvePage,
  type NavContext,
  type NavPage,
  type PageHero,
  type SubnavEntry
} from "./client/navigation/registry";
import { I18nProvider, useI18n } from "./client/i18n/I18nContext";
import { BrandingProvider, useBrandIconSrc } from "./client/lib/BrandingContext";
import { brandIconSrc } from "./client/lib/brand-icon";
import { resolveEffectiveLocale } from "./client/lib/locale-display";
import { pickAppDisplayName } from "./shared/app-display-name";
import { isAdministrator } from "./client/permissions";

const defaultSettings: AppSettings = {
  appName: "",
  brandMark: "mitspiel",
  projectTemplate: "lan_party",
  defaultNotificationsEnabled: true,
  eventAutoArchiveHours: 8,
  maxRunningMainEvents: 10,
  publicRegistrationEnabled: false,
  shellStartTitle: "",
  shellStartDescription: "",
  shellEventsEmptyTitle: "",
  shellEventsEmptyBody: "",
  themePrimaryColor: "#0f766e",
  themeLoginColor: "#be123c",
  themeManagerColor: "#b7791f",
  themeAdminColor: "#2563eb",
  themeSurfaceColor: "#f6f8f4",
  gameCatalog: [],
  infosEnabled: false,
  infosMarkdown: "",
  s3SnapshotEnabled: true,
  defaultLocale: "de",
  kioskStreamEnabled: false,
  kioskStreamPath: "stream",
  kioskStreamSecret: "",
  kioskMainEventId: "",
  ampIntegrationEnabled: false,
  ampBaseUrl: "",
  ampAutoStartOnReady: false,
  ampAutoStopIdleMinutes: 0,
};

function applyTheme(settings: AppSettings) {
  const root = document.documentElement;
  root.style.setProperty("--teal", settings.themePrimaryColor);
  root.style.setProperty("--rose", settings.themeLoginColor);
  root.style.setProperty("--amber", settings.themeManagerColor);
  root.style.setProperty("--blue", settings.themeAdminColor);
  root.style.setProperty("--surface", settings.themeSurfaceColor);
  root.style.setProperty("--surface-strong", `${settings.themeSurfaceColor}f2`);
}

function profileInitials(user: User): string {
  const base = (user.displayName || user.username).trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
  }
  return base.slice(0, 2).toUpperCase() || "?";
}

/**
 * Alte Hashes umbiegen: Admin (#admin-design → #admin/design) und bis 0.16 eingebaute Funktionen,
 * die jetzt Module sind (#pizza → #m/pizza, #playing → #m/presence, z. B. aus alten Push-Benachrichtigungen).
 */
function normalizeLegacyHash(rawHash: string): string {
  const legacy = rawHash.match(/^#admin-([a-z]+)(.*)$/);
  if (legacy) return `#admin/${legacy[1]}${legacy[2]}`;
  const moved = rawHash.match(/^#(pizza|playing)(\/.*)?$/);
  if (moved) return `#m/${moved[1] === "playing" ? "presence" : moved[1]}${moved[2] ?? ""}`;
  // „Infos" ist Unterseite von „Event" (kein eigener Hauptmenüpunkt mehr, siehe HCI-114).
  const movedInfos = rawHash.match(/^#infos(\/.*)?$/);
  if (movedInfos) return `#main-events/infos${movedInfos[1] ?? ""}`;
  // Spielkonten liegen jetzt im Profilbereich des Moduls.
  return rawHash.replace(/^#login\/spielkonten\b/, "#login/m-presence");
}

function normalizeDocumentPath(path: string) {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function NavIcon({ path }: { path: string }) {
  return (
    <svg className="nav-icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

function PageHeader({
  pageId,
  hero,
  currentUser,
  omitSessionAside,
  collapsed
}: {
  pageId: string;
  hero: PageHero;
  currentUser: User | null;
  omitSessionAside: boolean;
  collapsed: boolean;
}) {
  const { t } = useI18n();
  const markSrc = useBrandIconSrc();
  const hasHeroDescription = Boolean(hero.description.trim());
  return (
    <section
      className={`page-hero hero-${pageId}${omitSessionAside ? " page-hero--single" : ""}${!hasHeroDescription ? " page-hero--no-description" : ""}${collapsed ? " page-hero--collapsed" : ""}`}
      aria-labelledby={`${pageId}-title`}
    >
      <div className="hero-copy">
        {hero.eyebrow ? <p className="eyebrow">{hero.eyebrow}</p> : null}
        <h1 id={`${pageId}-title`}>{hero.title}</h1>
        {hasHeroDescription ? <p>{hero.description}</p> : null}
      </div>
      {omitSessionAside ? null : (
        <aside className="hero-status" aria-label={t("main.hero.statusAria")}>
          <img src={markSrc} alt="" />
          <div>
            <span>{t("main.hero.session")}</span>
            <strong>{currentUser ? currentUser.username : t("main.hero.guest")}</strong>
          </div>
          <div>
            <span>{t("main.hero.role")}</span>
            <strong>{currentUser?.role ?? t("main.hero.loginOpen")}</strong>
          </div>
        </aside>
      )}
    </section>
  );
}

/**
 * Seitenleiste für Bereiche mit Unterseiten (Admin, Profil). Auf dem Desktop links neben dem
 * Inhalt; auf schmalen Bildschirmen zeigt `#admin` nur diese Liste und eine Unterseite nur den
 * Inhalt mit Zurück-Link (per CSS, siehe `.side-layout`).
 */
function SideNav({
  label,
  pageHash,
  entries,
  activeSlug
}: {
  label: string;
  pageHash: string;
  entries: SubnavEntry[];
  activeSlug: string;
}) {
  const groups: Array<{ name: string; entries: SubnavEntry[] }> = [];
  for (const entry of entries) {
    const name = entry.group ?? "";
    const last = groups.at(-1);
    if (last && last.name === name) {
      last.entries.push(entry);
    } else {
      groups.push({ name, entries: [entry] });
    }
  }
  return (
    <nav className="side-nav" aria-label={label}>
      {groups.map((group) => (
        <div className="side-nav__group" key={group.name || "default"}>
          {group.name ? <p className="side-nav__heading">{group.name}</p> : null}
          <ul>
            {group.entries.map((entry) => (
              <li key={entry.slug}>
                <a
                  href={`#${pageHash}/${entry.slug}`}
                  className={activeSlug === entry.slug ? "active" : undefined}
                  aria-current={activeSlug === entry.slug ? "page" : undefined}
                >
                  {entry.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * Kopfbereich beim Runterscrollen zu einer schmalen Zeile zusammenklappen. Zwei Schwellen,
 * damit das Zusammenklappen (Seite wird kürzer) nicht sofort wieder das Aufklappen auslöst.
 */
const HERO_COLLAPSE_AT = 96;
const HERO_EXPAND_AT = 12;

function useHeroCollapsed(): boolean {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    let frame = 0;
    function update() {
      frame = 0;
      const y = window.scrollY;
      setCollapsed((current) => (current ? y > HERO_EXPAND_AT : y > HERO_COLLAPSE_AT));
    }
    function onScroll() {
      if (!frame) {
        frame = window.requestAnimationFrame(update);
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);
  return collapsed;
}

/** Höhe der klebenden Kopfzeile als CSS-Variable, damit der Seitenkopf direkt darunter klebt. */
function useTopbarHeightVar(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const apply = () =>
      document.documentElement.style.setProperty("--topbar-height", `${element.getBoundingClientRect().height}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => observer.disconnect();
  });
}

function AppShell({
  currentUser,
  setCurrentUser,
  appSettings,
  setAppSettings
}: {
  currentUser: User | null;
  setCurrentUser: React.Dispatch<React.SetStateAction<User | null>>;
  appSettings: AppSettings;
  setAppSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}) {
  const { t } = useI18n();
  const shellIconSrc = useMemo(() => brandIconSrc(appSettings), [appSettings.brandMark]);

  const heroCollapsed = useHeroCollapsed();
  const topbarRef = useRef<HTMLElement | null>(null);
  useTopbarHeightVar(topbarRef);
  const [rawHash, setRawHash] = useState(() => normalizeLegacyHash(window.location.hash || ""));
  const [publicSettingsReady, setPublicSettingsReady] = useState(false);
  const [releaseInfo, setReleaseInfo] = useState<AppReleaseInfo | null>(null);
  const documentPath = useMemo(() => normalizeDocumentPath(window.location.pathname), []);
  const kioskPathConfigured = `/${appSettings.kioskStreamPath.replace(/^\/+|\/+$/g, "")}`;
  const isKioskDocumentEntry =
    publicSettingsReady &&
    appSettings.kioskStreamEnabled &&
    documentPath === kioskPathConfigured;

  useEffect(() => {
    requestJson<{ user: User }>("/api/auth/me")
      .then((result) => {
        setCurrentUser(result.user);
        primeCsrfToken();
      })
      .catch(() => {
        clearCsrfToken();
        setCurrentUser(null);
      });
  }, [setCurrentUser]);

  useEffect(() => {
    requestJson<{ settings: PublicAppSettings; release: AppReleaseInfo }>("/api/settings/public")
      .then((result) => {
        setAppSettings((prev) => ({ ...prev, ...result.settings }));
        applyTheme({ ...defaultSettings, ...result.settings });
        setReleaseInfo(result.release);
      })
      .catch(() => applyTheme(defaultSettings))
      .finally(() => {
        setPublicSettingsReady(true);
      });
  }, [setAppSettings]);

  useEffect(() => {
    if (!publicSettingsReady || documentPath === "/") {
      return;
    }
    if (isKioskDocumentEntry) {
      return;
    }
    window.location.replace("/#events");
  }, [documentPath, isKioskDocumentEntry, publicSettingsReady]);

  useEffect(() => {
    if (!isAdministrator(currentUser)) {
      return;
    }

    requestJson<{ settings: AppSettings }>("/api/settings")
      .then((result) => {
        setAppSettings(result.settings);
        applyTheme(result.settings);
      })
      .catch(() => {});
  }, [currentUser?.id, currentUser?.role, currentUser?.permissions?.isAdmin, setAppSettings]);

  useEffect(() => {
    function syncHash() {
      setRawHash(normalizeLegacyHash(window.location.hash || ""));
    }

    window.addEventListener("hashchange", syncHash);
    syncHash();
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const { locale } = useI18n();
  const runtimeModules = useRuntimeModules(currentUser, locale);
  const navContext: NavContext = useMemo(
    () => ({ currentUser, settings: appSettings, runtimeModules, locale }),
    [currentUser, appSettings, runtimeModules, locale]
  );
  // Das Hauptmenü ist fest (Runden, Event, Mitmachen, Admin); aktive Module tragen ihre
  // Menüpunkte nur noch über `ctx.runtimeModules` zur Sammelseite „Mitmachen" bei, siehe
  // `createCoreModule`. Das Hauptmenü selbst ist dadurch unabhängig von der Zahl der Module.
  const { page: activePage, subPath } = resolvePage(appPages, navContext, rawHash);
  const menu = menuPages(appPages, navContext);
  const subnav = activePage.subnav?.(t, navContext) ?? [];
  const activeSubSlug = subPath.split("/")[0] || subnav[0]?.slug || "";

  // Beim Seitenwechsel nach oben springen statt mitten in der neuen Seite zu landen.
  useEffect(() => {
    if (typeof window.scrollTo === "function") {
      try {
        window.scrollTo({ top: 0 });
      } catch {
        /* jsdom */
      }
    }
  }, [activePage.id, activeSubSlug]);

  const omitHeroSessionAside = Boolean(currentUser) || activePage.id !== "login";
  const hero = activePage.hero(t, navContext);

  const displayAppName = useMemo(
    () => pickAppDisplayName(appSettings.appName, t("brand.displayName")),
    [appSettings.appName, t]
  );

  useEffect(() => {
    document.title = isKioskDocumentEntry ? `${displayAppName} · ${t("kiosk.pageTitle")}` : displayAppName;
  }, [displayAppName, isKioskDocumentEntry, t]);

  if (!publicSettingsReady && documentPath !== "/") {
    return (
      <div className="kiosk-boot" role="status" aria-live="polite">
        <p>{t("kiosk.bootLoading")}</p>
      </div>
    );
  }

  if (isKioskDocumentEntry) {
    const streamId = new URLSearchParams(window.location.search).get("id");
    return (
      <BrandingProvider iconSrc={shellIconSrc}>
        <KioskStreamPage appSettings={appSettings} streamId={streamId} />
      </BrandingProvider>
    );
  }

  function isActive(page: NavPage) {
    // Unterseiten ohne eigenen Menüpunkt (z. B. „Infos" unter „Event") halten den Menüpunkt
    // ihrer übergeordneten Seite aktiv, erkennbar am mehrteiligen Hash-Präfix.
    return activePage.id === page.id || activePage.hash.startsWith(`${page.hash}/`);
  }

  const pageContent = activePage.render({
    ...navContext,
    subPath,
    setCurrentUser,
    applySettings: (settings) => {
      setAppSettings(settings);
      applyTheme(settings);
    }
  });

  return (
    <BrandingProvider iconSrc={shellIconSrc}>
    <main className={`app-shell page-${activePage.id}${menu.length > 1 ? " app-shell--tabbar" : ""}`}>
      <header className="topbar" ref={topbarRef} aria-label={t("main.topbar.aria")}>
        <a className="brand" href={`#${menu[0]?.hash ?? "events"}`} aria-label={t("main.brand.aria")}>
          <img className="brand-mark" src={shellIconSrc} alt="" />
          <span>{displayAppName}</span>
        </a>
        <div className="topbar-end">
          {currentUser ? <MainEventSwitcher currentUser={currentUser} onUserChange={setCurrentUser} /> : null}
          <nav className="nav-links" aria-label={t("main.nav.regions")}>
            {menu.map((page) => (
              <a
                href={`#${page.hash}`}
                key={page.id}
                className={isActive(page) ? "active" : undefined}
                aria-current={isActive(page) ? "page" : undefined}
              >
                {page.label(t)}
              </a>
            ))}
          </nav>
          <a
            href="#login"
            className={`profile-nav-trigger${activePage.id === "login" ? " active" : ""}`}
            aria-current={activePage.id === "login" ? "page" : undefined}
            aria-label={
              currentUser
                ? t("main.profileNav.aria", { name: currentUser.username })
                : t("main.profileNav.loginAria")
            }
          >
            {currentUser ? (
              <span className="profile-avatar" aria-hidden="true">
                {profileInitials(currentUser)}
              </span>
            ) : (
              <span className="profile-avatar profile-avatar--guest" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"
                    fill="currentColor"
                  />
                </svg>
              </span>
            )}
            <span className="profile-nav-label">
              {currentUser ? t("main.nav.profile") : t("main.nav.login")}
            </span>
          </a>
        </div>
      </header>
      {subnav.length > 0 ? (
        <div className={`page-shell side-layout${subPath ? "" : " side-layout--index"}`}>
          <SideNav
            label={activePage.subnavLabel ? activePage.subnavLabel(t) : activePage.label(t)}
            pageHash={activePage.hash}
            entries={subnav}
            activeSlug={activeSubSlug}
          />
          <div className="side-content">
            <a className="side-back" href={`#${activePage.hash}`}>
              <span aria-hidden="true">‹</span> {t("main.subnav.back")}
            </a>
            {pageContent}
          </div>
        </div>
      ) : (
        <div className="page-shell">
          <PageHeader
            pageId={activePage.id}
            hero={hero}
            currentUser={currentUser}
            omitSessionAside={omitHeroSessionAside}
            collapsed={heroCollapsed}
          />
          {pageContent}
        </div>
      )}
      {menu.length > 1 ? (
        <nav className="tab-bar" aria-label={t("main.nav.mobileAria")}>
          {menu.map((page) => (
            <a
              href={`#${page.hash}`}
              key={page.id}
              className={isActive(page) ? "active" : undefined}
              aria-current={isActive(page) ? "page" : undefined}
            >
              <NavIcon path={page.icon} />
              <span>{page.label(t)}</span>
            </a>
          ))}
        </nav>
      ) : null}
      {releaseInfo ? (
        <footer className="app-footer" aria-label={t("main.footer.aria")}>
          <p className="app-footer__inner">
            <a
              className="app-footer__link"
              href={releaseInfo.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg
                className="app-footer__github-mark"
                width="18"
                height="18"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path
                  fill="currentColor"
                  d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
                />
              </svg>
              <span>{t("main.footer.sourceRelease", { version: releaseInfo.version })}</span>
            </a>
          </p>
        </footer>
      ) : null}
    </main>
    </BrandingProvider>
  );
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultSettings);
  const browserLanguage = typeof navigator !== "undefined" ? navigator.language : "";

  const effectiveLocale = useMemo(
    () => resolveEffectiveLocale(currentUser, appSettings, browserLanguage),
    [currentUser, appSettings, browserLanguage]
  );

  return (
    <I18nProvider locale={effectiveLocale} projectTemplate={appSettings.projectTemplate}>
      <AppShell
        currentUser={currentUser}
        setCurrentUser={setCurrentUser}
        appSettings={appSettings}
        setAppSettings={setAppSettings}
      />
    </I18nProvider>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
