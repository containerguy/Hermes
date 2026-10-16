import type { GameServerBinding } from "../../domain/gameservers/bindings";
import type { HermesSettings } from "../../settings";
import { ampCall, ampInstanceCall, unwrapAmpData } from "./amp-session";
import { getServerStatus } from "./amp-status";

/**
 * Steueraktionen auf gebundenen AMP-Instanzen (Phase 15-02). Gemeinsam genutzt von den
 * HTTP-Routen (manager+) und der Automatik (Phase 15-04, Auto-Start/-Stop).
 */

export const CONTROL_ACTIONS = ["start", "stop", "restart", "update", "kill"] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

/** AMP ActionResult: `{ Status: boolean, Reason?: string }`, ggf. in `result` verpackt. */
export function assertActionOk(raw: unknown) {
  const data = unwrapAmpData(raw);
  if (data && typeof data === "object" && "Status" in data && (data as { Status?: unknown }).Status === false) {
    const reason = (data as { Reason?: unknown }).Reason;
    throw new Error(typeof reason === "string" && reason ? reason : "amp_aktion_fehlgeschlagen");
  }
}

export async function runControlAction(settings: HermesSettings, binding: GameServerBinding, action: ControlAction) {
  const status = getServerStatus(binding.id);
  switch (action) {
    case "start": {
      if (!status?.instanceRunning) {
        assertActionOk(
          await ampCall(settings, "ADSModule/StartInstance", { InstanceName: binding.ampInstanceName })
        );
        // Die Instanz bootet gerade; Core/Start kann noch scheitern — der Poller zeigt den Verlauf.
        try {
          assertActionOk(await ampInstanceCall(settings, binding.ampInstanceId, "Core/Start"));
        } catch {
          /* Instanz noch nicht erreichbar */
        }
        return;
      }
      assertActionOk(await ampInstanceCall(settings, binding.ampInstanceId, "Core/Start"));
      return;
    }
    case "stop":
      assertActionOk(await ampInstanceCall(settings, binding.ampInstanceId, "Core/Stop"));
      return;
    case "restart":
      assertActionOk(await ampInstanceCall(settings, binding.ampInstanceId, "Core/Restart"));
      return;
    case "update":
      // Spiel-Update (SteamCMD o. ä.) — nicht ADSModule/UpgradeInstance, das wäre das AMP-Upgrade.
      assertActionOk(await ampInstanceCall(settings, binding.ampInstanceId, "Core/UpdateApplication"));
      return;
    case "kill":
      assertActionOk(await ampInstanceCall(settings, binding.ampInstanceId, "Core/Kill"));
      return;
  }
}
