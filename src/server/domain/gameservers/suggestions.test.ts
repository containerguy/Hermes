import { describe, expect, it } from "vitest";
import fixture from "../../integrations/amp/__fixtures__/get-instances.json";
import { flattenAmpInstances, pickGamePort, type HermesAmpInstanceRow } from "../../integrations/amp/amp-client";
import { suggestBindings, suggestScheme } from "./suggestions";

/** Katalog der Produktion (Stand 2026-10-16). */
const CATALOG = [
  "Age of Empires II Definitive Edition",
  "Among Us",
  "Call of Duty 4",
  "Counter Strike",
  "Counter Strike 1.6",
  "Counter Strike Source",
  "Counter Strike 2",
  "Factorio",
  "Minecraft",
  "Soldat",
  "Titanfall 2",
  "UT2004"
];

function rowsFromFixture(): HermesAmpInstanceRow[] {
  return flattenAmpInstances(fixture).map(({ row, targetName, targetHost }) => ({
    id: String(row.InstanceID),
    friendlyName: String(row.FriendlyName),
    instanceName: String(row.InstanceName),
    module: String(row.Module),
    moduleDisplayName: typeof row.ModuleDisplayName === "string" ? row.ModuleDisplayName : "",
    targetName,
    targetHost,
    gamePort: pickGamePort((row.ApplicationEndpoints as Record<string, unknown>[]) ?? []),
    running: row.Running === true,
    serverHost: "",
    connectionInfo: ""
  }));
}

describe("binding suggestions", () => {
  it("derives target host and game port from the controller snapshot", () => {
    const rows = rowsFromFixture();
    const cs2 = rows.find((r) => r.instanceName === "Counter-Strike201")!;
    expect(cs2.targetHost).toBe("cs2.lanparty.familie-keller.info");
    expect(cs2.gamePort).toBe(27015);
    const mc = rows.find((r) => r.instanceName === "Minecraft01")!;
    expect(mc.targetHost).toBe("minecraft.lanparty.familie-keller.info");
    expect(mc.gamePort).toBe(25565);
    const ut = rows.find((r) => r.instanceName === "UT200401")!;
    expect(ut.targetHost).toBe("retro.lanparty.familie-keller.info");
    expect(ut.gamePort).toBe(7777);
  });

  it("never picks the SFTP endpoint as game port", () => {
    expect(pickGamePort([{ DisplayName: "SFTP Server", Endpoint: "0.0.0.0:2224" }])).toBeNull();
    expect(
      pickGamePort([
        { DisplayName: "SFTP Server", Endpoint: "0.0.0.0:2224" },
        { DisplayName: "Unknown Endpoint", Endpoint: "0.0.0.0:34197" }
      ])
    ).toBe(34197);
  });

  it("matches every fixture instance to the production catalog", () => {
    const suggestions = suggestBindings(rowsFromFixture(), CATALOG, []);
    const byName = Object.fromEntries(suggestions.map((s) => [s.ampInstanceName, s]));
    expect(byName.Counter_Strike201 ?? byName["Counter-Strike201"]).toMatchObject({
      suggestedTitle: "Counter Strike 2",
      connectScheme: "steam",
      host: "cs2.lanparty.familie-keller.info",
      port: 27015
    });
    expect(byName.CS1601).toMatchObject({ suggestedTitle: "Counter Strike 1.6", connectScheme: "steam" });
    expect(byName.CoD401).toMatchObject({ suggestedTitle: "Call of Duty 4", connectScheme: "copy" });
    expect(byName.UT200401).toMatchObject({ suggestedTitle: "UT2004", connectScheme: "ut2004", port: 7777 });
    expect(byName.Soldat01).toMatchObject({ suggestedTitle: "Soldat", port: 23073 });
    expect(byName.Factorio01).toMatchObject({ suggestedTitle: "Factorio", connectScheme: "factorio", port: 34197 });
    expect(byName.Minecraft01).toMatchObject({ suggestedTitle: "Minecraft", connectScheme: "minecraft", port: 25565 });
  });

  it("marks instances that already have a binding", () => {
    const rows = rowsFromFixture();
    const cs2 = rows.find((r) => r.instanceName === "Counter-Strike201")!;
    const suggestions = suggestBindings(rows, CATALOG, [
      {
        id: "b-1",
        gameTitleNorm: "counterstrike2",
        displayTitle: "Counter Strike 2",
        ampInstanceId: cs2.id,
        ampInstanceName: cs2.instanceName,
        host: cs2.targetHost,
        port: 27015,
        connectScheme: "steam",
        enabled: true,
        autoStopEnabled: false,
        createdAt: "",
        updatedAt: ""
      }
    ]);
    expect(suggestions.find((s) => s.ampInstanceId === cs2.id)?.existingBindingId).toBe("b-1");
    expect(suggestions.filter((s) => s.existingBindingId === null)).toHaveLength(rows.length - 1);
  });

  it("suggests ut2004:// for Unreal Tournament 2004 and steam://run for Factorio", () => {
    expect(
      suggestScheme({ module: "GenericModule", moduleDisplayName: "Unreal Tournament 2004", friendlyName: "Retro" })
    ).toBe("ut2004");
    expect(suggestScheme({ module: "GenericModule", moduleDisplayName: "", friendlyName: "UT2004" })).toBe("ut2004");
    expect(suggestScheme({ module: "GenericModule", moduleDisplayName: "Factorio", friendlyName: "Factorio" })).toBe(
      "factorio"
    );
  });

  it("falls back to copy scheme for unknown games", () => {
    expect(suggestScheme({ module: "GenericModule", moduleDisplayName: "Soldat", friendlyName: "Soldat" })).toBe("copy");
    expect(
      suggestScheme({ module: "GenericModule", moduleDisplayName: "Unreal Tournament 99", friendlyName: "UT99" })
    ).toBe("copy");
    expect(suggestScheme({ module: "GenericModule", moduleDisplayName: "Counter-Strike: Source", friendlyName: "CSS" })).toBe("steam");
  });
});
