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

export function getSecureContextInfo(win: RuntimeWindow = window): SecureContextInfo {
  const protocol = win.location.protocol;
  const hostname = win.location.hostname;
  const isHttps = protocol === "https:";
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  const isSecureContext = win.isSecureContext;

  let headline: string;
  let body: string;

  if (isSecureContext && isHttps) {
    headline = "Sichere Verbindung (HTTPS)";
    body =
      "Diese Hermes-Instanz läuft über HTTPS. Web Push ist hier grundsätzlich möglich, sofern Browser und Gerät die APIs freigeben.";
  } else if (isSecureContext && isLocalhost) {
    headline = "Lokaler sicherer Kontext";
    body =
      "localhost gilt als sicherer Kontext — ideal zum Testen von Push ohne öffentliches Zertifikat.";
  } else if (isHttps && !isSecureContext) {
    headline = "HTTPS in eingeschränktem Kontext";
    body =
      "Die Adresse nutzt HTTPS, der Browser wertet den Kontext aber nicht als vollständig sicher (z. B. eingebettete Ansicht). Push kann fehlschlagen.";
  } else {
    headline = "Kein sicherer Kontext (HTTP oder unsicheres Umfeld)";
    body =
      "Web Push braucht einen sicheren Kontext: HTTPS im Betrieb oder localhost für Entwicklung. Ohne TLS zeigt der Browser die nötigen APIs nicht an.";
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
