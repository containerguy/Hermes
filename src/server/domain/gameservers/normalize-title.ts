/**
 * Normalisierung von Spieltiteln für die Bindung an AMP-Instanzen.
 * Identisch zur Client-Logik in `src/client/cod4/isCod4Game.ts`:
 * Kleinschreibung, nur `[a-z0-9]`. "Counter-Strike 1.6" -> "counterstrike16".
 */
export function normalizeGameTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}
