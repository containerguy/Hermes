const COD4_NORMALIZED = new Set(["cod4", "callofduty4"]);

export function isCod4Game(title: string): boolean {
  const norm = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  return COD4_NORMALIZED.has(norm);
}
