import React from "react";
import type { AppSettings, User } from "../types/core";
import { LoginPanel } from "./LoginPanel";

export function LoginPage({
  currentUser,
  settings,
  onLoggedIn,
  onLoggedOut,
  onUserUpdated
}: {
  currentUser: User | null;
  settings: AppSettings;
  onLoggedIn: (user: User) => void;
  onLoggedOut: () => void;
  onUserUpdated: (user: User) => void;
}) {
  return (
    <section
      className={`auth-layout${currentUser ? " auth-layout--profile" : ""}`}
      aria-label={currentUser ? "Profil Arbeitsbereich" : "Login Arbeitsbereich"}
    >
      <LoginPanel
        currentUser={currentUser}
        settings={settings}
        onLoggedIn={onLoggedIn}
        onLoggedOut={onLoggedOut}
        onUserUpdated={onUserUpdated}
      />
      {currentUser ? null : (
        <aside className="auth-visual" aria-label="Login Hinweise">
          <img src="/icon.svg" alt="" />
          <p className="eyebrow">Mailcode</p>
          <h2>Ein Login, mehrere Geräte.</h2>
          <p>
            Username eingeben, Code aus der E-Mail nutzen und Smartphone sowie PC parallel angemeldet
            lassen.
          </p>
          <dl className="signal-list">
            <div>
              <dt>Default</dt>
              <dd>Push aktiv</dd>
            </div>
            <div>
              <dt>Code</dt>
              <dd>6 Stellen</dd>
            </div>
          </dl>
        </aside>
      )}
    </section>
  );
}

