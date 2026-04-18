import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import type { AdminSection, AppSettings, User } from "./client/types/core";
import { requestJson } from "./client/api/request";
import { clearCsrfToken, primeCsrfToken } from "./client/api/csrf";
import { EventBoard } from "./client/components/EventBoard";
import { InfosPage } from "./client/components/InfosPage";
import { LoginPage } from "./client/components/LoginPage";
import { AdminPanel } from "./client/components/AdminPanel";
import { I18nProvider, useI18n, type TFunction } from "./client/i18n/I18nContext";
import { resolveEffectiveLocale } from "./client/lib/locale-display";

type Route = {
  id: PageId;
  path: string;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
};

type PageId = "events" | "infos" | "login" | "admin";

function buildAppRoutes(t: TFunction): Route[] {
  return [
    {
      id: "events",
      path: "#events",
      label: t("main.nav.start"),
      eyebrow: t("main.route.events.eyebrow"),
      title: t("main.route.events.title"),
      description: t("main.route.events.description")
    },
    {
      id: "infos",
      path: "#infos",
      label: t("main.nav.infos"),
      eyebrow: t("main.route.infos.eyebrow"),
      title: t("main.route.infos.title"),
      description: ""
    },
    {
      id: "login",
      path: "#login",
      label: t("main.nav.login"),
      eyebrow: t("main.route.login.eyebrow"),
      title: t("main.route.login.title"),
      description: t("main.route.login.description")
    },
    {
      id: "admin",
      path: "#admin",
      label: t("main.nav.admin"),
      eyebrow: t("main.route.admin.eyebrow"),
      title: t("main.route.admin.title"),
      description: t("main.route.admin.description")
    }
  ];
}

const defaultSettings: AppSettings = {
  appName: "",
  defaultNotificationsEnabled: true,
  eventAutoArchiveHours: 8,
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
  defaultLocale: "de"
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

const adminSectionBySlug: Record<string, AdminSection> = {
  "": "users",
  users: "users",
  betrieb: "betrieb",
  design: "design",
  infos: "infos",
  sicherheit: "sicherheit",
  invites: "invites",
  audit: "audit"
};

const legacyAdminHashToSection: Record<string, AdminSection> = {
  users: "users",
  betrieb: "betrieb",
  design: "design",
  infos: "infos",
  sicherheit: "sicherheit",
  invites: "invites",
  audit: "audit"
};

function parseHashRoute(): { page: PageId; adminSection: AdminSection } {
  const rawHash = window.location.hash || "";
  const queryStart = rawHash.indexOf("?");
  const hashPath = queryStart >= 0 ? rawHash.slice(0, queryStart) : rawHash;

  if (hashPath === "#manager") {
    return { page: "events", adminSection: "users" };
  }

  const legacy = hashPath.match(/^#admin-([a-z]+)$/);
  if (legacy) {
    const section = legacyAdminHashToSection[legacy[1] ?? ""];
    if (section) {
      return { page: "admin", adminSection: section };
    }
  }

  if (hashPath === "#admin" || hashPath.startsWith("#admin/")) {
    const sub = hashPath === "#admin" ? "" : hashPath.slice("#admin/".length);
    const slug = sub.split("/")[0] ?? "";
    const section = adminSectionBySlug[slug] ?? "users";
    return { page: "admin", adminSection: section };
  }

  if (hashPath === "#infos") {
    return { page: "infos", adminSection: "users" };
  }

  if (hashPath === "#login") {
    return { page: "login", adminSection: "users" };
  }

  return { page: "events", adminSection: "users" };
}

function applyShellStartHero(route: Route, settings: AppSettings): Route {
  if (route.id !== "events") {
    return route;
  }
  const title = settings.shellStartTitle.trim() || route.title;
  const customDescription = settings.shellStartDescription.trim();
  const description = customDescription.length > 0 ? customDescription : "";
  return { ...route, title, description };
}

function PageHeader({
  route,
  currentUser,
  omitSessionAside
}: {
  route: Route;
  currentUser: User | null;
  omitSessionAside: boolean;
}) {
  const { t } = useI18n();
  const hasHeroDescription = Boolean(route.description.trim());
  return (
    <section
      className={`page-hero hero-${route.id}${omitSessionAside ? " page-hero--single" : ""}${!hasHeroDescription ? " page-hero--no-description" : ""}`}
      aria-labelledby={`${route.id}-title`}
    >
      <div className="hero-copy">
        <p className="eyebrow">{route.eyebrow}</p>
        <h1 id={`${route.id}-title`}>{route.title}</h1>
        {hasHeroDescription ? <p>{route.description}</p> : null}
      </div>
      {omitSessionAside ? null : (
        <aside className="hero-status" aria-label={t("main.hero.statusAria")}>
          <img src="/icon.svg" alt="" />
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
  const routes = useMemo(() => buildAppRoutes(t), [t]);

  const initialRoute = parseHashRoute();
  const [activePage, setActivePage] = useState<PageId>(() => initialRoute.page);
  const [adminSection, setAdminSection] = useState<AdminSection>(() => initialRoute.adminSection);

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
    requestJson<{ settings: AppSettings }>("/api/settings")
      .then((result) => {
        setAppSettings(result.settings);
        applyTheme(result.settings);
      })
      .catch(() => applyTheme(defaultSettings));
  }, [setAppSettings]);

  useEffect(() => {
    function syncHash() {
      const next = parseHashRoute();
      setActivePage(next.page);
      setAdminSection(next.adminSection);
    }

    window.addEventListener("hashchange", syncHash);
    syncHash();
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const activeRoute = routes.find((route) => route.id === activePage) ?? routes[0];
  const displayRoute =
    activePage === "login" && currentUser
      ? {
          ...activeRoute,
          label: t("main.nav.profile"),
          eyebrow: t("main.route.profileLogin.eyebrow"),
          title: t("main.route.profileLogin.title"),
          description: t("main.route.profileLogin.description")
        }
      : activeRoute;

  const eventBoardMode =
    currentUser?.role === "manager" || currentUser?.role === "admin" ? "manager" : "events";

  const omitHeroSessionAside = Boolean(
    currentUser &&
      (displayRoute.id === "events" || displayRoute.id === "admin" || displayRoute.id === "infos")
  );

  const heroRoute = applyShellStartHero(displayRoute, appSettings);

  const displayAppName = useMemo(
    () => appSettings.appName.trim() || t("brand.displayName"),
    [appSettings.appName, t]
  );

  useEffect(() => {
    document.title = displayAppName;
  }, [displayAppName]);

  const adminNav = useMemo(
    () =>
      [
        ["users", t("main.admin.nav.users")],
        ["betrieb", t("main.admin.nav.ops")],
        ["design", t("main.admin.nav.design")],
        ["infos", t("main.admin.nav.infos")],
        ["sicherheit", t("main.admin.nav.security")],
        ["invites", t("main.admin.nav.invites")],
        ["audit", t("main.admin.nav.audit")]
      ] as const,
    [t]
  );

  function renderActivePage() {
    if (activePage === "login") {
      return (
        <LoginPage
          currentUser={currentUser}
          settings={appSettings}
          onLoggedIn={setCurrentUser}
          onLoggedOut={() => setCurrentUser(null)}
          onUserUpdated={setCurrentUser}
        />
      );
    }

    if (activePage === "infos") {
      return <InfosPage markdown={appSettings.infosMarkdown} enabled={appSettings.infosEnabled} />;
    }

    if (activePage === "admin") {
      return (
        <section className="admin-stage" aria-label={t("main.stage.admin")}>
          <AdminPanel
            currentUser={currentUser}
            adminSection={adminSection}
            onSettingsChanged={(settings) => {
              setAppSettings(settings);
              applyTheme(settings);
            }}
          />
        </section>
      );
    }

    return (
      <EventBoard
        currentUser={currentUser}
        mode={eventBoardMode}
        emptyBoardTitle={appSettings.shellEventsEmptyTitle}
        emptyBoardBody={appSettings.shellEventsEmptyBody}
        gameCatalog={appSettings.gameCatalog}
      />
    );
  }

  return (
    <main className={`app-shell page-${activePage}`}>
      <header className="topbar" aria-label={t("main.topbar.aria")}>
        <a className="brand" href="#events" aria-label={t("main.brand.aria")}>
          <img className="brand-mark" src="/icon.svg" alt="" />
          <span>{displayAppName}</span>
        </a>
        <div className="topbar-end">
          <nav className="nav-links" aria-label={t("main.nav.regions")}>
            {routes
              .filter((route) => {
                if (route.id === "login") {
                  return false;
                }
                if (route.id === "infos") {
                  return appSettings.infosEnabled;
                }
                return true;
              })
              .map((route) => (
                <a
                  href={route.path}
                  key={route.path}
                  className={activePage === route.id ? "active" : undefined}
                  aria-current={activePage === route.id ? "page" : undefined}
                >
                  {route.label}
                </a>
              ))}
          </nav>
          <a
            href="#login"
            className={`profile-nav-trigger${activePage === "login" ? " active" : ""}`}
            aria-current={activePage === "login" ? "page" : undefined}
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
      {activePage === "admin" && currentUser?.role === "admin" ? (
        <div className="admin-nav-bar">
          <nav className="admin-top-subnav" aria-label={t("main.admin.subnav")}>
            {adminNav.map(([slug, label]) => (
              <a
                key={slug}
                href={`#admin/${slug}`}
                className={adminSection === slug ? "active" : undefined}
                aria-current={adminSection === slug ? "page" : undefined}
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
      ) : null}
      <div className="page-shell">
        <PageHeader
          route={heroRoute}
          currentUser={currentUser}
          omitSessionAside={omitHeroSessionAside}
        />
        {renderActivePage()}
      </div>
    </main>
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
    <I18nProvider locale={effectiveLocale}>
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
