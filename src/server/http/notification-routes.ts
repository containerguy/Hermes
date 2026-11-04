import express, { Router } from "express";
import { z } from "zod";
import { requireCsrf } from "../auth/csrf";
import { requireUser } from "../auth/current-user";
import { enforceApiTokenWriteAccess } from "../auth/matchdesk-auth";
import { tryWriteAuditLog } from "../audit-log";
import type { DatabaseContext } from "../db/client";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { escapeHtml } from "../mail/templates";
import { channelChoicesFor, setChannelPreference, unsubscribeByToken } from "../notifications/dispatcher";
import { calendarTokenFor, personalCalendar } from "../notifications/reminders";

const preferenceSchema = z.object({ enabled: z.boolean() });

function unsubscribePage(title: string, text: string, form?: { action: string; button: string }) {
  const e = escapeHtml;
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${e(title)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#1f2933;">
<h1 style="font-size:22px;">${e(title)}</h1>
<p>${e(text)}</p>
${form ? `<form method="post" action="${e(form.action)}"><button type="submit" style="font-size:16px;padding:10px 18px;">${e(form.button)}</button></form>` : ""}
<p><a href="/#login/benachrichtigungen">Einstellungen in der App / Settings in the app</a></p>
</body>
</html>`;
}

export function createNotificationRouter(context: DatabaseContext) {
  const router = Router();

  // Abmeldelink aus Mails: ohne Anmeldung, der Token ist das Geheimnis. GET zeigt nur eine
  // Bestätigung (Link-Scanner lösen sonst ungewollt Abmeldungen aus), POST meldet ab.
  router.get("/unsubscribe/:token", (request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.send(
      unsubscribePage(
        "Event-Infos abbestellen / Unsubscribe",
        "Du bekommst dann keine Rundnachrichten und Erinnerungen zu Events mehr, weder per Mail noch über andere Kanäle. Login-Codes kommen weiter. / You will no longer receive event updates; sign-in codes still arrive.",
        { action: `/api/notifications/unsubscribe/${encodeURIComponent(String(request.params.token))}`, button: "Abbestellen / Unsubscribe" }
      )
    );
  });

  router.post("/unsubscribe/:token", express.urlencoded({ extended: false, limit: "2kb" }), (request, response) => {
    const userId = unsubscribeByToken(context, String(request.params.token));
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    if (!userId) {
      response.status(404).send(unsubscribePage("Link ungültig / Invalid link", "Dieser Abmeldelink ist nicht (mehr) gültig. / This link is not valid."));
      return;
    }
    tryWriteAuditLog(context, {
      actor: undefined,
      action: "notifications.unsubscribe",
      entityType: "user",
      entityId: userId,
      summary: "Ein Benutzer hat Event-Infos über den Abmeldelink abbestellt."
    });
    response.send(
      unsubscribePage(
        "Abbestellt / Unsubscribed",
        "Du bekommst keine Event-Infos mehr. In deinem Profil kannst du Kanäle jederzeit wieder einschalten. / You can turn channels back on in your profile."
      )
    );
  });

  // Abonnierbarer Kalender: ohne Anmeldung, der Token im Pfad ist das Geheimnis.
  router.get("/calendar/:file", (request, response) => {
    const token = String(request.params.file).replace(/\.ics$/, "");
    const calendar = personalCalendar(context, token);
    if (!calendar) {
      response.status(404).json({ error: "kalender_nicht_gefunden" });
      return;
    }
    response.setHeader("Content-Type", "text/calendar; charset=utf-8");
    response.setHeader("Cache-Control", "private, max-age=300");
    response.send(calendar);
  });

  router.use((request, response, next) => {
    const user = requireUser(context, request);
    if (!user) {
      response.status(401).json({ error: "nicht_angemeldet" });
      return;
    }
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
      if (!enforceApiTokenWriteAccess(request, response)) {
        return;
      }
      if (!requireCsrf(context, request, response)) {
        return;
      }
    }
    next();
  });

  router.get("/channels", (request, response) => {
    const user = requireUser(context, request)!;
    response.json({
      channels: channelChoicesFor(context, user),
      unsubscribed: Boolean(user.eventInfoUnsubscribedAt)
    });
  });

  router.get("/calendar-feed", (request, response) => {
    const user = requireUser(context, request)!;
    response.json({ path: `/api/notifications/calendar/${calendarTokenFor(context, user.id)}.ics` });
  });

  // Neuer Link, z. B. wenn der alte weitergegeben wurde. Der alte hört sofort auf zu funktionieren.
  router.post("/calendar-feed/renew", (request, response) => {
    const user = requireUser(context, request)!;
    response.json({ path: `/api/notifications/calendar/${calendarTokenFor(context, user.id, true)}.ics` });
  });

  router.put("/channels/:id", (request, response) => {
    const user = requireUser(context, request)!;
    const parsed = preferenceSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "ungueltige_preferenz" });
      return;
    }
    if (!setChannelPreference(context, user.id, String(request.params.id), parsed.data.enabled)) {
      response.status(404).json({ error: "kanal_unbekannt" });
      return;
    }
    const refreshed = context.db.select().from(users).where(eq(users.id, user.id)).get()!;
    response.json({
      channels: channelChoicesFor(context, refreshed),
      unsubscribed: Boolean(refreshed.eventInfoUnsubscribedAt)
    });
  });

  return router;
}
