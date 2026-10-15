import type { ServerStatus } from "../types/core";

export type ConnectAction =
  | { kind: "link"; href: string; text: string }
  | { kind: "copy"; text: string };

const MINECRAFT_DEFAULT_PORT = 25565;

/** Verbinden-Aktion je Schema (Phase 15, D-12). Host/Port kommen ausschließlich aus der Bindung. */
export function buildConnectAction(
  status: Pick<ServerStatus, "host" | "port" | "connectScheme">
): ConnectAction {
  const hostPort = `${status.host}:${status.port}`;
  switch (status.connectScheme) {
    case "steam":
      return { kind: "link", href: `steam://connect/${hostPort}`, text: hostPort };
    case "minecraft":
      return {
        kind: "copy",
        text: status.port === MINECRAFT_DEFAULT_PORT ? status.host : hostPort
      };
    case "copy":
    default:
      return { kind: "copy", text: hostPort };
  }
}
