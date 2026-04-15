import nodemailer from "nodemailer";

type SendLoginCodeInput = {
  to: string;
  username: string;
  code: string;
};

function readBoolean(value: string | undefined) {
  return value === "true" || value === "1";
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
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: readBoolean(process.env.HERMES_SMTP_SECURE),
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
