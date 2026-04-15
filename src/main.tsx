import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Route = {
  path: string;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
};

const routes: Route[] = [
  {
    path: "#events",
    label: "Events",
    eyebrow: "LAN-Abstimmung",
    title: "Was startet als Naechstes?",
    description:
      "Spielrunden sammeln Zusagen, zeigen sofort die Spielerzahl und halten Startzeit sowie Serverdaten an einem Ort."
  },
  {
    path: "#login",
    label: "Login",
    eyebrow: "Einmalcode",
    title: "Telefonnummer, Username, Mailcode.",
    description:
      "Der Login ist fuer mehrere Geraete vorbereitet, damit Smartphone und PC parallel aktiv bleiben koennen."
  },
  {
    path: "#manager",
    label: "Manager",
    eyebrow: "Eventsteuerung",
    title: "Neue Runden ohne Umwege anlegen.",
    description:
      "Manager koennen Spiel, Startzeit, min/max Spieler und optionale Verbindungsdaten vorbereiten."
  },
  {
    path: "#admin",
    label: "Admin",
    eyebrow: "Betrieb",
    title: "User, Manager und Einstellungen.",
    description:
      "Der Haupt-Admin verwaltet Rollen und persistente Einstellungen fuer Mail, Benachrichtigungen und Betrieb."
  }
];

function App() {
  return (
    <main className="app-shell">
      <header className="topbar" aria-label="Hauptnavigation">
        <a className="brand" href="#events" aria-label="Hermes Start">
          <span className="brand-mark">H</span>
          <span>Hermes</span>
        </a>
        <nav className="nav-links">
          {routes.map((route) => (
            <a href={route.path} key={route.path}>
              {route.label}
            </a>
          ))}
        </nav>
      </header>

      <section className="workbench" id="events">
        <div className="intro">
          <p className="eyebrow">Hermes</p>
          <h1>Spielrunden fuer die LAN-Party koordinieren.</h1>
          <p>
            Eine schnelle WebApp fuer 25 Personen: abstimmen, Startzeit sehen,
            Serverdaten finden und Benachrichtigungen auf allen angemeldeten
            Geraeten erhalten.
          </p>
        </div>

        <div className="event-preview" aria-label="Beispiel Event">
          <div className="event-header">
            <div>
              <p className="eyebrow">Sofort</p>
              <h2>Counter-Strike 2</h2>
            </div>
            <span className="status-pill">startbereit</span>
          </div>
          <dl className="event-stats">
            <div>
              <dt>Dabei</dt>
              <dd>7 / 10</dd>
            </div>
            <div>
              <dt>Minimum</dt>
              <dd>5</dd>
            </div>
            <div>
              <dt>Server</dt>
              <dd>lan-host:27015</dd>
            </div>
          </dl>
          <div className="action-row">
            <button type="button">Dabei</button>
            <button type="button" className="secondary">
              Nicht dabei
            </button>
          </div>
        </div>
      </section>

      <section className="route-grid" aria-label="Vorbereitete Bereiche">
        {routes.slice(1).map((route) => (
          <article id={route.path.slice(1)} className="route-card" key={route.path}>
            <p className="eyebrow">{route.eyebrow}</p>
            <h2>{route.title}</h2>
            <p>{route.description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
