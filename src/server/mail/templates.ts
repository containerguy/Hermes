import type { AppLocale } from "../../shared/locale";

/**
 * Aufbau der System-Mails (Login-Code, Registrierung, E-Mail-Änderung).
 * Reine Funktionen ohne Versand: liefern Betreff, Text- und HTML-Teil sowie Header.
 */

export type SystemMailKind = "login_code" | "registration_code" | "email_change_code";

export type SystemMailContent = {
  kind: SystemMailKind;
  locale: AppLocale;
  /** Anzeigename der App, z. B. „Mitspielzentrale“ (aus den Einstellungen). */
  appName: string;
  /** Anrede: Anzeigename oder Benutzername. */
  recipientName: string;
  code: string;
  /** Gültigkeit des Codes in Minuten. */
  validMinutes: number;
  /** Basis-URL der App ohne Slash am Ende, oder null (dann ohne Link). */
  publicUrl: string | null;
  /** Domain für den Footer, wenn keine Basis-URL bekannt ist (z. B. Domain der Absenderadresse). */
  fallbackDomain: string | null;
  /** Akzentfarbe (#rrggbb), üblicherweise `themePrimaryColor`. */
  accentColor: string;
};

export type RenderedSystemMail = {
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
};

const DEFAULT_ACCENT = "#0f766e";

type Copy = {
  subject: (app: string) => string;
  preheader: (minutes: number) => string;
  greeting: (name: string) => string;
  intro: (app: string) => string;
  codeLabel: string;
  instruction: (minutes: number) => string;
  linkLabel: string;
  linkTextPrefix: string;
  notRequested: string;
  signOff: string;
  footerReason: (app: string) => string;
};

const COPY: Record<SystemMailKind, Record<AppLocale, Copy>> = {
  login_code: {
    de: {
      subject: (app) => `Dein Login-Code für ${app}`,
      preheader: (minutes) => `Der Code ist ${minutes} Minuten gültig.`,
      greeting: (name) => (name ? `Hallo ${name},` : "Hallo,"),
      intro: (app) => `hier ist dein Code für die Anmeldung bei ${app}:`,
      codeLabel: "Dein Login-Code",
      instruction: (minutes) => `Gib ihn auf der Anmeldeseite ein. Der Code ist ${minutes} Minuten gültig.`,
      linkLabel: "Zur Anmeldung",
      linkTextPrefix: "Zur Anmeldung:",
      notRequested:
        "Du hast das nicht angefordert? Dann ignoriere diese Mail. Ohne den Code kann sich niemand mit deinem Konto anmelden.",
      signOff: "Viele Grüße",
      footerReason: (app) => `Du bekommst diese Mail, weil bei ${app} ein Login-Code für dein Konto angefordert wurde.`
    },
    en: {
      subject: (app) => `Your sign-in code for ${app}`,
      preheader: (minutes) => `The code is valid for ${minutes} minutes.`,
      greeting: (name) => (name ? `Hi ${name},` : "Hi,"),
      intro: (app) => `here is your code to sign in to ${app}:`,
      codeLabel: "Your sign-in code",
      instruction: (minutes) => `Enter it on the sign-in page. The code is valid for ${minutes} minutes.`,
      linkLabel: "Go to sign-in",
      linkTextPrefix: "Sign in here:",
      notRequested:
        "Didn't request this? Then just ignore this email. Nobody can sign in to your account without the code.",
      signOff: "Best regards",
      footerReason: (app) => `You are receiving this email because a sign-in code for your ${app} account was requested.`
    }
  },
  registration_code: {
    de: {
      subject: (app) => `Willkommen bei ${app} – dein Login-Code`,
      preheader: (minutes) => `Der Code ist ${minutes} Minuten gültig.`,
      greeting: (name) => (name ? `Hallo ${name},` : "Hallo,"),
      intro: (app) => `schön, dass du bei ${app} dabei bist. Hier ist dein Code für die erste Anmeldung:`,
      codeLabel: "Dein Login-Code",
      instruction: (minutes) => `Gib ihn auf der Anmeldeseite ein. Der Code ist ${minutes} Minuten gültig.`,
      linkLabel: "Zur Anmeldung",
      linkTextPrefix: "Zur Anmeldung:",
      notRequested:
        "Du hast dich nicht registriert? Dann ignoriere diese Mail. Ohne den Code kann niemand das Konto nutzen.",
      signOff: "Viele Grüße",
      footerReason: (app) => `Du bekommst diese Mail, weil bei ${app} ein Konto mit dieser Adresse angelegt wurde.`
    },
    en: {
      subject: (app) => `Welcome to ${app} – your sign-in code`,
      preheader: (minutes) => `The code is valid for ${minutes} minutes.`,
      greeting: (name) => (name ? `Hi ${name},` : "Hi,"),
      intro: (app) => `great to have you on ${app}. Here is your code for your first sign-in:`,
      codeLabel: "Your sign-in code",
      instruction: (minutes) => `Enter it on the sign-in page. The code is valid for ${minutes} minutes.`,
      linkLabel: "Go to sign-in",
      linkTextPrefix: "Sign in here:",
      notRequested:
        "Didn't sign up? Then just ignore this email. Nobody can use the account without the code.",
      signOff: "Best regards",
      footerReason: (app) => `You are receiving this email because an ${app} account was created with this address.`
    }
  },
  email_change_code: {
    de: {
      subject: (app) => `Bestätige deine neue E-Mail-Adresse für ${app}`,
      preheader: (minutes) => `Der Bestätigungscode ist ${minutes} Minuten gültig.`,
      greeting: (name) => (name ? `Hallo ${name},` : "Hallo,"),
      intro: (app) => `du möchtest deine E-Mail-Adresse bei ${app} auf diese Adresse ändern. Hier ist dein Bestätigungscode:`,
      codeLabel: "Dein Bestätigungscode",
      instruction: (minutes) => `Gib ihn in deinem Profil ein. Der Code ist ${minutes} Minuten gültig.`,
      linkLabel: "Zum Profil",
      linkTextPrefix: "Zum Profil:",
      notRequested:
        "Du hast das nicht angefordert? Dann ignoriere diese Mail. Deine bisherige Adresse bleibt unverändert.",
      signOff: "Viele Grüße",
      footerReason: (app) => `Du bekommst diese Mail, weil diese Adresse bei ${app} als neue E-Mail-Adresse eingetragen wurde.`
    },
    en: {
      subject: (app) => `Confirm your new email address for ${app}`,
      preheader: (minutes) => `The confirmation code is valid for ${minutes} minutes.`,
      greeting: (name) => (name ? `Hi ${name},` : "Hi,"),
      intro: (app) => `you want to change your ${app} email address to this one. Here is your confirmation code:`,
      codeLabel: "Your confirmation code",
      instruction: (minutes) => `Enter it in your profile. The code is valid for ${minutes} minutes.`,
      linkLabel: "Open your profile",
      linkTextPrefix: "Open your profile:",
      notRequested:
        "Didn't request this? Then just ignore this email. Your current address stays unchanged.",
      signOff: "Best regards",
      footerReason: (app) => `You are receiving this email because this address was entered as the new email for an ${app} account.`
    }
  }
};

/** Steuerzeichen (inkl. CR/LF) entfernen und Leerraum zusammenfassen – schützt Text, HTML und Header. */
export function sanitizeInline(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeAccentColor(value: string | null | undefined): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : DEFAULT_ACCENT;
}

/** Weiß oder Dunkelgrau als Schriftfarbe auf der Akzentfarbe (WCAG-Kontrast). */
export function readableTextOn(hex: string): string {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  const contrastWhite = 1.05 / (luminance + 0.05);
  const darkLuminance = 0.0225; // #1f2933
  const contrastDark = (luminance + 0.05) / (darkLuminance + 0.05);
  return contrastWhite >= contrastDark ? "#ffffff" : "#1f2933";
}

export function linkTargetFor(kind: SystemMailKind, publicUrl: string | null): string | null {
  if (!publicUrl) {
    return null;
  }
  // Hash-Routing der SPA: #login zeigt die Anmeldung bzw. – angemeldet – das Profil
  // (dort wird auch der Code für die E-Mail-Änderung eingegeben).
  void kind;
  return `${publicUrl}/#login`;
}

function footerDomain(content: SystemMailContent): string | null {
  if (content.publicUrl) {
    try {
      return new URL(content.publicUrl).host;
    } catch {
      return null;
    }
  }
  return content.fallbackDomain;
}

export function renderSystemMail(content: SystemMailContent): RenderedSystemMail {
  const copy = COPY[content.kind][content.locale] ?? COPY[content.kind].de;
  const appName = sanitizeInline(content.appName) || "Mitspielzentrale";
  const recipientName = sanitizeInline(content.recipientName);
  const code = sanitizeInline(content.code);
  const accent = normalizeAccentColor(content.accentColor);
  const onAccent = readableTextOn(accent);
  const link = linkTargetFor(content.kind, content.publicUrl);
  const domain = footerDomain(content);
  const footerLine = domain ? `${appName} · ${domain}` : appName;
  const subject = copy.subject(appName);

  const textLines = [
    copy.greeting(recipientName),
    "",
    copy.intro(appName),
    "",
    `    ${code}`,
    "",
    copy.instruction(content.validMinutes),
    ""
  ];
  if (link) {
    textLines.push(`${copy.linkTextPrefix} ${link}`, "");
  }
  textLines.push(copy.notRequested, "", copy.signOff, appName, "", "-- ", footerLine, copy.footerReason(appName), "");
  const text = textLines.join("\n");

  const e = escapeHtml;
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const buttonHtml = link
    ? `<tr><td style="padding:8px 32px 8px 32px;">` +
      `<a href="${e(link)}" style="display:inline-block;background:${accent};color:${onAccent};text-decoration:none;font-weight:600;font-size:15px;line-height:20px;padding:11px 22px;border-radius:6px;">${e(copy.linkLabel)}</a>` +
      `<p style="margin:12px 0 0 0;font-size:13px;line-height:19px;color:#52606d;">${e(copy.linkTextPrefix)} <a href="${e(link)}" style="color:${accent};">${e(link)}</a></p>` +
      `</td></tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="${content.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(copy.preheader(content.validMinutes))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5f7;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:8px;border-top:4px solid ${accent};font-family:${font};color:#1f2933;">
<tr><td style="padding:24px 32px 0 32px;font-size:18px;line-height:24px;font-weight:700;color:${accent};">${e(appName)}</td></tr>
<tr><td style="padding:16px 32px 0 32px;font-size:15px;line-height:22px;">
<p style="margin:0 0 12px 0;">${e(copy.greeting(recipientName))}</p>
<p style="margin:0;">${e(copy.intro(appName))}</p>
</td></tr>
<tr><td style="padding:16px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #d9dee3;border-left:4px solid ${accent};border-radius:6px;background:#f8fafb;">
<tr><td style="padding:12px 20px 4px 20px;font-size:12px;line-height:16px;color:#52606d;text-transform:uppercase;letter-spacing:0.06em;">${e(copy.codeLabel)}</td></tr>
<tr><td style="padding:0 20px 12px 20px;font-family:Consolas,'Courier New',monospace;font-size:30px;line-height:38px;font-weight:700;letter-spacing:0.18em;color:#1f2933;">${e(code)}</td></tr>
</table>
</td></tr>
<tr><td style="padding:0 32px 8px 32px;font-size:15px;line-height:22px;">
<p style="margin:0;">${e(copy.instruction(content.validMinutes))}</p>
</td></tr>
${buttonHtml}
<tr><td style="padding:16px 32px 24px 32px;font-size:14px;line-height:21px;color:#3e4c59;">
<p style="margin:0 0 12px 0;">${e(copy.notRequested)}</p>
<p style="margin:0;">${e(copy.signOff)}<br>${e(appName)}</p>
</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${font};">
<tr><td style="padding:16px 32px;font-size:12px;line-height:18px;color:#7b8794;text-align:center;">
${e(footerLine)}<br>${e(copy.footerReason(appName))}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;

  return {
    subject,
    text,
    html,
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      "Content-Language": content.locale
    }
  };
}
