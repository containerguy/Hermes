import fs from "node:fs";
import { randomUUID } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { bootstrapAdmin } from "../src/server/db/bootstrap-admin";
import { createHermesApp } from "../src/server/app";

let server: http.Server;
let closeApp: () => Promise<void>;
let baseUrl: string;
let databasePath: string;

async function login(page: Page, username: string) {
  await page.goto(`${baseUrl}/#login`);
  await page.getByLabel("Username").fill(username);
  await page.getByRole("button", { name: "Code senden" }).click();
  await expect(page.getByText("Code wurde per E-Mail versendet.")).toBeVisible();
  await page.getByLabel("Einmalcode").fill("123456");
  await page.getByLabel("Gerätename").fill("Browser");
  await page.getByRole("button", { name: "Einloggen" }).click();
  await expect(page.getByRole("region", { name: "Aktuelle Anmeldung" })).toContainText(username);
}

test.beforeAll(async () => {
  databasePath = path.join(os.tmpdir(), `hermes-e2e-${randomUUID()}.sqlite`);
  process.env.HERMES_DB_PATH = databasePath;
  process.env.HERMES_ADMIN_PHONE = "+491701234567";
  process.env.HERMES_ADMIN_USERNAME = "hauptadmin";
  process.env.HERMES_ADMIN_EMAIL = "hauptadmin@example.test";
  process.env.HERMES_MAIL_MODE = "console";
  process.env.HERMES_DEV_LOGIN_CODE = "123456";
  delete process.env.HERMES_STORAGE_BACKEND;
  delete process.env.HERMES_VAPID_PUBLIC_KEY;
  delete process.env.HERMES_VAPID_PRIVATE_KEY;

  await bootstrapAdmin();
  const started = await createHermesApp();
  closeApp = started.close;
  server = started.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to start test server");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeApp();

  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

test("admin creates users, manager creates an event, user joins", async ({ page }) => {
  await page.goto(baseUrl);
  await login(page, "hauptadmin");
  await page.goto(`${baseUrl}/#admin`);

  const adminPanel = page.getByLabel("Adminbereich");
  await adminPanel.getByLabel("Username").fill("manager");
  await adminPanel.getByLabel("E-Mail").fill("manager@example.test");
  await adminPanel.getByLabel("Rolle").first().selectOption("manager");
  await adminPanel.getByRole("button", { name: "User anlegen" }).click();
  await expect(adminPanel.getByText("manager@example.test")).toBeVisible();

  await adminPanel.getByLabel("Username").fill("spieler");
  await adminPanel.getByLabel("E-Mail").fill("spieler@example.test");
  await adminPanel.getByLabel("Rolle").first().selectOption("user");
  await adminPanel.getByRole("button", { name: "User anlegen" }).click();
  await expect(adminPanel.getByText("spieler@example.test")).toBeVisible();

  await page.goto(`${baseUrl}/#login`);
  await page.getByRole("button", { name: "Logout" }).click();
  await login(page, "manager");
  await page.goto(`${baseUrl}/#manager`);

  const eventForm = page.locator("form.event-form");
  await eventForm.getByLabel("Spiel").fill("Browser Game");
  await eventForm.locator("select").first().selectOption("scheduled");
  await eventForm.getByLabel("Startzeit").fill("2027-06-01T18:00");
  await eventForm.getByLabel("Min").fill("1");
  await eventForm.getByLabel("Max").fill("2");
  await eventForm.getByRole("button", { name: "Event anlegen" }).click();
  await expect(page.getByText("Browser Game")).toBeVisible();

  await page.goto(`${baseUrl}/#login`);
  await page.getByRole("button", { name: "Logout" }).click();
  await login(page, "spieler");
  await page.goto(`${baseUrl}/#events`);
  await page.getByRole("button", { name: /Details aufklappen/ }).click();
  await page.getByRole("button", { name: "Dabei", exact: true }).click();
  await expect(page.getByText("1 / 2")).toBeVisible();
});

test("responsive shell and profile guidance regions stay visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl);
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".brand")).toBeVisible();
  await expect(page.locator(".page-shell")).toBeVisible();

  await login(page, "hauptadmin");
  await page.goto(`${baseUrl}/#login`);
  await expect(page.getByRole("region", { name: "Aktuelle Anmeldung" })).toBeVisible();
  await expect(page.locator(".runtime-callout")).toBeVisible();
  await expect(page.locator(".install-hint-card")).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${baseUrl}/#events`);
  await expect(page.locator(".page-hero")).toBeVisible();
  await expect(page.getByRole("region", { name: "Events" })).toBeVisible();
});
