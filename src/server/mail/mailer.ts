import nodemailer from "nodemailer";

type SendLoginCodeInput = {
  to: string;
  username: string;
  code: string;
};

type SendEmailChangeCodeInput = {
  to: string;
  username: string;
  code: string;
};

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

export async function sendLoginCode(input: SendLoginCodeInput) {
  const mode = process.env.HERMES_MAIL_MODE ?? "console";
  const from = process.env.HERMES_MAIL_FROM ?? "Hermes <no-reply@hermes.local>";

  if (mode === "console") {
    console.log(`[Hermes] Login code for ${input.username} <${input.to}>: ${input.code}`);
    return;
  }

  const host = process.env.HERMES_SMTP_HOST;
  const port = Number(process.env.HERMES_SMTP_PORT ?? "587");

  if (!host) {
    throw new Error("HERMES_SMTP_HOST is required when HERMES_MAIL_MODE=smtp");
  }

  const user = process.env.HERMES_SMTP_USER;
  const pass = process.env.HERMES_SMTP_PASSWORD;
  const security = resolveSmtpSecurity(port);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: security.secure,
    requireTLS: security.requireTLS,
    auth: user && pass ? { user, pass } : undefined
  });

  await transporter.sendMail({
    from,
    to: input.to,
    subject: "Dein Hermes Login-Code",
    text: `Hallo ${input.username},\n\nDein Hermes Login-Code lautet: ${input.code}\n\nDer Code ist 10 Minuten gueltig.`,
    html: `<p>Hallo ${input.username},</p><p>Dein Hermes Login-Code lautet: <strong>${input.code}</strong></p><p>Der Code ist 10 Minuten gueltig.</p>`
  });
}

export async function sendEmailChangeCode(input: SendEmailChangeCodeInput) {
  const mode = process.env.HERMES_MAIL_MODE ?? "console";
  const from = process.env.HERMES_MAIL_FROM ?? "Hermes <no-reply@hermes.local>";

  if (mode === "console") {
    console.log(`[Hermes] Email change code for ${input.username} <${input.to}>: ${input.code}`);
    return;
  }

  const host = process.env.HERMES_SMTP_HOST;
  const port = Number(process.env.HERMES_SMTP_PORT ?? "587");

  if (!host) {
    throw new Error("HERMES_SMTP_HOST is required when HERMES_MAIL_MODE=smtp");
  }

  const user = process.env.HERMES_SMTP_USER;
  const pass = process.env.HERMES_SMTP_PASSWORD;
  const security = resolveSmtpSecurity(port);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: security.secure,
    requireTLS: security.requireTLS,
    auth: user && pass ? { user, pass } : undefined
  });

  await transporter.sendMail({
    from,
    to: input.to,
    subject: "Bestaetige deine neue Hermes E-Mail",
    text: `Hallo ${input.username},\n\nDein Hermes Code zur E-Mail-Aenderung lautet: ${input.code}\n\nDer Code ist 10 Minuten gueltig.`,
    html: `<p>Hallo ${input.username},</p><p>Dein Hermes Code zur E-Mail-Aenderung lautet: <strong>${input.code}</strong></p><p>Der Code ist 10 Minuten gueltig.</p>`
  });
}
