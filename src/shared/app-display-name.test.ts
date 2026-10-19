import { describe, expect, it } from "vitest";
import { deMessages } from "../client/i18n/catalog/de";
import { enMessages } from "../client/i18n/catalog/en";
import { getTemplateMessageOverride } from "../client/i18n/template-overlays";
import { projectTemplateIds } from "./project-template";
import {
  builtinAppDisplayName,
  builtinAppDisplayNames,
  pickAppDisplayName,
  resolveAppDisplayName
} from "./app-display-name";

describe("app-display-name", () => {
  it("eingebaute Namen stimmen mit brand.displayName der Client-Kataloge überein", () => {
    for (const template of projectTemplateIds) {
      for (const [locale, table] of [
        ["de", deMessages],
        ["en", enMessages]
      ] as const) {
        const overlay = getTemplateMessageOverride(locale, template);
        const clientName = overlay["brand.displayName"] ?? table["brand.displayName"];
        expect(builtinAppDisplayNames[template][locale]).toBe(clientName);
      }
    }
  });

  it("appName gewinnt, Leerraum zählt als nicht gesetzt", () => {
    expect(pickAppDisplayName("  Mitspielzentrale ", "MatchDesk")).toBe("Mitspielzentrale");
    expect(pickAppDisplayName("   ", "MatchDesk")).toBe("MatchDesk");
    expect(pickAppDisplayName(null, "MatchDesk")).toBe("MatchDesk");
  });

  it("serverseitige Auflösung", () => {
    expect(resolveAppDisplayName({ appName: "" }, "de")).toBe("Mitspielzentrale");
    expect(resolveAppDisplayName({ appName: "" }, "en")).toBe("MatchDesk");
    expect(resolveAppDisplayName({ appName: "LAN", projectTemplate: "table_tennis" }, "en")).toBe("LAN");
    expect(builtinAppDisplayName(undefined, "de")).toBe("Mitspielzentrale");
  });
});
