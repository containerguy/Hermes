import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fixture from "./__fixtures__/get-instances.json";
import type { GameServerBinding } from "../../domain/gameservers/bindings";
import {
  applyInstancesSnapshot,
  appStateName,
  getAllServerStatus,
  getServerStatus,
  resetAmpStatusForTests
} from "./amp-status";

type FixtureTarget = { AvailableInstances: Array<{ InstanceID: string; InstanceName: string; AppState: number }> };

function findInstance(name: string) {
  for (const target of fixture as FixtureTarget[]) {
    const hit = target.AvailableInstances.find((i) => i.InstanceName === name);
    if (hit) return hit;
  }
  throw new Error(`fixture ohne ${name}`);
}

function binding(id: string, instanceName: string, ampInstanceId: string): GameServerBinding {
  const now = new Date().toISOString();
  return {
    id,
    gameTitleNorm: instanceName.toLowerCase(),
    displayTitle: instanceName,
    ampInstanceId,
    ampInstanceName: instanceName,
    host: `${instanceName.toLowerCase()}.lanparty.example`,
    port: 27015,
    connectScheme: "steam",
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
}

describe("amp-status", () => {
  beforeEach(() => resetAmpStatusForTests());
  afterEach(() => resetAmpStatusForTests());

  it("maps numeric AMP app states to names", () => {
    expect(appStateName(20)).toBe("Ready");
    expect(appStateName(0)).toBe("Stopped");
    expect(appStateName(-1)).toBe("Undefined");
    expect(appStateName("Starting")).toBe("Starting");
    expect(appStateName(4711)).toBe("State4711");
  });

  it("reads running/appState/players from the controller snapshot and flags unknown instances", () => {
    const cs2 = findInstance("Counter-Strike201");
    const bindings = [
      binding("b-cs2", "Counter-Strike201", cs2.InstanceID),
      binding("b-ghost", "Ghost01", "00000000-0000-0000-0000-000000000000")
    ];

    expect(applyInstancesSnapshot(fixture, bindings)).toBe(true);

    const cs2Status = getServerStatus("b-cs2");
    expect(cs2Status).toMatchObject({
      instanceRunning: true,
      running: true,
      appState: "Ready",
      players: 0,
      maxPlayers: 32,
      host: "counter-strike201.lanparty.example",
      port: 27015,
      error: null
    });
    expect(getServerStatus("b-ghost")).toMatchObject({
      running: false,
      appState: "Undefined",
      error: "amp_instanz_unbekannt"
    });
    expect(Object.keys(cs2Status!).sort()).toEqual(
      [
        "ampInstanceId",
        "ampInstanceName",
        "appState",
        "bindingId",
        "connectIp",
        "connectScheme",
        "error",
        "host",
        "instanceRunning",
        "maxPlayers",
        "players",
        "port",
        "running",
        "updatedAt"
      ].sort()
    );
  });

  it("carries the resolved IP and treats an IP change as a status change", () => {
    const cs2 = findInstance("Counter-Strike201");
    const bindings = [binding("b-cs2", "Counter-Strike201", cs2.InstanceID)];
    const host = bindings[0]!.host;
    applyInstancesSnapshot(fixture, bindings, null, new Map([[host, "192.168.200.8"]]));
    expect(getServerStatus("b-cs2")?.connectIp).toBe("192.168.200.8");
    expect(applyInstancesSnapshot(fixture, bindings, null, new Map([[host, "192.168.200.8"]]))).toBe(false);
    expect(applyInstancesSnapshot(fixture, bindings, null, new Map([[host, "192.168.200.99"]]))).toBe(true);
    expect(applyInstancesSnapshot(fixture, bindings, null, new Map())).toBe(true);
    expect(getServerStatus("b-cs2")?.connectIp).toBeNull();
  });

  it("does not report a change for an identical second snapshot", () => {
    const cs2 = findInstance("Counter-Strike201");
    const bindings = [binding("b-cs2", "Counter-Strike201", cs2.InstanceID)];
    expect(applyInstancesSnapshot(fixture, bindings)).toBe(true);
    expect(applyInstancesSnapshot(fixture, bindings)).toBe(false);
  });

  it("keeps the last known values and sets error when a poll fails", () => {
    const cs2 = findInstance("Counter-Strike201");
    const bindings = [binding("b-cs2", "Counter-Strike201", cs2.InstanceID)];
    applyInstancesSnapshot(fixture, bindings);

    expect(applyInstancesSnapshot(null, bindings, "amp_http_fehler")).toBe(true);
    expect(getServerStatus("b-cs2")).toMatchObject({ running: true, players: 0, error: "amp_http_fehler" });

    expect(applyInstancesSnapshot(fixture, bindings)).toBe(true);
    expect(getServerStatus("b-cs2")?.error).toBeNull();
  });

  it("drops cache entries whose binding disappeared", () => {
    const cs2 = findInstance("Counter-Strike201");
    applyInstancesSnapshot(fixture, [binding("b-cs2", "Counter-Strike201", cs2.InstanceID)]);
    expect(getAllServerStatus()).toHaveLength(1);
    expect(applyInstancesSnapshot(fixture, [])).toBe(true);
    expect(getAllServerStatus()).toHaveLength(0);
  });
});
