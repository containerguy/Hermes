import { describe, expect, it } from "vitest";
import { renderEventInfoMail } from "./event-info-template";

describe("Event-Info-Mail", () => {
  it("escapes the organizer text and adds the unsubscribe header", () => {
    const mail = renderEventInfoMail({
      locale: "de",
      appName: "Mitspielzentrale",
      recipientName: "Gast",
      eventName: "LAN",
      subject: "Aufbau",
      body: "<b>Hallo</b>\n\nInfos: https://lan.example/plan",
      eventUrl: "https://lan.example/#main-events",
      unsubscribeUrl: "https://lan.example/api/notifications/unsubscribe/abc",
      accentColor: "#123456"
    });
    expect(mail.html).not.toContain("<b>Hallo</b>");
    expect(mail.html).toContain("&lt;b&gt;Hallo&lt;/b&gt;");
    expect(mail.html).toContain('href="https://lan.example/plan"');
    expect(mail.text).toContain("https://lan.example/api/notifications/unsubscribe/abc");
    expect(mail.headers["List-Unsubscribe"]).toBe("<https://lan.example/api/notifications/unsubscribe/abc>");
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});
