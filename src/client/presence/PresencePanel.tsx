import React, { useCallback, useEffect, useState } from "react";
import { requestJson } from "../api/request";
import { useI18n } from "../i18n/I18nContext";
import { groupByGame, LAUNCHER_LABELS, type PresencePlayer } from "./presence-model";

/** Agent meldet alle 30 s; die Seite fragt etwas häufiger nach. */
export const PRESENCE_REFRESH_MS = 20_000;

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

  const load = useCallback(async () => {
    try {
      const body = await requestJson<{ players: PresencePlayer[] }>("/api/presence");
      setPlayers(body.players);
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
        <p className="muted">{t("presence.setup.body")}</p>
        <pre>
          <code>{`hermes-game-agent.exe -server ${origin} -token <API-Token> -interval 30s`}</code>
        </pre>
        <p className="muted">{t("presence.setup.privacy")}</p>
      </details>
    </section>
  );
}
