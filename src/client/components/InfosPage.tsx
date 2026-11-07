import React, { useEffect, useState } from "react";
import type { MainEvent } from "../types/core";
import { requestJson } from "../api/request";
import { useI18n } from "../i18n/I18nContext";
import ReactMarkdown from "react-markdown";

/**
 * Erlaubt nur http(s), Hash-Fragmente und same-origin-relative Pfade (inkl. /absolut).
 * Blockiert u. a. javascript:, data:, und protocol-relative // URLs.
 */
function sanitizeMarkdownHref(href: string | undefined): string | undefined {
  if (href == null) {
    return undefined;
  }

  const trimmed = href.trim();
  if (trimmed === "") {
    return undefined;
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:")
  ) {
    return undefined;
  }

  if (trimmed.startsWith("#")) {
    return trimmed;
  }

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  if (/^[\w./\-]+$/.test(trimmed) && !trimmed.includes(":")) {
    return trimmed;
  }

  return undefined;
}

/** Markdown mit abgesicherten Links (nur http(s), Hash und same-origin). */
function MarkdownProse({ markdown }: { markdown: string }) {
  return (
    <div className="infos-prose">
        <ReactMarkdown
          components={{
            a: ({ href, children, node: _node, ...props }) => {
              const safe = sanitizeMarkdownHref(typeof href === "string" ? href : undefined);
              if (safe === undefined) {
                return <span className="text-link">{children}</span>;
              }

              const external = safe.startsWith("http://") || safe.startsWith("https://");
              return (
                <a
                  href={safe}
                  {...props}
                  rel={external ? "noopener noreferrer" : undefined}
                  target={external ? "_blank" : undefined}
                >
                  {children}
                </a>
              );
            }
          }}
        >
          {markdown}
        </ReactMarkdown>
    </div>
  );
}

/**
 * Seite „Infos“: oben die Infos zum gewählten aktuellen Event (globaler Umschalter), ohne Auswahl
 * die Infos aller laufenden Events, darunter die allgemeinen Infos aus dem Adminbereich.
 */
export function InfosPage({
  markdown,
  enabled,
  currentMainEventId = null
}: {
  markdown: string;
  enabled: boolean;
  currentMainEventId?: string | null;
}) {
  const { t } = useI18n();
  const [mainEvents, setMainEvents] = useState<MainEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    requestJson<{ mainEvents: MainEvent[] }>("/api/main-events")
      .then((result) => {
        if (!cancelled) setMainEvents(result?.mainEvents ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [currentMainEventId]);

  const current = mainEvents.find((entry) => entry.id === currentMainEventId && entry.status !== "ended");
  const eventInfos = (current ? [current] : mainEvents.filter((entry) => entry.status === "running")).filter(
    (entry) => entry.infosMarkdown?.trim()
  );
  const general = enabled ? markdown.trim() : "";

  if (eventInfos.length === 0 && !enabled) {
    return (
      <section className="access-panel" aria-label="Infos nicht verfügbar">
        <p className="eyebrow">Infos</p>
        <h2>Dieser Bereich ist deaktiviert.</h2>
        <p className="muted">Die Infos wurden vom Betreiber ausgeblendet.</p>
        <a className="text-link" href="#events">
          Zur Startseite
        </a>
      </section>
    );
  }

  if (eventInfos.length === 0 && !general) {
    return (
      <section className="access-panel" aria-label="Infos">
        <p className="eyebrow">Infos</p>
        <h2>Noch keine Inhalte.</h2>
        <p className="muted">Ein Admin kann Texte hier im Adminbereich unter „Infos“ hinterlegen.</p>
      </section>
    );
  }

  return (
    <>
      {eventInfos.map((entry) => (
        <article key={entry.id} className="event-card infos-page infos-page--event" aria-label={entry.name}>
          <h2>{t("infos.event.heading", { name: entry.name })}</h2>
          <MarkdownProse markdown={entry.infosMarkdown ?? ""} />
        </article>
      ))}
      {general ? (
        <article className="event-card infos-page" aria-label="Infos">
          {eventInfos.length > 0 ? <h2>{t("infos.general.heading")}</h2> : null}
          <MarkdownProse markdown={general} />
        </article>
      ) : null}
    </>
  );
}
