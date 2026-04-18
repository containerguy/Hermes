import type { AppLocale } from "../../shared/locale";
import { MESSAGES } from "../i18n/catalog/index";

/** Testbar via `win`-Parameter (kein globales `window` nötig). */
export type SecureContextInfo = {
  isSecureContext: boolean;
  protocol: string;
  hostname: string;
  isHttps: boolean;
  isLocalhost: boolean;
  headline: string;
  body: string;
};

type RuntimeWindow = Pick<Window, "location" | "isSecureContext">;

export function getSecureContextInfo(win: RuntimeWindow = window, locale: AppLocale = "de"): SecureContextInfo {
  const protocol = win.location.protocol;
  const hostname = win.location.hostname;
  const isHttps = protocol === "https:";
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  const isSecureContext = win.isSecureContext;

  const copy = MESSAGES[locale];

  let headline: string;
  let body: string;

  if (isSecureContext && isHttps) {
    headline = copy["secure.https.title"];
    body = copy["secure.https.body"];
  } else if (isSecureContext && isLocalhost) {
    headline = copy["secure.localhost.title"];
    body = copy["secure.localhost.body"];
  } else if (isHttps && !isSecureContext) {
    headline = copy["secure.httpsPartial.title"];
    body = copy["secure.httpsPartial.body"];
  } else {
    headline = copy["secure.insecure.title"];
    body = copy["secure.insecure.body"];
  }

  return { isSecureContext, protocol, hostname, isHttps, isLocalhost, headline, body };
}

type DisplayModeWindow = Pick<Window, "matchMedia" | "navigator">;

export function isPwaDisplayMode(win: DisplayModeWindow = window): boolean {
  const navigatorMaybe = win.navigator as Navigator & { standalone?: boolean };
  if (navigatorMaybe.standalone === true) {
    return true;
  }
  if (typeof win.matchMedia !== "function") {
    return false;
  }
  return win.matchMedia("(display-mode: standalone)").matches;
}

export function isLikelyIosSafari(win: Pick<Window, "navigator"> = window): boolean {
  const ua = win.navigator.userAgent;
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (win.navigator.platform === "MacIntel" && win.navigator.maxTouchPoints > 1);
  const webKitSafari = /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return iOS && webKitSafari;
}
