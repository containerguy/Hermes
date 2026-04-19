import React from "react";
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

export function InfosPage({ markdown, enabled }: { markdown: string; enabled: boolean }) {
  if (!enabled) {
    return (
      <section className="access-panel" aria-label="Infos nicht verfügbar">
        <p className="eyebrow">Infos</p>
        <h2>Dieser Bereich ist deaktiviert.</h2>
        <p className="muted">Der Menüpunkt Infos wurde vom Betreiber ausgeblendet.</p>
        <a className="text-link" href="#events">
          Zur Startseite
        </a>
      </section>
    );
  }

  const trimmed = markdown.trim();
  if (!trimmed) {
    return (
      <section className="access-panel" aria-label="Infos">
        <p className="eyebrow">Infos</p>
        <h2>Noch keine Inhalte.</h2>
        <p className="muted">Ein Admin kann Texte hier im Adminbereich unter „Infos“ hinterlegen.</p>
      </section>
    );
  }

  return (
    <article className="event-card infos-page" aria-label="Infos">
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
    </article>
  );
}
