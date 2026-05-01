import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { copyToClipboard } from "./clipboard";
import { generateCod4Key } from "./generateCod4Key";

type CopyStatus = "idle" | "ok" | "error";

export function Cod4KeyGenerator() {
  const { t } = useI18n();
  const [key, setKey] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outputRef = useRef<HTMLOutputElement | null>(null);
  const headingId = "cod4-section-heading";

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) clearTimeout(clearTimerRef.current);
    };
  }, []);

  function handleGenerate() {
    setKey(generateCod4Key());
    setCopyStatus("idle");
  }

  function handleRegenerate() {
    setKey(generateCod4Key());
    setCopyStatus("idle");
    if (clearTimerRef.current !== null) clearTimeout(clearTimerRef.current);
  }

  async function handleCopy() {
    if (!key) return;
    if (clearTimerRef.current !== null) clearTimeout(clearTimerRef.current);
    const ok = await copyToClipboard(key);
    if (!ok && outputRef.current) {
      // UI-SPEC accessibility contract: auto-select <output> on copy failure so user can manual ⌘C / Ctrl+C
      outputRef.current.focus();
      try {
        const range = document.createRange();
        range.selectNodeContents(outputRef.current);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch {
        /* selection may fail in non-DOM test envs — non-fatal */
      }
    }
    setCopyStatus(ok ? "ok" : "error");
    clearTimerRef.current = setTimeout(() => setCopyStatus("idle"), 2500);
  }

  const statusClass =
    copyStatus === "ok"
      ? "cod4-copy-status cod4-copy-status--ok"
      : copyStatus === "error"
        ? "cod4-copy-status cod4-copy-status--error"
        : "cod4-copy-status";

  const statusText =
    copyStatus === "ok"
      ? t("events.cod4.copied")
      : copyStatus === "error"
        ? t("events.cod4.copyFailed")
        : "";

  return (
    <section className="cod4-section" aria-labelledby={headingId}>
      <h3 id={headingId} className="cod4-section__heading">
        {t("events.cod4.heading")}
      </h3>

      {key === null ? (
        <button type="button" onClick={handleGenerate}>
          {t("events.cod4.generate")}
        </button>
      ) : (
        <>
          <output ref={outputRef} tabIndex={-1} className="cod4-key-output">{key}</output>
          <div className="cod4-key-actions">
            <button type="button" className="secondary" onClick={handleCopy}>
              {t("events.cod4.copy")}
            </button>
            <button type="button" className="secondary" onClick={handleRegenerate}>
              {t("events.cod4.regenerate")}
            </button>
            <span role="status" aria-live="polite" className={statusClass}>
              {statusText}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
