import React, { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type User = {
  id: string;
  phoneNumber: string;
  username: string;
  email: string;
  role: "user" | "manager" | "admin";
  notificationsEnabled: boolean;
};

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

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    },
    ...options
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "request_failed");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function LoginPanel({
  currentUser,
  onLoggedIn,
  onLoggedOut
}: {
  currentUser: User | null;
  onLoggedIn: (user: User) => void;
  onLoggedOut: () => void;
}) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [step, setStep] = useState<"request" | "verify">("request");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson("/api/auth/request-code", {
        method: "POST",
        body: JSON.stringify({ phoneNumber, username })
      });
      setStep("verify");
      setMessage("Code wurde per E-Mail versendet.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "request_failed");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await requestJson<{ user: User }>("/api/auth/verify-code", {
        method: "POST",
        body: JSON.stringify({ phoneNumber, username, code, deviceName })
      });
      onLoggedIn(result.user);
      setCode("");
      setMessage("Angemeldet.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "request_failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError("");
    await requestJson<void>("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    onLoggedOut();
    setStep("request");
    setMessage("Abgemeldet.");
    setBusy(false);
  }

  if (currentUser) {
    return (
      <section className="login-panel" id="login" aria-label="Aktuelle Anmeldung">
        <p className="eyebrow">Angemeldet</p>
        <h2>{currentUser.username}</h2>
        <dl className="account-list">
          <div>
            <dt>Rolle</dt>
            <dd>{currentUser.role}</dd>
          </div>
          <div>
            <dt>E-Mail</dt>
            <dd>{currentUser.email}</dd>
          </div>
        </dl>
        <button type="button" className="secondary" onClick={logout} disabled={busy}>
          Logout
        </button>
      </section>
    );
  }

  return (
    <section className="login-panel" id="login" aria-label="Login">
      <p className="eyebrow">Login</p>
      <h2>{step === "request" ? "Einmalcode anfordern." : "Code eingeben."}</h2>
      <form onSubmit={step === "request" ? requestCode : verifyCode}>
        <label>
          Telefonnummer
          <input
            autoComplete="tel"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
            required
          />
        </label>
        <label>
          Username
          <input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </label>
        {step === "verify" ? (
          <>
            <label>
              Einmalcode
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </label>
            <label>
              Geraetename
              <input
                placeholder="PC, Smartphone, Laptop"
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
              />
            </label>
          </>
        ) : null}
        {message ? <p className="notice">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <div className="action-row">
          {step === "verify" ? (
            <button type="button" className="secondary" onClick={() => setStep("request")}>
              Zurueck
            </button>
          ) : null}
          <button type="submit" disabled={busy}>
            {step === "request" ? "Code senden" : "Einloggen"}
          </button>
        </div>
      </form>
    </section>
  );
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    requestJson<{ user: User }>("/api/auth/me")
      .then((result) => setCurrentUser(result.user))
      .catch(() => setCurrentUser(null));
  }, []);

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
        <LoginPanel
          currentUser={currentUser}
          onLoggedIn={setCurrentUser}
          onLoggedOut={() => setCurrentUser(null)}
        />
        {routes.slice(2).map((route) => (
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
