import { FormEvent, useEffect, useRef, useState } from "react";
import { requestJson } from "../api/request";
import { getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import { commandSetForGame, firstPlaceholder, localize } from "./command-presets";

type ConsoleLine = { seq: number; ts: string; source: string; text: string };

const POLL_MS = 5_000;
const MAX_LINES = 300;

/** Konsole einer gebundenen Instanz (nur manager+). Pollt nur, solange sie gerendert ist. */
export function ServerConsole({
  bindingId,
  game = null,
  host = ""
}: {
  bindingId: string;
  game?: string | null;
  host?: string;
}) {
  const { t, locale } = useI18n();
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [error, setError] = useState("");
  const [command, setCommand] = useState("");
  const [sending, setSending] = useState(false);
  const [presetNote, setPresetNote] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const commandSet = commandSetForGame(game);
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

  function applyPreset(value: string) {
    if (!commandSet || !value) return;
    const [groupIndex, presetIndex] = value.split(":").map(Number);
    const preset = commandSet.groups[groupIndex]?.presets[presetIndex];
    if (!preset) return;
    setCommand(preset.command);
    setPresetNote(preset.note ? localize(preset.note, locale) : "");
    // Platzhalter wie <name> markieren, damit man ihn direkt überschreibt
    window.setTimeout(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const placeholder = firstPlaceholder(preset.command);
      if (placeholder) input.setSelectionRange(placeholder.start, placeholder.end);
      else input.setSelectionRange(preset.command.length, preset.command.length);
    }, 0);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      await requestJson(`/api/integrations/amp/instances/${encodeURIComponent(bindingId)}/console`, {
        method: "POST",
        body: JSON.stringify({ command: trimmed, split: commandSet?.splitCommands === true })
      });
      setCommand("");
      setPresetNote("");
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
      {commandSet?.hint || commandSet?.webAdminPort ? (
        <p className="muted server-console-hint">
          {commandSet.hint ? localize(commandSet.hint, locale) : null}
          {commandSet.webAdminPort && host ? (
            <>
              {" "}
              <a href={`http://${host}:${commandSet.webAdminPort}`} target="_blank" rel="noreferrer">
                {t("events.server.webAdmin")}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {commandSet && commandSet.groups.length > 0 ? (
        <select
          className="server-console-presets"
          value=""
          onChange={(event) => applyPreset(event.target.value)}
          aria-label={t("events.server.consolePresets", { game: commandSet.name })}
        >
          <option value="">{t("events.server.consolePresets", { game: commandSet.name })}</option>
          {commandSet.groups.map((group, groupIndex) => (
            <optgroup key={groupIndex} label={localize(group.label, locale)}>
              {group.presets.map((preset, presetIndex) => (
                <option key={presetIndex} value={`${groupIndex}:${presetIndex}`}>
                  {localize(preset.label, locale)} — {preset.command}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      ) : null}
      <form className="server-console-input" onSubmit={(event) => void send(event)}>
        <input
          ref={inputRef}
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
      {presetNote ? <p className="muted server-console-hint">{presetNote}</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
