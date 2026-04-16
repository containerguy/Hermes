import React, { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import type {
  AppSettings,
  AuditLogEntry,
  GameEvent,
  InviteCode,
  RateLimitAllowlistEntry,
  RateLimitEntry,
  RestoreDiagnostics,
  RestoreRecovery,
  StorageInfo,
  User,
  UserSession
} from "./client/types/core";
import { requestJson } from "./client/api/request";
import { clearCsrfToken, primeCsrfToken } from "./client/api/csrf";
import { ApiError, errorMessages, getErrorMessage } from "./client/errors/errors";
import { EventBoard } from "./client/components/EventBoard";
import { ManagerPage } from "./client/components/ManagerPage";
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

type PageId = "events" | "login" | "manager" | "admin";

const routes: Route[] = [
  {
    id: "events",
    path: "#events",
    label: "Events",
    eyebrow: "LAN-Abstimmung",
    title: "Was startet als Nächstes?",
    description:
      "Spielrunden sammeln Zusagen, zeigen sofort die Spielerzahl und halten Startzeit sowie Serverdaten an einem Ort."
  },
  {
    id: "login",
    path: "#login",
    label: "Login",
    eyebrow: "Einmalcode",
    title: "Username und Mailcode.",
    description:
      "Der Login ist für mehrere Geräte vorbereitet, damit Smartphone und PC parallel aktiv bleiben können."
  },
  {
    id: "manager",
    path: "#manager",
    label: "Manager",
    eyebrow: "Eventsteuerung",
    title: "Neue Runden ohne Umwege anlegen.",
    description:
      "Manager können Spiel, Startzeit, min/max Spieler und optionale Verbindungsdaten vorbereiten."
  },
  {
    id: "admin",
    path: "#admin",
    label: "Admin",
    eyebrow: "Betrieb",
    title: "User, Manager und Einstellungen.",
    description:
      "Der Haupt-Admin verwaltet Rollen und persistente Einstellungen für Mail, Benachrichtigungen und Betrieb."
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
}

function getPageFromHash(): PageId {
  const route = routes.find((item) => item.path === window.location.hash);
  return route?.id ?? "events";
}

function PageHeader({ route, currentUser }: { route: Route; currentUser: User | null }) {
  return (
    <section className={`page-hero hero-${route.id}`} aria-labelledby={`${route.id}-title`}>
      <div className="hero-copy">
        <p className="eyebrow">{route.eyebrow}</p>
        <h1 id={`${route.id}-title`}>{route.title}</h1>
        <p>{route.description}</p>
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
          eyebrow: "Profil",
          title: "Profil und Geräte.",
          description:
            "Verwalte deine Anmeldung, Notifications und alle Geräte, die mit deinem Account aktiv sind."
        }
      : activeRoute;

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

    if (activePage === "manager") {
      return <ManagerPage currentUser={currentUser} />;
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

    return <EventBoard currentUser={currentUser} mode="events" />;
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
        <PageHeader route={displayRoute} currentUser={currentUser} />
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
