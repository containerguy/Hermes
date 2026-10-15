import { describe, expect, it } from "vitest";
import { buildConnectAction } from "./connect-link";

describe("buildConnectAction", () => {
  it("builds a steam://connect link for the steam scheme", () => {
    expect(
      buildConnectAction({ host: "cs2.lanparty.familie-keller.info", port: 27015, connectScheme: "steam" })
    ).toEqual({
      kind: "link",
      href: "steam://connect/cs2.lanparty.familie-keller.info:27015",
      text: "cs2.lanparty.familie-keller.info:27015"
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
