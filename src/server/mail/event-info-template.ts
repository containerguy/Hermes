import type { AppLocale } from "../../shared/locale";
import { escapeHtml, normalizeAccentColor, readableTextOn, sanitizeInline } from "./templates";

/**
 * Mail für Event-Infos (Rundnachricht, Erinnerung). Der Text kommt vom Organisator; er wird
 * nie als HTML übernommen, sondern escaped. Absätze und Links werden lesbar umgesetzt.
 */
export type EventInfoMailContent = {
  locale: AppLocale;
  appName: string;
  recipientName: string;
  eventName: string;
  subject: string;
  body: string;
  /** Link zum Event in der App, oder null ohne MATCHDESK_PUBLIC_URL. */
  eventUrl: string | null;
  /** Persönlicher Abmeldelink, oder null ohne MATCHDESK_PUBLIC_URL. */
  unsubscribeUrl: string | null;
  accentColor: string;
  /** Optionaler Anhang-Hinweis, z. B. für den Kalendereintrag. */
  footerNote?: string | null;
};

const COPY: Record<
  AppLocale,
  {
    greeting: (name: string) => string;
    open: string;
    unsubscribe: string;
    reason: (app: string, event: string) => string;
  }
> = {
  de: {
    greeting: (name) => (name ? `Hallo ${name},` : "Hallo,"),
    open: "Zum Event",
    unsubscribe: "Keine Event-Infos mehr per Mail und Messenger",
    reason: (app, event) => `Du bekommst diese Nachricht, weil du bei ${app} zum Event ${event} gehörst.`
  },
  en: {
    greeting: (name) => (name ? `Hi ${name},` : "Hi,"),
    open: "Open the event",
    unsubscribe: "Stop event updates by email and messenger",
    reason: (app, event) => `You receive this message because you are part of the event ${event} on ${app}.`
  }
};

/** Body-Text bereinigen: Steuerzeichen außer Zeilenumbruch raus, höchstens zwei Leerzeilen am Stück. */
export function normalizeBody(value: string): string {
  return (
    value
      .replace(/\r\n?/g, "\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function linkify(escaped: string, accent: string) {
  return escaped.replace(
    /https?:\/\/[^\s<>"']+/g,
    (url) => `<a href="${url}" style="color:${accent};">${url}</a>`
  );
}

export function renderEventInfoMail(content: EventInfoMailContent) {
  const copy = COPY[content.locale] ?? COPY.de;
  const appName = sanitizeInline(content.appName) || "Mitspielzentrale";
  const eventName = sanitizeInline(content.eventName);
  const subject = sanitizeInline(content.subject).slice(0, 200) || eventName;
  const body = normalizeBody(content.body);
  const accent = normalizeAccentColor(content.accentColor);
  const onAccent = readableTextOn(accent);
  const greeting = copy.greeting(sanitizeInline(content.recipientName));

  const textLines = [greeting, "", body, ""];
  if (content.eventUrl) {
    textLines.push(`${copy.open}: ${content.eventUrl}`, "");
  }
  if (content.footerNote) {
    textLines.push(content.footerNote, "");
  }
  textLines.push("-- ", copy.reason(appName, eventName));
  if (content.unsubscribeUrl) {
    textLines.push(`${copy.unsubscribe}: ${content.unsubscribeUrl}`);
  }
  textLines.push("");

  const e = escapeHtml;
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 12px 0;">${linkify(e(paragraph), accent).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  const button = content.eventUrl
    ? `<tr><td style="padding:8px 32px 8px 32px;"><a href="${e(content.eventUrl)}" style="display:inline-block;background:${accent};color:${onAccent};text-decoration:none;font-weight:600;font-size:15px;line-height:20px;padding:11px 22px;border-radius:6px;">${e(copy.open)}</a></td></tr>`
    : "";
  const unsubscribe = content.unsubscribeUrl
    ? `<br><a href="${e(content.unsubscribeUrl)}" style="color:#7b8794;">${e(copy.unsubscribe)}</a>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="${content.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5f7;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:8px;border-top:4px solid ${accent};font-family:${font};color:#1f2933;">
<tr><td style="padding:24px 32px 0 32px;font-size:13px;line-height:18px;color:#52606d;">${e(appName)} · ${e(eventName)}</td></tr>
<tr><td style="padding:8px 32px 0 32px;font-size:20px;line-height:26px;font-weight:700;color:${accent};">${e(subject)}</td></tr>
<tr><td style="padding:16px 32px 8px 32px;font-size:15px;line-height:22px;">
<p style="margin:0 0 12px 0;">${e(greeting)}</p>
${paragraphs}
</td></tr>
${button}
${content.footerNote ? `<tr><td style="padding:8px 32px 0 32px;font-size:13px;line-height:19px;color:#52606d;">${e(content.footerNote)}</td></tr>` : ""}
<tr><td style="padding:16px 32px 24px 32px;"></td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${font};">
<tr><td style="padding:16px 32px;font-size:12px;line-height:18px;color:#7b8794;text-align:center;">
${e(copy.reason(appName, eventName))}${unsubscribe}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;

  const headers: Record<string, string> = {
    "Auto-Submitted": "auto-generated",
    "Content-Language": content.locale
  };
  if (content.unsubscribeUrl) {
    // RFC 8058: Ein-Klick-Abmeldung direkt aus dem Mailprogramm.
    headers["List-Unsubscribe"] = `<${content.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return { subject, text: textLines.join("\n"), html, headers };
}
