import { useState } from "react";
import { requestJson } from "../api/request";
import { getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import {
  MAX_BOTS_ADD,
  type BotKind,
  type BotLevel,
  type BotRequest,
  type BotTeam
} from "../../shared/bot-commands";

const LEVELS: BotLevel[] = ["easy", "normal", "hard", "expert"];
const TEAMS: BotTeam[] = ["auto", "t", "ct"];

/** Bots per Bedienelement (nur manager+): Hermes baut die Konsolenbefehle serverseitig. */
export function ServerBots({ bindingId, kind }: { bindingId: string; kind: BotKind }) {
  const { t, locale } = useI18n();
  const [count, setCount] = useState(5);
  const [level, setLevel] = useState<BotLevel>("normal");
  const [team, setTeam] = useState<BotTeam>("auto");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [bots, setBots] = useState<number | null | undefined>(undefined);

  const validCount = Number.isInteger(count) && count >= 1 && count <= MAX_BOTS_ADD;

  async function send(request: BotRequest) {
    setSending(true);
    setNotice("");
    setError("");
    try {
      await requestJson(`/api/integrations/amp/instances/${encodeURIComponent(bindingId)}/bots`, {
        method: "POST",
        body: JSON.stringify(request)
      });
      setNotice(t("events.server.bots.sent"));
      setBots(undefined);
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setSending(false);
    }
  }

  async function countBots() {
    setSending(true);
    setError("");
    try {
      const result = await requestJson<{ bots: number | null }>(
        `/api/integrations/amp/instances/${encodeURIComponent(bindingId)}/bots`
      );
      setBots(result.bots);
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setSending(false);
    }
  }

  function removeAll() {
    if (window.confirm(t("events.server.bots.confirmRemoveAll"))) {
      void send({ action: "removeAll" });
    }
  }

  return (
    <div className="server-bots" aria-label={t("events.server.bots.title")}>
      <div className="server-bots-fields">
        <label>
          {t("events.server.bots.count")}
          <input
            type="number"
            min={1}
            max={MAX_BOTS_ADD}
            value={Number.isFinite(count) ? count : ""}
            onChange={(event) => setCount(Number.parseInt(event.target.value, 10))}
          />
        </label>
        <label>
          {t("events.server.bots.level")}
          <select value={level} onChange={(event) => setLevel(event.target.value as BotLevel)}>
            {LEVELS.map((value) => (
              <option key={value} value={value}>
                {t(`events.server.bots.level.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("events.server.bots.team")}
          <select value={team} onChange={(event) => setTeam(event.target.value as BotTeam)}>
            {TEAMS.map((value) => (
              <option key={value} value={value}>
                {t(`events.server.bots.team.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="server-actions">
        <button
          type="button"
          className="secondary"
          disabled={sending || !validCount}
          onClick={() => void send({ action: "add", count, level, team })}
        >
          {t("events.server.bots.add")}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={sending || !validCount}
          onClick={() => void send({ action: "fill", count, level })}
        >
          {t("events.server.bots.fill", { count: validCount ? count : "–" })}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={sending}
          onClick={() => void send({ action: "setLevel", level })}
        >
          {t("events.server.bots.setLevel")}
        </button>
        <button type="button" className="secondary danger" disabled={sending} onClick={removeAll}>
          {t("events.server.bots.removeAll")}
        </button>
        <button type="button" className="secondary" disabled={sending} onClick={() => void countBots()}>
          {t("events.server.bots.count.refresh")}
        </button>
      </div>
      {bots !== undefined ? (
        <p className="server-console-hint">
          {bots === null ? t("events.server.bots.count.unknown") : t("events.server.bots.count.value", { count: bots })}
        </p>
      ) : null}
      <p className="muted server-console-hint">
        {kind === "cs2" ? t("events.server.bots.hintCs2") : t("events.server.bots.hintYapb")}
      </p>
      {sending ? (
        <p className="muted server-console-hint" role="status">
          {t("events.server.bots.running")}
        </p>
      ) : notice ? (
        <p className="muted server-console-hint">{notice}</p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
