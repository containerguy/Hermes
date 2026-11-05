import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Die Inhaltskarte (`.page-card`) gestaltet jedes <details> als aufklappbaren Abschnitt:
 * Trennlinie darüber, fette Überschrift, „›“ davor. `MoreMenu` ist technisch auch ein
 * <details>, soll aber ein Knopf bleiben — die Kartenregeln nehmen es deshalb mit
 * `:not(.more-menu)` aus. Solange `MoreMenu` in keiner Karte steckt, fällt ein Rückfall
 * niemandem auf; dieser Test hält die Ausnahme fest, auch für neu hinzukommende Regeln.
 * Wie es gerendert aussieht, prüft `e2e/karte-bausteine.spec.ts` im echten Browser.
 */

const css = fs.readFileSync(path.join(process.cwd(), "src/styles.css"), "utf8");

/** Einzelne Selektoren des Stylesheets; Kommentare und @media-Klammern fallen weg. */
function selektoren() {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{}]*)\{[^{}]*\}/g)]
    .flatMap(([, list]) => list.split(","))
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0 && !selector.startsWith("@"));
}

describe("MoreMenu in einer Inhaltskarte", () => {
  it("wird von allen <details>-Regeln der Karte ausgenommen", () => {
    const kartenRegeln = selektoren().filter(
      (selector) => selector.startsWith(".page-card") && /\bdetails\b/.test(selector)
    );

    // Die Karte gestaltet Aufklapp-Abschnitte überhaupt; sonst prüft der Test nichts.
    expect(kartenRegeln.length).toBeGreaterThan(0);

    const ohneAusnahme = kartenRegeln.filter((selector) => !selector.includes(":not(.more-menu)"));
    expect(ohneAusnahme).toEqual([]);
  });

  it("bringt seine eigene Knopfform mit", () => {
    const alle = selektoren();
    expect(alle).toContain(".more-menu > summary");
    expect(alle).toContain(".more-menu__list");
  });
});
