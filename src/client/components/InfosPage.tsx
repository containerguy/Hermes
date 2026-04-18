import React from "react";
import ReactMarkdown from "react-markdown";

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
            a: ({ href, children, ...props }) => (
              <a
                href={href}
                {...props}
                rel="noopener noreferrer"
                target={
                  href?.startsWith("http://") || href?.startsWith("https://") ? "_blank" : undefined
                }
              >
                {children}
              </a>
            )
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </article>
  );
}
