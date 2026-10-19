import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type DatabaseContext } from "../db/client";
import { runMigrations } from "../db/migrate";
import type { HermesSettings } from "../settings";
import {
  buildSystemMail,
  parseMailFrom,
  resolveMailLocale,
  resolvePublicUrl,
  sendEmailChangeCode,
  sendLoginCode
} from "./mailer";
import { escapeHtml, readableTextOn, renderSystemMail, sanitizeInline } from "./templates";

const PROD_ENV = {
  mailFrom: "Hermes <lanparty@familie-keller.info>",
  publicUrl: "https://mitspielzentrale.familie-keller.info"
};

function freshContext(): DatabaseContext {
  const context = createDb(":memory:");
  runMigrations(context.sqlite);
  return context;
}

function putSettings(context: DatabaseContext, values: Partial<HermesSettings>) {
  const statement = context.sqlite.prepare(
    `INSERT INTO app_settings (key, value, updated_by_user_id, updated_at) VALUES (?, ?, NULL, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  for (const [key, value] of Object.entries(values)) {
    statement.run(key, JSON.stringify(value), new Date().toISOString());
  }
}

const recipient = { to: "anna@example.test", username: "anna", code: "482913" };

function unfoldHeaders(raw: string) {
  return raw.split("\n\n")[0].replace(/\n[ \t]+/g, " ").split("\n");
}

/** Minimaler RFC-2047-Decoder für die Tests (UTF-8, B/Q). */
function decodeEncodedWords(value: string) {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?UTF-8\?([BQ])\?([^?]*)\?=/gi, (_match, encoding: string, payload: string) => {
      if (encoding.toUpperCase() === "B") {
        return Buffer.from(payload, "base64").toString("utf8");
      }
      const bytes = Buffer.from(
        payload.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))),
        "latin1"
      );
      return bytes.toString("utf8");
    });
}

async function renderMime(options: ReturnType<typeof buildSystemMail>) {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const info = await transport.sendMail(options);
  return { raw: (info.message as Buffer).toString("utf8"), info };
}

describe("Absendername aus den Einstellungen", () => {
  let context: DatabaseContext;

  beforeEach(() => {
    context = freshContext();
  });

  afterEach(() => {
    context.sqlite.close();
  });

  it("nutzt appName als Anzeigenamen, Adresse bleibt aus HERMES_MAIL_FROM", () => {
    putSettings(context, { appName: "Mitspielzentrale" });
    const mail = buildSystemMail(context, "login_code", recipient, PROD_ENV);
    expect(mail.from).toEqual({ name: "Mitspielzentrale", address: "lanparty@familie-keller.info" });
  });

  it("ändert den Absender ohne Neustart, wenn der Admin den Titel ändert", () => {
    putSettings(context, { appName: "Mitspielzentrale" });
    expect(buildSystemMail(context, "login_code", recipient, PROD_ENV).from).toMatchObject({
      name: "Mitspielzentrale"
    });
    putSettings(context, { appName: "LAN im Keller" });
    const mail = buildSystemMail(context, "login_code", recipient, PROD_ENV);
    expect(mail.from).toMatchObject({ name: "LAN im Keller" });
    expect(mail.subject).toBe("Dein Login-Code für LAN im Keller");
  });

  it("fällt ohne appName auf den eingebauten Namen der Oberfläche zurück – nicht auf „Hermes“ aus der Env", () => {
    const mail = buildSystemMail(context, "login_code", recipient, PROD_ENV);
    expect(mail.from).toEqual({ name: "Mitspielzentrale", address: "lanparty@familie-keller.info" });
  });

  it("eingebauter Name folgt Sprache und Projekt-Template wie im Client", () => {
    putSettings(context, { projectTemplate: "table_tennis" });
    expect(buildSystemMail(context, "login_code", recipient, PROD_ENV).from).toMatchObject({
      name: "Turnierzentrale"
    });
    expect(
      buildSystemMail(context, "login_code", { ...recipient, locale: "en" }, PROD_ENV).from
    ).toMatchObject({ name: "Tournament desk" });
  });

  it("ohne lesbare Einstellungen: Name aus der Env, sonst „Mitspielzentrale“", () => {
    expect(buildSystemMail(null, "login_code", recipient, { mailFrom: "Kellerbande <x@example.test>" }).from).toEqual({
      name: "Kellerbande",
      address: "x@example.test"
    });
    expect(buildSystemMail(null, "login_code", recipient, { mailFrom: "x@example.test" }).from).toEqual({
      name: "Mitspielzentrale",
      address: "x@example.test"
    });
  });

  it("kodiert Umlaute und Anführungszeichen im From-Header korrekt", async () => {
    putSettings(context, { appName: 'Grüße „aus" dem "Keller"' });
    const { raw } = await renderMime(buildSystemMail(context, "login_code", recipient, PROD_ENV));
    const headers = unfoldHeaders(raw);
    const fromLine = headers.find((line) => line.startsWith("From:"))!;
    expect(fromLine).toMatch(/^From: (=\?UTF-8\?[BQ]\?[^?]+\?=\s*)+<lanparty@familie-keller\.info>$/);
    expect(fromLine).not.toContain("ü");
    expect(decodeEncodedWords(fromLine.replace(/^From: /, "").replace(/\s*<[^>]+>$/, ""))).toBe(
      'Grüße „aus" dem "Keller"'
    );
    const subjectLine = headers.find((line) => line.startsWith("Subject:"))!;
    expect(decodeEncodedWords(subjectLine.replace(/^Subject: /, ""))).toBe(
      'Dein Login-Code für Grüße „aus" dem "Keller"'
    );
  });

  it("entfernt Zeilenumbrüche aus dem App-Namen (Header-Injection)", () => {
    putSettings(context, { appName: "Evil\r\nBcc: victim@example.test" });
    const mail = buildSystemMail(context, "login_code", recipient, PROD_ENV);
    expect(mail.from).toMatchObject({ name: "Evil Bcc: victim@example.test" });
    expect(String(mail.subject)).not.toMatch(/[\r\n]/);
  });

  it("nutzt themePrimaryColor als Akzentfarbe", () => {
    putSettings(context, { themePrimaryColor: "#004080" });
    const mail = buildSystemMail(context, "login_code", recipient, PROD_ENV);
    expect(String(mail.html)).toContain("#004080");
  });
});

describe("Mail-Inhalt", () => {
  let context: DatabaseContext;

  beforeEach(() => {
    context = freshContext();
    putSettings(context, { appName: "Mitspielzentrale", themePrimaryColor: "#004080" });
  });

  afterEach(() => {
    context.sqlite.close();
  });

  it("Login-Mail: Betreff ohne Hermes und ohne Code, Code + Link in HTML und Text, Header gesetzt", () => {
    const mail = buildSystemMail(context, "login_code", recipient, PROD_ENV);
    const html = String(mail.html);
    const text = String(mail.text);

    expect(mail.subject).toBe("Dein Login-Code für Mitspielzentrale");
    expect(mail.subject).not.toContain("482913");
    for (const part of [String(mail.subject), html, text]) {
      expect(part.toLowerCase()).not.toContain("hermes");
    }
    expect(html).toContain("482913");
    expect(text).toContain("482913");
    expect(text).toContain("Hallo anna,");
    expect(text).toContain("10 Minuten gültig");
    expect(text).toContain("Du hast das nicht angefordert? Dann ignoriere diese Mail.");
    expect(text).toContain("https://mitspielzentrale.familie-keller.info/#login");
    expect(html).toContain('href="https://mitspielzentrale.familie-keller.info/#login"');
    expect(text).toContain("Mitspielzentrale · mitspielzentrale.familie-keller.info");
    expect(mail.headers).toEqual({
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      "Content-Language": "de"
    });
    expect(mail.headers).not.toHaveProperty("List-Unsubscribe");
    expect(mail.date).toBeInstanceOf(Date);
  });

  it("HTML ist schlicht: keine Skripte, keine externen Bilder, keine Tracking-Pixel", () => {
    const html = String(buildSystemMail(context, "login_code", recipient, PROD_ENV).html);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/url\(/i);
    expect(html).toContain('<html lang="de">');
    expect(html).toContain('role="presentation"');
  });

  it("bevorzugt den Profil-Anzeigenamen für die Anrede", () => {
    const mail = buildSystemMail(context, "login_code", { ...recipient, displayName: "Anna K." }, PROD_ENV);
    expect(String(mail.text)).toContain("Hallo Anna K.,");
  });

  it("escaped Nutzernamen im HTML (XSS/Injection)", () => {
    const evil = '<img src=x onerror="alert(1)"><a href="https://evil.test">klick</a>';
    const mail = buildSystemMail(context, "login_code", { ...recipient, displayName: evil }, PROD_ENV);
    const html = String(mail.html);
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="https://evil.test"');
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("escaped den App-Namen im HTML", () => {
    putSettings(context, { appName: "<b>Bold</b> & Co" });
    const html = String(buildSystemMail(context, "login_code", recipient, PROD_ENV).html);
    expect(html).toContain("&lt;b&gt;Bold&lt;/b&gt; &amp; Co");
    expect(html).not.toContain("<b>Bold</b>");
  });

  it("ohne HERMES_PUBLIC_URL: kein Link, Footer mit Domain der Absenderadresse", () => {
    const mail = buildSystemMail(context, "login_code", recipient, { mailFrom: PROD_ENV.mailFrom });
    expect(String(mail.text)).not.toContain("http");
    expect(String(mail.html)).not.toContain("href=");
    expect(String(mail.text)).toContain("Mitspielzentrale · familie-keller.info");
  });

  it("E-Mail-Änderung und Registrierung im selben Layout", () => {
    const change = buildSystemMail(context, "email_change_code", recipient, PROD_ENV);
    expect(change.subject).toBe("Bestätige deine neue E-Mail-Adresse für Mitspielzentrale");
    expect(String(change.text)).toContain("Deine bisherige Adresse bleibt unverändert.");
    expect(String(change.html)).toContain("482913");
    expect(change.headers).toMatchObject({ "Auto-Submitted": "auto-generated" });

    const registration = buildSystemMail(context, "registration_code", recipient, PROD_ENV);
    expect(registration.subject).toBe("Willkommen bei Mitspielzentrale – dein Login-Code");
    expect(String(registration.html)).toContain("482913");
  });

  it("englische Mail für Nutzer mit Locale en", () => {
    const mail = buildSystemMail(context, "login_code", { ...recipient, locale: "en" }, PROD_ENV);
    expect(mail.subject).toBe("Your sign-in code for Mitspielzentrale");
    expect(String(mail.text)).toContain("Hi anna,");
    expect(String(mail.html)).toContain('<html lang="en">');
    expect(mail.headers).toMatchObject({ "Content-Language": "en" });
  });

  it("HTML-Snapshot (Login, deutsch)", () => {
    const rendered = renderSystemMail({
      kind: "login_code",
      locale: "de",
      appName: "Mitspielzentrale",
      recipientName: "anna",
      code: "482913",
      validMinutes: 10,
      publicUrl: "https://mitspielzentrale.familie-keller.info",
      fallbackDomain: "familie-keller.info",
      accentColor: "#004080"
    });
    expect(rendered.subject).toMatchSnapshot("subject");
    expect(rendered.text).toMatchSnapshot("text");
    expect(rendered.html).toMatchSnapshot("html");
  });

  it("Textanteil im HTML ist ausreichend (kein reines Markup)", () => {
    const html = String(buildSystemMail(context, "login_code", recipient, PROD_ENV).html);
    const visible = html
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    expect(visible.length / html.length).toBeGreaterThan(0.12);
  });
});

describe("MIME", () => {
  it("erzeugt gültiges multipart/alternative mit Text und HTML in UTF-8", async () => {
    const context = freshContext();
    putSettings(context, { appName: "Mitspielzentrale" });
    const { raw, info } = await renderMime(buildSystemMail(context, "login_code", recipient, PROD_ENV));
    context.sqlite.close();

    expect(raw).toMatch(/^Content-Type: multipart\/alternative;/m);
    expect(raw).toMatch(/^Content-Type: text\/plain; charset=utf-8$/m);
    expect(raw).toMatch(/^Content-Type: text\/html; charset=utf-8$/m);
    expect(raw).toMatch(/^Message-ID: <[^@\s]+@familie-keller\.info>$/m);
    expect(raw).toMatch(/^Date: .+\+0000$/m);
    expect(raw).toMatch(/^Auto-Submitted: auto-generated$/m);
    expect(raw).toMatch(/^X-Auto-Response-Suppress: All$/m);
    expect(raw).toMatch(/^Content-Language: de$/m);
    expect(raw).toMatch(/^MIME-Version: 1\.0$/m);
    expect(raw).not.toMatch(/^List-Unsubscribe:/im);
    expect(info.envelope).toEqual({ from: "lanparty@familie-keller.info", to: ["anna@example.test"] });

    const boundary = raw.match(/boundary="([^"]+)"/)?.[1];
    expect(boundary).toBeTruthy();
    expect(raw.split(`--${boundary}`).length).toBe(4); // Präambel, Text, HTML, Abschluss
    expect(raw).toContain(`--${boundary}--`);
  });
});

describe("Hilfsfunktionen", () => {
  it("parseMailFrom", () => {
    expect(parseMailFrom("Hermes <lanparty@familie-keller.info>")).toEqual({
      name: "Hermes",
      address: "lanparty@familie-keller.info"
    });
    expect(parseMailFrom('"Keller, LAN" <a@b.test>')).toEqual({ name: "Keller, LAN", address: "a@b.test" });
    expect(parseMailFrom("a@b.test")).toEqual({ name: null, address: "a@b.test" });
    expect(parseMailFrom(undefined).address).toBe("no-reply@hermes.local");
  });

  it("resolvePublicUrl akzeptiert nur http(s) und normalisiert", () => {
    expect(resolvePublicUrl("https://mitspielzentrale.familie-keller.info/")).toBe(
      "https://mitspielzentrale.familie-keller.info"
    );
    expect(resolvePublicUrl("https://example.test/hermes/?x=1#y")).toBe("https://example.test/hermes");
    expect(resolvePublicUrl("")).toBeNull();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolvePublicUrl("javascript:alert(1)")).toBeNull();
    expect(resolvePublicUrl("https://user:pw@example.test")).toBeNull();
    warn.mockRestore();
  });

  it("resolveMailLocale: Nutzer → Browser → Admin-Default → de", () => {
    expect(resolveMailLocale({ locale: "en", acceptLanguage: "de-DE" }, { defaultLocale: "de" })).toBe("en");
    expect(resolveMailLocale({ locale: null, acceptLanguage: "de-DE,de;q=0.9" }, { defaultLocale: "en" })).toBe("de");
    expect(resolveMailLocale({ locale: null, acceptLanguage: "fr-FR" }, { defaultLocale: "en" })).toBe("en");
    expect(resolveMailLocale({}, null)).toBe("de");
  });

  it("escapeHtml, sanitizeInline, readableTextOn", () => {
    expect(escapeHtml(`<"'&>`)).toBe("&lt;&quot;&#39;&amp;&gt;");
    expect(sanitizeInline("a\r\n\tb c")).toBe("a b c");
    expect(readableTextOn("#004080")).toBe("#ffffff");
    expect(readableTextOn("#facc15")).toBe("#1f2933");
  });
});

describe("Console-Modus", () => {
  const previousMode = process.env.HERMES_MAIL_MODE;

  afterEach(() => {
    process.env.HERMES_MAIL_MODE = previousMode;
    vi.restoreAllMocks();
  });

  it("gibt weiterhin den Code aus und versendet nichts", async () => {
    process.env.HERMES_MAIL_MODE = "console";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const createTransport = vi.spyOn(nodemailer, "createTransport");

    await sendLoginCode(null, recipient);
    await sendEmailChangeCode(null, { ...recipient, code: "111222" });

    expect(log).toHaveBeenCalledWith("[Hermes] Login code for anna <anna@example.test>: 482913");
    expect(log).toHaveBeenCalledWith("[Hermes] Email change code for anna <anna@example.test>: 111222");
    expect(createTransport).not.toHaveBeenCalled();
  });
});
