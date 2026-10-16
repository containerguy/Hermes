import type { HermesAmpInstanceRow } from "../../integrations/amp/amp-client";
import { normalizeGameTitle } from "../../../shared/game-title";
import type { GameServerBinding } from "./bindings";

/**
 * Bindungsvorschläge (Phase 15): AMP-Instanzen mit DNS-Name des Targets, Spielport und einem
 * Treffer im Spielkatalog. Reine Funktion, damit sie gegen das Fixture testbar ist.
 */

export type BindingSuggestion = {
  ampInstanceId: string;
  ampInstanceName: string;
  friendlyName: string;
  moduleDisplayName: string;
  targetName: string;
  host: string;
  port: number | null;
  connectScheme: GameServerBinding["connectScheme"];
  /** Bester Katalogtreffer oder null, wenn nichts passt. */
  suggestedTitle: string | null;
  /** Alle passenden Katalogtitel (für die Auswahl in der UI). */
  catalogMatches: string[];
  /** Schon gebunden? Dann die Bindung, sonst null. */
  existingBindingId: string | null;
};

/** Kurzformen, die in AMP-Instanznamen üblich sind. */
const ALIASES: Record<string, string[]> = {
  cs2: ["counterstrike2"],
  cs16: ["counterstrike16", "counterstrike"],
  css: ["counterstrikesource"],
  cod4: ["callofduty4", "callofduty4modernwarfare"],
  ut2004: ["unrealtournament2004"],
  ut: ["unrealtournament"],
  tf2: ["teamfortress2"],
  mc: ["minecraft"],
  aoe2: ["ageofempires2", "ageofempiresii", "ageofempiresiidefinitiveedition"],
  aoe4: ["ageofempires4", "ageofempiresiv", "ageofempiresivanniversaryedition"]
};

function expand(norm: string): string[] {
  const out = new Set<string>([norm]);
  for (const [alias, targets] of Object.entries(ALIASES)) {
    if (norm === alias || targets.includes(norm)) {
      out.add(alias);
      for (const t of targets) out.add(t);
    }
  }
  return [...out];
}

/** Treffer-Score zwischen zwei normalisierten Titeln: 3 exakt, 2 Alias, 1 Präfix/Enthalten, 0 nichts. */
function matchScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 3;
  const ea = expand(a);
  const eb = expand(b);
  if (ea.some((x) => eb.includes(x))) return 2;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return 1;
  return 0;
}

export function suggestScheme(row: Pick<HermesAmpInstanceRow, "module" | "moduleDisplayName" | "friendlyName">) {
  if (row.module === "Minecraft") return "minecraft" as const;
  const text = `${row.moduleDisplayName} ${row.friendlyName}`.toLowerCase();
  // v0.14.0: eigene Links für UT2004 (ut2004://) und die Steam-Version von Factorio (steam://run)
  if (/unreal tournament 2004|ut ?2004/.test(text)) return "ut2004" as const;
  if (/factorio/.test(text)) return "factorio" as const;
  if (/counter-?strike|cs2|cs16|cs:?s|team fortress|left 4 dead|garry|half-?life|day of defeat/.test(text)) {
    return "steam" as const;
  }
  return "copy" as const;
}

export function suggestBindings(
  instances: HermesAmpInstanceRow[],
  catalog: string[],
  existing: GameServerBinding[]
): BindingSuggestion[] {
  const catalogNorm = catalog.map((title) => ({ title, norm: normalizeGameTitle(title) }));
  const byInstanceId = new Map(existing.map((b) => [b.ampInstanceId, b]));

  return instances.map((row) => {
    const candidates = [row.moduleDisplayName, row.friendlyName, row.instanceName.replace(/\d+$/, "")]
      .map(normalizeGameTitle)
      .filter(Boolean);

    // Quelle gewichten: Vorlagenname (ModuleDisplayName) vor FriendlyName vor Instanzname ohne Ziffern,
    // sonst gewinnt bei "Counter-Strike201" der Katalogtitel "Counter Strike" gegen "Counter Strike 2".
    const scored = catalogNorm
      .map((entry) => ({
        title: entry.title,
        score: Math.max(
          ...candidates.map((c, index) => {
            const base = matchScore(c, entry.norm);
            return base > 0 ? base * 10 - index : 0;
          })
        )
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "de"));

    return {
      ampInstanceId: row.id,
      ampInstanceName: row.instanceName,
      friendlyName: row.friendlyName,
      moduleDisplayName: row.moduleDisplayName,
      targetName: row.targetName,
      host: row.targetHost,
      port: row.gamePort,
      connectScheme: suggestScheme(row),
      suggestedTitle: scored[0]?.title ?? null,
      catalogMatches: scored.map((entry) => entry.title),
      existingBindingId: byInstanceId.get(row.id)?.id ?? null
    };
  });
}
