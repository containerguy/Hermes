import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../db/client";
import { runMigrations } from "../db/migrate";

vi.mock("web-push", () => {
  return {
    default: {
      setVapidDetails: vi.fn(),
      sendNotification: vi.fn()
    }
  };
});

import webpush from "web-push";
import { sendPushToUser } from "./push-service";

function nowIso() {
  return new Date().toISOString();
}

describe("push-service cleanup (PWA-03)", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `hermes-test-${randomUUID()}.sqlite`);
    process.env.HERMES_DB_PATH = dbPath;
    process.env.HERMES_VAPID_PUBLIC_KEY = "test-public";
    process.env.HERMES_VAPID_PRIVATE_KEY = "test-private";
  });

  afterEach(() => {
    delete process.env.HERMES_DB_PATH;
    delete process.env.HERMES_VAPID_PUBLIC_KEY;
    delete process.env.HERMES_VAPID_PRIVATE_KEY;
    vi.clearAllMocks();

    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${dbPath}${suffix}`, { force: true });
    }
  });

  it("revokes subscriptions after repeated delivery failures without affecting others", async () => {
    const context = createDb(dbPath);
    runMigrations(context.sqlite);

    const userId = "user-1";
    context.sqlite
      .prepare(
        `INSERT INTO users (id, phone_number, username, email, role, notifications_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(userId, "+491700000000", "user1", "user1@example.test", "user", 1, nowIso(), nowIso());

    const failingId = "sub-failing";
    const okId = "sub-ok";
    context.sqlite
      .prepare(
        `INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(failingId, userId, null, "https://example.test/fail", "p", "a", nowIso());
    context.sqlite
      .prepare(
        `INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(okId, userId, null, "https://example.test/ok", "p2", "a2", nowIso());

    const sendNotification = webpush.sendNotification as unknown as ReturnType<typeof vi.fn>;
    sendNotification.mockImplementation(async ({ endpoint }: { endpoint: string }) => {
      if (endpoint.includes("/fail")) {
        const error = new Error("boom") as Error & { statusCode?: number };
        error.statusCode = 500;
        throw error;
      }
      return undefined;
    });

    await sendPushToUser(context, userId, { title: "t", body: "b" });
    await sendPushToUser(context, userId, { title: "t", body: "b" });
    await sendPushToUser(context, userId, { title: "t", body: "b" });

    const failing = context.sqlite
      .prepare(
        "SELECT revoked_at as revokedAt, failure_count as failureCount FROM push_subscriptions WHERE id = ?"
      )
      .get(failingId) as { revokedAt: string | null; failureCount: number };
    expect(failing.revokedAt).toBeTruthy();
    expect(failing.failureCount).toBeGreaterThanOrEqual(3);

    const ok = context.sqlite
      .prepare(
        "SELECT revoked_at as revokedAt, failure_count as failureCount FROM push_subscriptions WHERE id = ?"
      )
      .get(okId) as { revokedAt: string | null; failureCount: number };
    expect(ok.revokedAt).toBeNull();
    expect(ok.failureCount).toBe(0);
  });

  it("revokes subscriptions immediately on 410/404", async () => {
    const context = createDb(dbPath);
    runMigrations(context.sqlite);

    const userId = "user-1";
    context.sqlite
      .prepare(
        `INSERT INTO users (id, phone_number, username, email, role, notifications_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(userId, "+491700000000", "user1", "user1@example.test", "user", 1, nowIso(), nowIso());

    const subId = "sub-gone";
    context.sqlite
      .prepare(
        `INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(subId, userId, null, "https://example.test/gone", "p", "a", nowIso());

    const sendNotification = webpush.sendNotification as unknown as ReturnType<typeof vi.fn>;
    sendNotification.mockImplementation(async () => {
      const error = new Error("gone") as Error & { statusCode?: number };
      error.statusCode = 410;
      throw error;
    });

    await sendPushToUser(context, userId, { title: "t", body: "b" });

    const row = context.sqlite
      .prepare("SELECT revoked_at as revokedAt FROM push_subscriptions WHERE id = ?")
      .get(subId) as { revokedAt: string | null };
    expect(row.revokedAt).toBeTruthy();
  });
});

