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
    window.localStorage.setItem("hermes_known_device_v1", "{not json");
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
