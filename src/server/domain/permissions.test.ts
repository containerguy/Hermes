import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type DatabaseContext } from "../db/client";
import { runMigrations } from "../db/migrate";
import {
  can,
  effectivePermissions,
  registerModulePermissions,
  removeModulePermissions,
  revokeEventGrants,
  userIdsWithPermission
} from "./permissions";
import { canCreateEvent, canCreateEventSomewhere, canManageEvent } from "./users";

const now = "2026-11-03T12:00:00.000Z";

let dbPath: string;
let context: DatabaseContext;

function addUser(role: "user" | "organizer" | "manager" | "admin" = "user") {
  const id = randomUUID();
  context.sqlite
    .prepare(
      "INSERT INTO users (id, phone_number, username, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(id, `+49${Math.floor(Math.random() * 1e9)}`, `u-${id.slice(0, 8)}`, `${id}@example.test`, role, now, now);
  return { id, role };
}

function addEvent(createdBy: string, status: "planned" | "running" | "ended" = "planned") {
  const id = randomUUID();
  context.sqlite
    .prepare(
      "INSERT INTO main_events (id, name, status, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(id, `Event ${id.slice(0, 4)}`, status, createdBy, now, now);
  return id;
}

function grant(
  userId: string,
  target: { role?: string; permission?: string },
  mainEventId: string | null = null
) {
  const roleId = target.role
    ? (context.sqlite.prepare("SELECT id FROM roles WHERE key = ?").get(target.role) as { id: string }).id
    : null;
  context.sqlite
    .prepare(
      "INSERT INTO user_grants (id, user_id, role_id, permission_key, main_event_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(randomUUID(), userId, roleId, target.permission ?? null, mainEventId, now);
}

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `matchdesk-rbac-${randomUUID()}.sqlite`);
  context = createDb(dbPath);
  runMigrations(context.sqlite);
});

afterEach(() => {
  context.sqlite.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

describe("Grundrollen", () => {
  it("bilden die bisherigen Rollen ab", () => {
    const user = addUser("user");
    const organizer = addUser("organizer");
    const manager = addUser("manager");
    const admin = addUser("admin");

    expect(canCreateEvent(context, user)).toBe(false);
    expect(canCreateEvent(context, organizer)).toBe(true);
    expect(can(context, organizer, "rounds.manage")).toBe(false);
    expect(can(context, manager, "rounds.manage")).toBe(true);
    expect(can(context, manager, "admin.access")).toBe(false);
    expect(can(context, manager, "servers.bind")).toBe(false);
    expect(can(context, admin, "servers.bind")).toBe(true);
    // Admin darf alles, auch unbekannte Modulrechte.
    expect(can(context, admin, "polls.manage")).toBe(true);
  });

  it("lässt Organisatoren nur eigene Runden verwalten, Manager alle", () => {
    const organizer = addUser("organizer");
    const manager = addUser("manager");
    expect(canManageEvent(context, organizer, { createdByUserId: organizer.id })).toBe(true);
    expect(canManageEvent(context, organizer, { createdByUserId: "other" })).toBe(false);
    expect(canManageEvent(context, manager, { createdByUserId: "other" })).toBe(true);
  });
});

describe("Vergaben", () => {
  it("globale Rolle bleibt nach dem Eventende", () => {
    const admin = addUser("admin");
    const user = addUser("user");
    const eventId = addEvent(admin.id, "running");
    grant(user.id, { role: "organizer" });

    revokeEventGrants(context, eventId, now);
    context.sqlite.prepare("UPDATE main_events SET status = 'ended' WHERE id = ?").run(eventId);

    expect(canCreateEvent(context, user)).toBe(true);
  });

  it("Event-Vergabe gilt nur für das Event und erlischt mit dem Ende", () => {
    const admin = addUser("admin");
    const user = addUser("user");
    const eventId = addEvent(admin.id, "running");
    const otherEventId = addEvent(admin.id, "planned");
    grant(user.id, { role: "manager" }, eventId);

    expect(can(context, user, "rounds.manage", { mainEventId: eventId })).toBe(true);
    expect(can(context, user, "rounds.manage", { mainEventId: otherEventId })).toBe(false);
    expect(can(context, user, "rounds.manage")).toBe(false);
    expect(canCreateEventSomewhere(context, user)).toBe(true);
    expect(canManageEvent(context, user, { createdByUserId: "other", mainEventId: eventId })).toBe(true);

    // Beendet = sofort wirkungslos, auch ohne ausdrücklichen Widerruf.
    context.sqlite.prepare("UPDATE main_events SET status = 'ended' WHERE id = ?").run(eventId);
    expect(can(context, user, "rounds.manage", { mainEventId: eventId })).toBe(false);
    expect(canCreateEventSomewhere(context, user)).toBe(false);
  });

  it("Administration wirkt nie über eine Event-Vergabe", () => {
    const admin = addUser("admin");
    const user = addUser("user");
    const eventId = addEvent(admin.id, "running");
    grant(user.id, { role: "admin" }, eventId);

    expect(can(context, user, "admin.access")).toBe(false);
    expect(effectivePermissions(context, user).isAdmin).toBe(false);
    // Nicht pro Event gedachte Rechte wirken über eine Event-Vergabe nicht.
    expect(can(context, user, "servers.bind", { mainEventId: eventId })).toBe(false);
    expect(can(context, user, "rounds.manage", { mainEventId: eventId })).toBe(true);
  });

  it("Einzelrecht global und widerrufene Vergaben", () => {
    const admin = addUser("admin");
    const user = addUser("user");
    const eventId = addEvent(admin.id, "planned");
    grant(user.id, { permission: "pizza.manage" });
    grant(user.id, { permission: "notifications.operator" }, eventId);

    expect(can(context, user, "pizza.manage")).toBe(true);
    expect(userIdsWithPermission(context, "notifications.operator", { mainEventId: eventId })).toContain(user.id);
    expect(userIdsWithPermission(context, "notifications.operator")).not.toContain(user.id);

    expect(revokeEventGrants(context, eventId, now)).toBe(1);
    expect(can(context, user, "notifications.operator", { mainEventId: eventId })).toBe(false);
  });
});

describe("Modulrechte", () => {
  it("anmelden mit Standardrollen und entfernen samt Vergaben", () => {
    const manager = addUser("manager");
    const organizer = addUser("organizer");
    const user = addUser("user");

    registerModulePermissions(context, "polls", [
      { key: "polls.manage", label: "Abstimmungen verwalten", scopable: true, defaultRoles: ["manager"] }
    ]);
    // Zweites Anmelden ist harmlos.
    registerModulePermissions(context, "polls", [{ key: "polls.manage", label: "Abstimmungen verwalten" }]);
    grant(user.id, { permission: "polls.manage" });

    expect(can(context, manager, "polls.manage")).toBe(true);
    expect(can(context, organizer, "polls.manage")).toBe(false);
    expect(can(context, user, "polls.manage")).toBe(true);

    expect(removeModulePermissions(context, "polls")).toBe(1);
    expect(can(context, manager, "polls.manage")).toBe(false);
    expect(can(context, user, "polls.manage")).toBe(false);
    expect(context.sqlite.prepare("SELECT COUNT(*) AS n FROM user_grants").get()).toEqual({ n: 0 });
  });

  it("Standardrolle user gibt das Recht jedem Benutzer", () => {
    const user = addUser("user");
    registerModulePermissions(context, "pizza2", [{ key: "pizza2.order", label: "Bestellen", defaultRoles: ["user"] }]);
    expect(can(context, user, "pizza2.order")).toBe(true);
  });

  it("lehnt Schlüssel ohne Modul-Präfix ab", () => {
    expect(() => registerModulePermissions(context, "polls", [{ key: "rounds.manage", label: "x" }])).toThrow();
  });
});
