import type { AppSettings } from "../types/core";

export function brandIconSrc(settings: Pick<AppSettings, "brandMark">): string {
  return settings.brandMark === "mitspiel" ? "/icon-mitspiel.svg" : "/icon.svg";
}
