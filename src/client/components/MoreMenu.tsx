import React, { useEffect, useRef } from "react";

/**
 * Knopf „Mehr“ mit einer kleinen Liste weiterer Aktionen. So bleibt pro Zeile höchstens eine
 * Handvoll Knöpfe sichtbar, und die Zeilen sehen überall gleich aus. Schließt bei Klick daneben,
 * Escape oder nach Auswahl einer Aktion.
 */
export function MoreMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function close(event: Event) {
      const details = ref.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") details.open = false;
        return;
      }
      if (!details.contains(event.target as Node)) details.open = false;
    }
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className="more-menu">
      <summary className="button-link secondary">
        {label} <span aria-hidden="true">▾</span>
      </summary>
      <div
        className="more-menu__list"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button, a") && ref.current) ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
