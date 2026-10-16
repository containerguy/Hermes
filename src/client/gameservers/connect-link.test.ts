import { describe, expect, it } from "vitest";
import { buildConnectAction } from "./connect-link";

describe("buildConnectAction", () => {
  it("builds a steam://connect link with the resolved IP and shows the host name", () => {
    expect(
      buildConnectAction({
        host: "cs2.lanparty.familie-keller.info",
        connectIp: "192.168.200.8",
        port: 27015,
        connectScheme: "steam"
      })
    ).toEqual({
      kind: "link",
      href: "steam://connect/192.168.200.8:27015",
      text: "cs2.lanparty.familie-keller.info:27015"
    });
  });

  it("falls back to copying the address when no IP could be resolved", () => {
    expect(
      buildConnectAction({ host: "cs2.lanparty.example", connectIp: null, port: 27015, connectScheme: "steam" })
    ).toEqual({ kind: "copy", text: "cs2.lanparty.example:27015" });
  });

  it("omits the default Minecraft port and copies the host only", () => {
    expect(buildConnectAction({ host: "mc.example", port: 25565, connectScheme: "minecraft" })).toEqual({
      kind: "copy",
      text: "mc.example"
    });
    expect(buildConnectAction({ host: "mc.example", port: 25566, connectScheme: "minecraft" })).toEqual({
      kind: "copy",
      text: "mc.example:25566"
    });
  });

  it("copies host:port for the generic scheme", () => {
    expect(buildConnectAction({ host: "retro.example", port: 7777, connectScheme: "copy" })).toEqual({
      kind: "copy",
      text: "retro.example:7777"
    });
  });
});
