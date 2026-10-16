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

  it("builds a ut2004:// link with the resolved IP and a setup hint", () => {
    expect(
      buildConnectAction({
        host: "retro.lanparty.familie-keller.info",
        connectIp: "192.168.200.9",
        port: 7777,
        connectScheme: "ut2004"
      })
    ).toEqual({
      kind: "link",
      href: "ut2004://192.168.200.9:7777",
      text: "retro.lanparty.familie-keller.info:7777",
      hint: "ut2004Setup"
    });
  });

  it("falls back to the host name in the ut2004:// link without a resolved IP", () => {
    expect(buildConnectAction({ host: "retro.example", connectIp: null, port: 7777, connectScheme: "ut2004" })).toEqual({
      kind: "link",
      href: "ut2004://retro.example:7777",
      text: "retro.example:7777",
      hint: "ut2004Setup"
    });
  });

  it("starts the Steam version of Factorio with --mp-connect and the resolved IP", () => {
    expect(
      buildConnectAction({
        host: "factorio.lanparty.familie-keller.info",
        connectIp: "192.168.200.10",
        port: 34197,
        connectScheme: "factorio"
      })
    ).toEqual({
      kind: "link",
      href: "steam://run/427520//--mp-connect%20192.168.200.10:34197/",
      text: "factorio.lanparty.familie-keller.info:34197",
      hint: "factorioSteam"
    });
  });

  it("falls back to the host name in the Factorio link without a resolved IP", () => {
    expect(buildConnectAction({ host: "factorio.example", port: 34197, connectScheme: "factorio" })).toEqual({
      kind: "link",
      href: "steam://run/427520//--mp-connect%20factorio.example:34197/",
      text: "factorio.example:34197",
      hint: "factorioSteam"
    });
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
