import type { ServerStatus } from "../types/core";

export type ConnectAction =
  | { kind: "link"; href: string; text: string }
  | { kind: "copy"; text: string };

const MINECRAFT_DEFAULT_PORT = 25565;

/**
 * Verbinden-Aktion je Schema (Phase 15, D-12). Host/Port kommen ausschließlich aus der Bindung.
 * `steam://connect/` nimmt nur IP-Adressen an (mit DNS-Namen verwirft Steam den Link still),
 * deshalb nutzt der Link die serverseitig aufgelöste `connectIp`; angezeigt wird der Name.
 * Ohne aufgelöste IP gibt es keinen Link, nur die Adresse zum Kopieren.
 */
export function buildConnectAction(
  status: Pick<ServerStatus, "host" | "port" | "connectScheme"> & Partial<Pick<ServerStatus, "connectIp">>
): ConnectAction {
  const hostPort = `${status.host}:${status.port}`;
  switch (status.connectScheme) {
    case "steam":
      if (status.connectIp) {
        return { kind: "link", href: `steam://connect/${status.connectIp}:${status.port}`, text: hostPort };
      }
      return { kind: "copy", text: hostPort };
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
