import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type { DatabaseContext } from "../db/client";
import { readSettings, type HermesSettings } from "../settings";
import { resolveAppDisplayName, fallbackAppDisplayName } from "../../shared/app-display-name";
import { browserLanguageToLocale, type AppLocale } from "../../shared/locale";
import { renderSystemMail, sanitizeInline, type SystemMailKind } from "./templates";

export const MAIL_CODE_VALID_MINUTES = 10;

const DEFAULT_MAIL_FROM_ADDRESS = "no-reply@hermes.local";

/** Empfänger und Kontext einer System-Mail. */
export type SystemMailRecipient = {
  to: string;
  username: string;
  /** Optionaler Anzeigename aus dem Profil – für die Anrede bevorzugt. */
  displayName?: string | null;
  /** Gespeicherte Nutzersprache (de/en) oder null. */
  locale?: string | null;
  /** Accept-Language der auslösenden Anfrage – wie die Oberfläche als zweite Quelle. */
  acceptLanguage?: string | null;
};

type SendCodeInput = SystemMailRecipient & { code: string };

export type MailFrom = { name: string | null; address: string };

/** `HERMES_MAIL_FROM` zerlegen: `Name <adresse>`, `"Name" <adresse>` oder nur `adresse`. */
export function parseMailFrom(raw: string | undefined | null): MailFrom {
  const value = (raw ?? "").trim();
  if (!value) {
    return { name: null, address: DEFAULT_MAIL_FROM_ADDRESS };
  }
  const match = value.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (match) {
    const name = match[1].trim().replace(/^"(.*)"$/, "$1").trim();
    return { name: name || null, address: match[2] };
  }
  if (/^[^<>\s]+@[^<>\s]+$/.test(value)) {
    return { name: null, address: value };
  }
  return { name: null, address: DEFAULT_MAIL_FROM_ADDRESS };
}

let warnedInvalidPublicUrl = false;

/**
 * Basis-URL für Links in Mails. Nur aus `HERMES_PUBLIC_URL` – bewusst nicht aus Host-/X-Forwarded-Headern
 * der Anfrage: die sind ohne `trust proxy` vom Client frei wählbar und würden Phishing-Links in echte
 * Login-Mails ermöglichen. Ohne Env enthält die Mail keinen Link.
 */
export function resolvePublicUrl(raw: string | undefined | null = process.env.HERMES_PUBLIC_URL): string | null {
  const value = (raw ?? "").trim();
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      throw new Error("unsupported");
    }
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    if (!warnedInvalidPublicUrl) {
      warnedInvalidPublicUrl = true;
      console.warn("[Hermes] HERMES_PUBLIC_URL is not a valid http(s) URL – emails are sent without a link.");
    }
    return null;
  }
}

function tryReadSettings(context: DatabaseContext | null): HermesSettings | null {
  if (!context) {
    return null;
  }
  try {
    return readSettings(context);
  } catch (error) {
    console.error("[Hermes] Could not read settings for email branding", error);
    return null;
  }
}

/** Mail-Sprache wie die Oberfläche: Nutzersprache → Browsersprache → Admin-Default → Deutsch. */
export function resolveMailLocale(
  recipient: Pick<SystemMailRecipient, "locale" | "acceptLanguage">,
  settings: Pick<HermesSettings, "defaultLocale"> | null
): AppLocale {
  if (recipient.locale === "de" || recipient.locale === "en") {
    return recipient.locale;
  }
  return browserLanguageToLocale(recipient.acceptLanguage ?? null, settings?.defaultLocale ?? "de");
}

/**
 * Absender-Anzeigename = Name, den die App in Kopfzeile und Seitentitel zeigt (`appName`, sonst der
 * eingebaute Name je Template/Sprache). Nur wenn die Einstellungen nicht lesbar sind: Name aus
 * `HERMES_MAIL_FROM`, zuletzt „Mitspielzentrale“.
 */
export function resolveSenderName(
  settings: Pick<HermesSettings, "appName" | "projectTemplate"> | null,
  locale: AppLocale,
  envFromName: string | null
): string {
  if (settings) {
    return sanitizeInline(resolveAppDisplayName(settings, locale)) || fallbackAppDisplayName;
  }
  return sanitizeInline(envFromName ?? "") || fallbackAppDisplayName;
}

/** Baut die vollständigen nodemailer-Optionen einer System-Mail (ohne Versand). */
export function buildSystemMail(
  context: DatabaseContext | null,
  kind: SystemMailKind,
  input: SendCodeInput,
  env: { mailFrom?: string | null; publicUrl?: string | null } = {
    mailFrom: process.env.HERMES_MAIL_FROM,
    publicUrl: process.env.HERMES_PUBLIC_URL
  }
): Mail.Options {
  const settings = tryReadSettings(context);
  const from = parseMailFrom(env.mailFrom);
  const locale = resolveMailLocale(input, settings);
  const appName = resolveSenderName(settings, locale, from.name);
  const rendered = renderSystemMail({
    kind,
    locale,
    appName,
    recipientName: input.displayName?.trim() || input.username,
    code: input.code,
    validMinutes: MAIL_CODE_VALID_MINUTES,
    publicUrl: resolvePublicUrl(env.publicUrl),
    fallbackDomain: from.address.split("@").pop() ?? null,
    accentColor: settings?.themePrimaryColor ?? ""
  });

  return {
    from: { name: appName, address: from.address },
    to: input.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    date: new Date(),
    headers: rendered.headers
  };
}

function readBoolean(value: string | undefined) {
  return value === "true" || value === "1";
}

function resolveSmtpSecurity(port: number) {
  const mode = process.env.HERMES_SMTP_SECURITY?.trim().toLowerCase();
  const legacySecure = process.env.HERMES_SMTP_SECURE;

  if (mode === "tls") {
    return { secure: true, requireTLS: false };
  }

  if (mode === "starttls") {
    return { secure: false, requireTLS: true };
  }

  if (mode === "none") {
    return { secure: false, requireTLS: false };
  }

  if (legacySecure !== undefined) {
    const secure = readBoolean(legacySecure);

    if (secure && port !== 465) {
      console.warn(
        "[Hermes] HERMES_SMTP_SECURE=true on a non-465 port is interpreted as STARTTLS. Use HERMES_SMTP_SECURITY=tls for implicit TLS or HERMES_SMTP_SECURITY=starttls for port 587."
      );
      return { secure: false, requireTLS: true };
    }

    return { secure, requireTLS: false };
  }

  return port === 465 ? { secure: true, requireTLS: false } : { secure: false, requireTLS: false };
}

function createSmtpTransport() {
  const host = process.env.HERMES_SMTP_HOST;
  const port = Number(process.env.HERMES_SMTP_PORT ?? "587");

  if (!host) {
    throw new Error("HERMES_SMTP_HOST is required when HERMES_MAIL_MODE=smtp");
  }

  const user = process.env.HERMES_SMTP_USER;
  const pass = process.env.HERMES_SMTP_PASSWORD;
  const security = resolveSmtpSecurity(port);
  return nodemailer.createTransport({
    host,
    port,
    secure: security.secure,
    requireTLS: security.requireTLS,
    auth: user && pass ? { user, pass } : undefined
  });
}

const CONSOLE_LABEL: Record<SystemMailKind, string> = {
  login_code: "Login code",
  registration_code: "Login code",
  email_change_code: "Email change code"
};

async function sendSystemMail(context: DatabaseContext | null, kind: SystemMailKind, input: SendCodeInput) {
  const mode = process.env.HERMES_MAIL_MODE ?? "console";

  if (mode === "console") {
    console.log(`[Hermes] ${CONSOLE_LABEL[kind]} for ${input.username} <${input.to}>: ${input.code}`);
    return;
  }

  const transporter = createSmtpTransport();
  await transporter.sendMail(buildSystemMail(context, kind, input));
}

export async function sendLoginCode(
  context: DatabaseContext | null,
  input: SendCodeInput & { registration?: boolean }
) {
  await sendSystemMail(context, input.registration ? "registration_code" : "login_code", input);
}

export async function sendEmailChangeCode(context: DatabaseContext | null, input: SendCodeInput) {
  await sendSystemMail(context, "email_change_code", input);
}
