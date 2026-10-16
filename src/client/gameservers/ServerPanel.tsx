import { useEffect, useRef, useState } from "react";
import { copyToClipboard } from "../cod4/clipboard";
import { useI18n } from "../i18n/I18nContext";
import type { ServerStatus } from "../types/core";
import { buildConnectAction } from "./connect-link";
import { botKindForGame } from "../../shared/bot-commands";
import { ServerBots } from "./ServerBots";
import { ServerConsole } from "./ServerConsole";

export type ServerAction = "start" | "stop" | "restart" | "update" | "kill";

/** Alles, was die Event-Karte über den gebundenen Server wissen muss (Phase 15, D-12). */
export type ServerPanelBinding = {
  bindingId: string;
  status: ServerStatus | null;
  canManage: boolean;
  busy: boolean;
  onAction: (action: ServerAction) => void;
};

type DotState = "off" | "starting" | "on" | "sleep" | "error";

function dotState(status: ServerStatus | null): DotState {
  if (!status) return "off";
  if (status.error) return "error";
  if (status.appState === "Sleeping" || status.appState === "PreparingForSleep") return "sleep";
  if (status.running) return "on";
  if (["Starting", "Restarting", "PreStart", "Configuring", "Installing", "Updating"].includes(status.appState)) {
    return "starting";
  }
  return "off";
}

export function ServerPanel({ bindingId, status, canManage, busy, onAction }: ServerPanelBinding) {
  const { t } = useI18n();
  const [copyStatus, setCopyStatus] = useState<"idle" | "ok" | "error">("idle");
  const [moreOpen, setMoreOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [botsOpen, setBotsOpen] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    };
  }, []);

  const state = dotState(status);
  const stateLabel = !status
    ? t("events.server.status.loading")
    : state === "on"
      ? t("events.server.status.on")
      : state === "sleep"
        ? t("events.server.status.sleep")
      : state === "starting"
        ? t("events.server.status.starting")
        : state === "error"
          ? t("events.server.status.error")
          : t("events.server.status.off");
  const connect = status ? buildConnectAction(status) : null;
  const botKind = botKindForGame(status?.game);
  // Spiel-Update nur bei angehaltenem Spiel (sonst verwaist AMP den Spielprozess)
  const updateAllowed = status?.appState === "Stopped" || status?.appState === "Failed";
  // Start/Stopp nur, wenn sie im aktuellen Zustand etwas bewirken (AMP lehnt sonst ab)
  const startAllowed = !status || (state !== "on" && state !== "starting");
  const stopAllowed = !status || status.appState !== "Stopped";

  async function copy(text: string) {
    const ok = await copyToClipboard(text);
    setCopyStatus(ok ? "ok" : "error");
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyStatus("idle"), 2_000);
  }

  function confirmKill() {
    if (window.confirm(t("events.server.confirmKill"))) {
      onAction("kill");
    }
  }

  return (
    <section className="server-panel" aria-label={t("events.server.title")}>
      <div className="server-panel-head">
        <span className={`server-dot server-dot--${state}`} aria-hidden="true" />
        <span className="server-state">
          {stateLabel}
          {status && state !== "sleep" && status.appState !== "Ready" && status.appState !== "Stopped" && status.appState !== "Undefined"
            ? ` · ${status.appState}`
            : ""}
        </span>
        {status && status.players !== null ? (
          <span className="server-players">
            {t("events.server.players", {
              players: status.players,
              max: status.maxPlayers ?? "–"
            })}
          </span>
        ) : null}
      </div>

      {connect ? (
        <div className="server-connect">
          {connect.kind === "link" ? (
            <a className="button-link" href={connect.href}>
              {t("events.server.connect")}
            </a>
          ) : null}
          <code className="server-endpoint">{connect.text}</code>
          <button type="button" className="secondary" onClick={() => void copy(connect.text)}>
            {copyStatus === "ok"
              ? t("events.server.copied")
              : copyStatus === "error"
                ? t("events.server.copyFailed")
                : t("events.server.copy")}
          </button>
        </div>
      ) : null}

      {status?.error ? <p className="muted">{t("events.server.statusHint")}</p> : null}

      {canManage ? (
        <div className="server-actions">
          <button type="button" className="secondary" disabled={busy || !startAllowed} onClick={() => onAction("start")}>
            {t("events.server.start")}
          </button>
          <button type="button" className="secondary" disabled={busy || !stopAllowed} onClick={() => onAction("stop")}>
            {t("events.server.stop")}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => onAction("restart")}>
            {t("events.server.restart")}
          </button>
          <button
            type="button"
            className="secondary"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          >
            {t("events.server.more")}
          </button>
          {moreOpen ? (
            <>
              {!updateAllowed ? <span className="muted server-console-hint">{t("events.server.updateNeedsStop")}</span> : null}
              <button
                type="button"
                className="secondary"
                disabled={busy || !updateAllowed}
                title={updateAllowed ? undefined : t("events.server.updateNeedsStop")}
                onClick={() => onAction("update")}
              >
                {t("events.server.update")}
              </button>
              <button type="button" className="secondary danger" disabled={busy} onClick={confirmKill}>
                {t("events.server.kill")}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="secondary"
            aria-expanded={consoleOpen}
            onClick={() => setConsoleOpen((open) => !open)}
          >
            {consoleOpen ? t("events.server.consoleHide") : t("events.server.console")}
          </button>
          {botKind ? (
            <button
              type="button"
              className="secondary"
              aria-expanded={botsOpen}
              onClick={() => setBotsOpen((open) => !open)}
            >
              {botsOpen ? t("events.server.bots.hide") : t("events.server.bots.title")}
            </button>
          ) : null}
        </div>
      ) : null}

      {canManage && botsOpen && botKind ? <ServerBots bindingId={bindingId} kind={botKind} /> : null}
      {canManage && consoleOpen ? <ServerConsole bindingId={bindingId} game={status?.game ?? null} host={status?.host ?? ""} /> : null}
    </section>
  );
}
