/** Höchstzahl Einzelbefehle pro Konsoleneingabe; Vorlagen brauchen höchstens drei. */
export const MAX_CONSOLE_PARTS = 8;

/**
 * Teilt eine Konsoleneingabe an `;` in Einzelbefehle, wie es die Engine-Konsole von Quake/GoldSrc/
 * Source selbst täte. Nötig, weil AMP bei GoldSrc-RCON die ganze Zeile als einen Befehl schickt
 * (`yb_quota_mode fill; yb_quota 10` setzt sonst `yb_quota_mode` auf `fill;`).
 * `;` in Anführungszeichen bleibt stehen (`say "a; b"`), leere Teile entfallen.
 */
export function splitConsoleCommands(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of command) {
    if (char === '"') quoted = !quoted;
    if (char === ";" && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}
