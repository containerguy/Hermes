import type { AppSettings } from "../types/core";

/** App-Icon (M). `brandMark` kennt seit der Umbenennung nur noch einen Wert. */
export function brandIconSrc(_settings?: Pick<AppSettings, "brandMark">): string {
  return "/icon.svg";
}
