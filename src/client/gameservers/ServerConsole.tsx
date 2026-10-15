import { FormEvent, useEffect, useRef, useState } from "react";
import { requestJson } from "../api/request";
import { getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";

type ConsoleLine = { seq: number; ts: string; source: string; text: string };

const POLL_MS = 5_000;
const MAX_LINES = 300;

/** Konsole einer gebundenen Instanz (nur manager+). Pollt nur, solange sie gerendert ist. */
export function ServerConsole({ bindingId }: { bindingId: string }) {
  const { t, locale } = useI18n();
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [error, setError] = useState("");
  const [command, setCommand] = useState("");
  const [sending, setSending] = useState(false);
  const cursorRef = useRef(0);
  const outputRef = useRef<HTMLPreElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    cursorRef.current = 0;
    setLines([]);

    async function pull() {
      try {
        const result = await requestJson<{ lines: ConsoleLine[]; cursor: number }>(
          `/api/integrations/amp/instances/${encodeURIComponent(bindingId)}/console?since=${cursorRef.current}`
        );
        if (cancelled) return;
        cursorRef.current = result.cursor;
        if (result.lines.length > 0) {
          setLines((prev) => [...prev, ...result.lines].slice(-MAX_LINES));
        }
        setError("");
      } catch (caught) {
        if (!cancelled) setError(getErrorMessage(caught, locale));
      }
    }

    void pull();
    const timer = window.setInterval(() => void pull(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [bindingId, locale]);

  useEffect(() => {
    const el = outputRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  function onScroll() {
    const el = outputRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      await requestJson(`/api/integrations/amp/instances/${encodeURIComponent(bindingId)}/console`, {
        method: "POST",
        body: JSON.stringify({ command: trimmed })
      });
      setCommand("");
      setError("");
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="server-console" aria-label={t("events.server.console")}>
      <pre ref={outputRef} className="server-console-output" onScroll={onScroll} tabIndex={0}>
        {lines.length === 0
          ? t("events.server.consoleEmpty")
          : lines.map((line) => `${line.text}\n`).join("")}
      </pre>
      <form className="server-console-input" onSubmit={(event) => void send(event)}>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          maxLength={200}
          placeholder={t("events.server.consolePlaceholder")}
          aria-label={t("events.server.consolePlaceholder")}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="secondary" disabled={sending || !command.trim()}>
          {t("events.server.consoleSend")}
        </button>
      </form>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
