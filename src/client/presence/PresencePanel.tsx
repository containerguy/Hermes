import React, { useCallback, useEffect, useState } from "react";
import { requestJson } from "../api/request";
import { useI18n } from "../i18n/I18nContext";
import { groupByGame, LAUNCHER_LABELS, type PresencePlayer } from "./presence-model";

/** Agent meldet alle 30 s; die Seite fragt etwas häufiger nach. */
export const PRESENCE_REFRESH_MS = 20_000;

/** Startdatei für Windows: liegt neben der .exe, startet den Agenten mit Server und Token. */
export function buildStartFile(origin: string, token: string) {
  return [
    "@echo off",
    "title Spielt gerade",
    'cd /d "%~dp0"',
    `hermes-game-agent.exe -server ${origin} -token ${token} -interval 30s`,
    "pause",
    ""
  ].join("\r\n");
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatTime(iso: string, locale: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

export function PresencePanel() {
  const { t, locale } = useI18n();
  const [players, setPlayers] = useState<PresencePlayer[] | null>(null);
  const [error, setError] = useState(false);
  const [agentAvailable, setAgentAvailable] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [setupState, setSetupState] = useState<"idle" | "busy" | "error">("idle");

  const load = useCallback(async () => {
    try {
      const body = await requestJson<{ players: PresencePlayer[]; agentAvailable?: boolean }>("/api/presence");
      setPlayers(body.players);
      setAgentAvailable(Boolean(body.agentAvailable));
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), PRESENCE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function createToken() {
    setSetupState("busy");
    try {
      const created = await requestJson<{ token: string }>("/api/auth/api-tokens", {
        method: "POST",
        body: JSON.stringify({ scope: "full", label: "Spielt gerade (Agent)" })
      });
      setToken(created.token);
      setSetupState("idle");
    } catch {
      setSetupState("error");
    }
  }

  const groups = players ? groupByGame(players) : [];
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <section className="presence-panel" aria-label={t("presence.aria")}>
      {error ? <p className="error">{t("presence.error")}</p> : null}
      {!players && !error ? <p className="muted">{t("presence.loading")}</p> : null}
      {players && groups.length === 0 ? <p className="muted">{t("presence.empty")}</p> : null}
      {groups.length > 0 ? (
        <ul className="presence-list">
          {groups.map((group) => (
            <li key={group.title} className="presence-game">
              <div className="presence-game-header">
                <strong>{group.title}</strong>
                <span className="muted">
                  {[LAUNCHER_LABELS[group.launcher], t("presence.count", { count: group.players.length })]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <ul className="presence-players">
                {group.players.map((entry) => (
                  <li key={entry.userId}>
                    {entry.name}{" "}
                    <span className="muted">{t("presence.since", { time: formatTime(entry.since, locale) })}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
      <details className="presence-setup">
        <summary>{t("presence.setup.title")}</summary>
        <p className="muted">{t("presence.setup.privacy")}</p>
        {agentAvailable ? (
          <>
            <p className="muted">{t("presence.setup.steps")}</p>
            <div className="action-row">
              <a className="button-link" href="/api/presence/agent/download" download>
                {t("presence.setup.download")}
              </a>
              {token ? (
                <button
                  type="button"
                  onClick={() => downloadText("spielt-gerade-starten.cmd", buildStartFile(origin, token))}
                >
                  {t("presence.setup.startFile")}
                </button>
              ) : (
                <button type="button" disabled={setupState === "busy"} onClick={() => void createToken()}>
                  {setupState === "busy" ? t("presence.setup.creating") : t("presence.setup.create")}
                </button>
              )}
            </div>
            {setupState === "error" ? <p className="error">{t("presence.setup.createError")}</p> : null}
            {token ? <p className="muted">{t("presence.setup.tokenNote")}</p> : null}
            <p className="muted">{t("presence.setup.smartscreen")}</p>
          </>
        ) : (
          <p className="muted">{t("presence.setup.noAgent")}</p>
        )}
      </details>
    </section>
  );
}
