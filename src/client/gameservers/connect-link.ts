import type { ServerStatus } from "../types/core";

/** Zusatzhinweis unter dem Verbinden-Knopf. */
export type ConnectHint = "ut2004Setup" | "factorioSteam";

export type ConnectAction =
  | { kind: "link"; href: string; text: string; hint?: ConnectHint }
  | { kind: "copy"; text: string };

const MINECRAFT_DEFAULT_PORT = 25565;
/** Steam-App-ID von Factorio. */
const FACTORIO_STEAM_APP_ID = 427520;

/** Statische Einrichtungsdateien für das ut2004://-Protokoll (aus `public/downloads/`). */
export const UT2004_PROTOCOL_REG = "/downloads/ut2004-protocol.reg";
export const UT2004_PROTOCOL_REMOVE_REG = "/downloads/ut2004-protocol-remove.reg";

/**
 * Verbinden-Aktion je Schema (Phase 15, D-12). Host/Port kommen ausschließlich aus der Bindung.
 * `steam://connect/` nimmt nur IP-Adressen an (mit DNS-Namen verwirft Steam den Link still),
 * deshalb nutzt der Link die serverseitig aufgelöste `connectIp`; angezeigt wird der Name.
 * Ohne aufgelöste IP gibt es keinen Steam-Link, nur die Adresse zum Kopieren.
 *
 * `ut2004` und `factorio` (v0.14.0) bevorzugen ebenfalls die IP, nehmen ohne sie aber den Host:
 * - `ut2004://ip:port` öffnet UT2004 direkt auf dem Server (Protokoll einmalig per .reg registrieren).
 * - `steam://run/427520//--mp-connect ip:port/` startet die Steam-Version von Factorio mit
 *   `--mp-connect`; Steam fragt beim ersten Mal ggf. nach, ob die Startparameter in Ordnung sind.
 */
export function buildConnectAction(
  status: Pick<ServerStatus, "host" | "port" | "connectScheme"> & Partial<Pick<ServerStatus, "connectIp">>
): ConnectAction {
  const hostPort = `${status.host}:${status.port}`;
  const target = `${status.connectIp || status.host}:${status.port}`;
  switch (status.connectScheme) {
    case "steam":
      if (status.connectIp) {
        return { kind: "link", href: `steam://connect/${status.connectIp}:${status.port}`, text: hostPort };
      }
      return { kind: "copy", text: hostPort };
    case "ut2004":
      return { kind: "link", href: `ut2004://${target}`, text: hostPort, hint: "ut2004Setup" };
    case "factorio":
      return {
        kind: "link",
        href: `steam://run/${FACTORIO_STEAM_APP_ID}//--mp-connect%20${target}/`,
        text: hostPort,
        hint: "factorioSteam"
      };
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
