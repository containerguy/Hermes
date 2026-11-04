import { describe, expect, it } from "vitest";
import { maskInviteCode } from "./audit-log";

describe("maskInviteCode", () => {
  it("returns empty string for empty input", () => {
    expect(maskInviteCode("")).toBe("");
  });

  it("returns empty string for whitespace-only input (trim)", () => {
    expect(maskInviteCode("   ")).toBe("");
  });

  it("masks short codes (<=6 chars) with single-char prefix + suffix", () => {
    expect(maskInviteCode("ABC")).toBe("A***C");
    expect(maskInviteCode("ABCD")).toBe("A***D");
    expect(maskInviteCode("ABCDEF")).toBe("A***F");
  });

  it("masks long codes (>6 chars) with three-char prefix + suffix", () => {
    expect(maskInviteCode("ABCDEFGHIJ")).toBe("ABC***HIJ");
    expect(maskInviteCode("INV-1234567890")).toBe("INV***890");
  });

  it("trims before classifying length", () => {
    expect(maskInviteCode("  ABCDEF  ")).toBe("A***F");
    expect(maskInviteCode("  ABCDEFGHIJ  ")).toBe("ABC***HIJ");
  });

  it("single-char input still produces a masked value", () => {
    expect(maskInviteCode("X")).toBe("X***X");
  });
});

describe("listAuditLogs mit Seiten und Filtern", () => {
  it("blättert, filtert nach Text, Aktion und Benutzer und liefert die Auswahl", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs");
    const { randomUUID } = await import("node:crypto");
    const { createDb } = await import("./db/client");
    const { runMigrations } = await import("./db/migrate");
    const { writeAuditLog, listAuditLogs, countAuditLogs, auditLogFacets } = await import("./audit-log");

    const file = path.join(os.tmpdir(), `matchdesk-audit-${randomUUID()}.sqlite`);
    const context = createDb(file);
    runMigrations(context.sqlite);
    try {
      for (let index = 0; index < 7; index += 1) {
        writeAuditLog(context, {
          actor: index % 2 === 0 ? undefined : ({ id: null, username: "anna" } as never),
          action: index < 5 ? "user.create" : "settings.update",
          entityType: "test",
          summary: index === 3 ? "100%_sicher angelegt" : `Eintrag ${index}`
        });
      }

      expect(countAuditLogs(context)).toBe(7);
      const first = listAuditLogs(context, { limit: 3, offset: 0 });
      const second = listAuditLogs(context, { limit: 3, offset: 3 });
      const third = listAuditLogs(context, { limit: 3, offset: 6 });
      expect(first).toHaveLength(3);
      expect(third).toHaveLength(1);
      expect(new Set([...first, ...second, ...third].map((entry) => entry.id)).size).toBe(7);

      expect(countAuditLogs(context, { action: "settings.update" })).toBe(2);
      expect(countAuditLogs(context, { actor: "anna" })).toBe(3);
      expect(countAuditLogs(context, { actor: "__system" })).toBe(4);
      expect(countAuditLogs(context, { q: "%_" })).toBe(1);
      expect(countAuditLogs(context, { q: "ANNA" })).toBe(3);
      expect(listAuditLogs(context, { q: "settings", actor: "anna" }).length).toBe(1);

      expect(auditLogFacets(context)).toEqual({ actions: ["settings.update", "user.create"], actors: ["anna"] });
    } finally {
      context.sqlite.close();
      fs.rmSync(file, { force: true });
    }
  });
});
