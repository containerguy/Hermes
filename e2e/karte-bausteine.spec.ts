import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

/*
 * Bausteine in einer Inhaltskarte (`.page-card`) — reiner Stiltest ohne Server.
 * Die Karte gestaltet jedes <details> als aufklappbaren Abschnitt (Trennlinie, fette
 * Überschrift, „›“). Das „Mehr“-Menü ist technisch auch ein <details>, soll aber ein
 * Knopf bleiben. Dieser Test hält beides auseinander, damit Module `MoreMenu` in einer
 * Karte benutzen können, ohne ein „› Mehr ▾“ mit Trennlinie zu bekommen.
 */

const stylesPath = path.join(process.cwd(), "src/styles.css");

/** Markup wie `MoreMenu` (src/client/components/MoreMenu.tsx) es erzeugt, in einer Karte. */
const markup = `
<div class="page-card">
  <div class="device-actions">
    <button class="secondary">Bearbeiten</button>
    <details class="more-menu" id="mehr">
      <summary class="button-link secondary">Mehr <span aria-hidden="true">▾</span></summary>
      <div class="more-menu__list"><button class="secondary danger">Entfernen</button></div>
    </details>
  </div>
  <details id="abschnitt">
    <summary>Erweiterte Einstellungen</summary>
    <p>Inhalt</p>
  </details>
</div>`;

const widths = [
  { name: "Desktop", viewport: { width: 1440, height: 900 } },
  { name: "Handy", viewport: { width: 390, height: 844 } }
];

test.describe("Bausteine in einer Inhaltskarte", () => {
  test("Markup von MoreMenu benutzt weiterhin .more-menu und .button-link", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/client/components/MoreMenu.tsx"), "utf8");
    expect(source).toContain('className="more-menu"');
    expect(source).toContain('className="button-link secondary"');
  });

  for (const { name, viewport } of widths) {
    test(`${name}: „Mehr“ bleibt ein Knopf, der Abschnitt behält Trennlinie und Pfeil`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.setContent(markup);
      await page.addStyleTag({ path: stylesPath });

      const mehr = page.locator("#mehr");
      const mehrGriff = mehr.locator("> summary");

      // Keine Trennlinie über dem „Mehr“-Knopf und kein Abstand darüber.
      await expect(mehr).toHaveCSS("border-top-width", "0px");
      await expect(mehr).toHaveCSS("padding-top", "0px");

      // Kein „›“ vor der Beschriftung.
      const pfeil = await mehrGriff.evaluate(
        (element) => window.getComputedStyle(element, "::before").content
      );
      expect(pfeil).toBe("none");

      // Der Griff sieht aus wie die Knöpfe daneben: gleiche Höhe, nicht über die ganze Karte.
      const nachbar = page.locator(".device-actions > button");
      const griffKasten = await mehrGriff.boundingBox();
      const nachbarKasten = await nachbar.boundingBox();
      const karteKasten = await page.locator(".page-card").boundingBox();
      expect(griffKasten!.height).toBeCloseTo(nachbarKasten!.height, 0);
      expect(griffKasten!.width).toBeLessThan(karteKasten!.width / 2);

      // Der echte Abschnitt behält sein Aussehen.
      const abschnitt = page.locator("#abschnitt");
      await expect(abschnitt).toHaveCSS("border-top-width", "1px");
      const abschnittPfeil = await abschnitt
        .locator("> summary")
        .evaluate((element) => window.getComputedStyle(element, "::before").content);
      expect(abschnittPfeil).toBe('"›"');
    });
  }
});
