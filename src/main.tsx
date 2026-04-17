import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import type {
  AppSettings,
  User
} from "./client/types/core";
import { requestJson } from "./client/api/request";
import { clearCsrfToken, primeCsrfToken } from "./client/api/csrf";
import { EventBoard } from "./client/components/EventBoard";
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

type PageId = "events" | "login" | "admin";

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
  themePrimaryColor: "#0f766e",
  themeLoginColor: "#be123c",
  themeManagerColor: "#b7791f",
  themeAdminColor: "#2563eb",
  themeSurfaceColor: "#f6f8f4"
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

function getPageFromHash(): PageId {
  const rawHash = window.location.hash || "";
  const queryStart = rawHash.indexOf("?");
  const hashPath = queryStart >= 0 ? rawHash.slice(0, queryStart) : rawHash;
  if (hashPath === "#manager") {
    return "events";
  }
  const route = routes.find((item) => item.path === hashPath);
  return route?.id ?? "events";
}

function PageHeader({
  route,
  currentUser,
  appName
}: {
  route: Route;
  currentUser: User | null;
  appName: string;
}) {
  return (
    <section className={`page-hero hero-${route.id}`} aria-labelledby={`${route.id}-title`}>
      <div className="hero-copy">
        <p className="eyebrow">{route.eyebrow}</p>
        <h1 id={`${route.id}-title`}>{route.title}</h1>
        <p>{route.description}</p>
        <div className="hero-highlights" aria-label="Bereichsfokus">
          <span>{appName}</span>
          <span>{route.label}</span>
          <span>{currentUser ? "Session aktiv" : "Gastmodus"}</span>
        </div>
      </div>
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
    </section>
  );
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activePage, setActivePage] = useState<PageId>(() => getPageFromHash());
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
      setActivePage(getPageFromHash());
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

    if (activePage === "admin") {
      return (
        <section className="admin-stage" aria-label="Admin Arbeitsbereich">
          <AdminPanel
            currentUser={currentUser}
            onSettingsChanged={(settings) => {
              setAppSettings(settings);
              applyTheme(settings);
            }}
          />
        </section>
      );
    }

    return <EventBoard currentUser={currentUser} mode={eventBoardMode} />;
  }

  return (
    <main className={`app-shell page-${activePage}`}>
      <header className="topbar" aria-label="Hauptnavigation">
        <a className="brand" href="#events" aria-label="Hermes Start">
          <img className="brand-mark" src="/icon.svg" alt="" />
          <span>{appSettings.appName}</span>
        </a>
        <nav className="nav-links">
          {routes.map((route) => (
            <a
              href={route.path}
              key={route.path}
              className={activePage === route.id ? "active" : undefined}
              aria-current={activePage === route.id ? "page" : undefined}
            >
              {route.id === "login" && currentUser ? "Profil" : route.label}
            </a>
          ))}
        </nav>
      </header>
      <div className="page-shell">
        <PageHeader route={displayRoute} currentUser={currentUser} appName={appSettings.appName} />
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
