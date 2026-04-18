import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import type {
  AdminSection,
  AppSettings,
  User
} from "./client/types/core";
import { requestJson } from "./client/api/request";
import { clearCsrfToken, primeCsrfToken } from "./client/api/csrf";
import { EventBoard } from "./client/components/EventBoard";
import { InfosPage } from "./client/components/InfosPage";
import { LoginPage } from "./client/components/LoginPage";
import { AdminPanel } from "./client/components/AdminPanel";

type Route = {
  id: PageId;
  path: string;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
};

type PageId = "events" | "infos" | "login" | "admin";

const routes: Route[] = [
  {
    id: "events",
    path: "#events",
    label: "Start",
    eyebrow: "Spielrunden im Blick",
    title: "Von der Idee bis zum Server-Join an einem Ort.",
    description:
      "Sieh auf einen Blick, welche Runde tragfähig ist, und triff deine Wahl. Mit Manager- oder Adminrechten legst du neue Runden hier direkt an — ohne zweite Oberfläche."
  },
  {
    id: "infos",
    path: "#infos",
    label: "Infos",
    eyebrow: "Orientierung",
    title: "Informationen und Hinweise.",
    description: ""
  },
  {
    id: "login",
    path: "#login",
    label: "Login",
    eyebrow: "Mailcode statt Passwort",
    title: "Schnell anmelden und auf mehreren Geräten bereit sein.",
    description:
      "Username eingeben, Einmalcode aus der Mail bestätigen und Smartphone sowie PC parallel mit derselben Session nutzen."
  },
  {
    id: "admin",
    path: "#admin",
    label: "Admin",
    eyebrow: "Betrieb & Theme",
    title: "Rollen, Einstellungen und Shell-Farben bleiben zentral verwaltet.",
    description:
      "Der Adminbereich hält Benutzer, Benachrichtigungen und die fünf backend-gespeisten Themefarben in einer gemeinsamen Konfiguration."
  }
];

const defaultSettings: AppSettings = {
  appName: "Hermes",
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
  infosMarkdown: ""
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

  const route = routes.find((item) => item.path === hashPath);
  return { page: route?.id ?? "events", adminSection: "users" };
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
        <aside className="hero-status" aria-label="Status">
          <img src="/icon.svg" alt="" />
          <div>
            <span>Session</span>
            <strong>{currentUser ? currentUser.username : "Gast"}</strong>
          </div>
          <div>
            <span>Rolle</span>
            <strong>{currentUser?.role ?? "Login offen"}</strong>
          </div>
        </aside>
      )}
    </section>
  );
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const initialRoute = parseHashRoute();
  const [activePage, setActivePage] = useState<PageId>(() => initialRoute.page);
  const [adminSection, setAdminSection] = useState<AdminSection>(() => initialRoute.adminSection);
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultSettings);

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
  }, []);

  useEffect(() => {
    requestJson<{ settings: AppSettings }>("/api/settings")
      .then((result) => {
        setAppSettings(result.settings);
        applyTheme(result.settings);
      })
      .catch(() => applyTheme(defaultSettings));
  }, []);

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
          label: "Profil",
          eyebrow: "Profil & Geräte",
          title: "Deine Anmeldung, Geräte und Benachrichtigungen im Griff.",
          description:
            "Verwalte deine aktive Session, Notification-Einstellungen und alle Geräte, die parallel mit deinem Account verbunden sind."
        }
      : activeRoute;

  const eventBoardMode =
    currentUser?.role === "manager" || currentUser?.role === "admin" ? "manager" : "events";

  const omitHeroSessionAside = Boolean(
    currentUser &&
      (displayRoute.id === "events" ||
        displayRoute.id === "admin" ||
        displayRoute.id === "infos")
  );

  const heroRoute = applyShellStartHero(displayRoute, appSettings);

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
      return (
        <InfosPage markdown={appSettings.infosMarkdown} enabled={appSettings.infosEnabled} />
      );
    }

    if (activePage === "admin") {
      return (
        <section className="admin-stage" aria-label="Admin Arbeitsbereich">
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
      <header className="topbar" aria-label="Hauptnavigation">
        <a className="brand" href="#events" aria-label="Zur Startseite">
          <img className="brand-mark" src="/icon.svg" alt="" />
          <span>{appSettings.appName}</span>
        </a>
        <div className="topbar-end">
          <nav className="nav-links" aria-label="Bereiche">
            {routes
              .filter((route) => {
                if (route.id === "login") return false;
                if (route.id === "infos") return appSettings.infosEnabled;
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
                ? `Profil, angemeldet als ${currentUser.username}`
                : "Zum Login"
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
            <span className="profile-nav-label">{currentUser ? "Profil" : "Login"}</span>
          </a>
        </div>
      </header>
      {activePage === "admin" && currentUser?.role === "admin" ? (
        <div className="admin-nav-bar">
          <nav className="admin-top-subnav" aria-label="Admin Unterseiten">
            {(
              [
                ["users", "Benutzer"],
                ["betrieb", "Betrieb"],
                ["design", "Design"],
                ["infos", "Infos"],
                ["sicherheit", "Sicherheit"],
                ["invites", "Invites"],
                ["audit", "Audit"]
              ] as const
            ).map(([slug, label]) => (
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

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
