/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetDeviceKey,
  getKnownDeviceName,
  getOrCreateDeviceKey,
  rememberKnownDevice
} from "./device-key";

beforeEach(() => {
  window.localStorage.clear();
});

describe("known device memory", () => {
  it("returns the remembered name only for the same (case-insensitive) username", () => {
    rememberKnownDevice("Spieler", "Gaming-PC");
    expect(getKnownDeviceName("spieler ")).toBe("Gaming-PC");
    expect(getKnownDeviceName("someone-else")).toBeNull();
    expect(getKnownDeviceName("")).toBeNull();
  });

  it("ignores empty names and malformed storage", () => {
    rememberKnownDevice("spieler", "   ");
    expect(getKnownDeviceName("spieler")).toBeNull();
    window.localStorage.setItem("matchdesk_known_device_v1", "{not json");
    expect(getKnownDeviceName("spieler")).toBeNull();
  });

  it("forgetDeviceKey drops both the device key and the remembered name", () => {
    const key = getOrCreateDeviceKey();
    rememberKnownDevice("spieler", "Gaming-PC");
    forgetDeviceKey();
    expect(getKnownDeviceName("spieler")).toBeNull();
    expect(getOrCreateDeviceKey()).not.toBe(key);
  });
});

describe("Übernahme der Schlüssel aus der Zeit vor der Umbenennung", () => {
  const legacyKey = "AAAAAAAAAAAAAAAAAAAAAA";

  it("übernimmt den alten Geräteschlüssel und lässt ihn für einen Rollback stehen", () => {
    window.localStorage.setItem("hermes_device_key_v1", legacyKey);
    expect(getOrCreateDeviceKey()).toBe(legacyKey);
    expect(window.localStorage.getItem("matchdesk_device_key_v1")).toBe(legacyKey);
    expect(window.localStorage.getItem("hermes_device_key_v1")).toBe(legacyKey);
  });

  it("bevorzugt den neuen Schlüssel, wenn beide vorhanden sind", () => {
    const fresh = "BBBBBBBBBBBBBBBBBBBBBB";
    window.localStorage.setItem("hermes_device_key_v1", legacyKey);
    window.localStorage.setItem("matchdesk_device_key_v1", fresh);
    expect(getOrCreateDeviceKey()).toBe(fresh);
  });

  it("liest den alten gemerkten Gerätenamen", () => {
    window.localStorage.setItem("hermes_known_device_v1", JSON.stringify({ username: "spieler", name: "Gaming-PC" }));
    expect(getKnownDeviceName("spieler")).toBe("Gaming-PC");
  });

  it("forgetDeviceKey entfernt auch die alten Schlüssel", () => {
    window.localStorage.setItem("hermes_device_key_v1", legacyKey);
    window.localStorage.setItem("hermes_known_device_v1", JSON.stringify({ username: "spieler", name: "Gaming-PC" }));
    forgetDeviceKey();
    expect(window.localStorage.getItem("hermes_device_key_v1")).toBeNull();
    expect(getKnownDeviceName("spieler")).toBeNull();
    expect(getOrCreateDeviceKey()).not.toBe(legacyKey);
  });
});
