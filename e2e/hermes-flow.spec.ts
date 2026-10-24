import fs from "node:fs";
import { randomUUID } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { bootstrapAdmin } from "../src/server/db/bootstrap-admin";
import { createHermesApp } from "../src/server/app";
import { setAmpFetchForTests } from "../src/server/integrations/amp/amp-session";

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
  // Bekannte Geräte blenden das Namensfeld aus (persistente Geräte).
  const deviceName = page.getByLabel("Gerätename");
  if (await deviceName.isVisible()) {
    await deviceName.fill("Browser");
  }
  await page.getByRole("button", { name: "Einloggen" }).click();
  await expect(page.getByRole("region", { name: "Aktuelle Anmeldung" })).toContainText(username);
}

const ampFixture = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "src/server/integrations/amp/__fixtures__/get-instances.json"), "utf8")
) as unknown;

/** Minimaler AMP-Controller: Login, GetInstances (Fixture) und erfolgreiche Aktionen. */
async function mockAmpFetch(url: unknown, init?: { body?: unknown }) {
  const endpoint = String(url).replace(/^.*?\/API\//, "");
  let payload: unknown = { Status: true };
  if (endpoint === "Core/Login") {
    payload = { success: true, sessionID: "S-E2E", rememberMeToken: "R" };
  } else if (endpoint.endsWith("/API/Core/Login")) {
    payload = { success: true, sessionID: "I-E2E" };
  } else if (endpoint === "ADSModule/GetInstances") {
    payload = ampFixture;
  }
  void init;
  return { status: 200, text: async () => JSON.stringify(payload) };
}

const MINECRAFT_INSTANCE_ID = (
  ampFixture as Array<{ AvailableInstances: Array<{ InstanceID: string; InstanceName: string }> }>
)
  .flatMap((target) => target.AvailableInstances)
  .find((instance) => instance.InstanceName === "Minecraft01")!.InstanceID;

async function logout(page: Page) {
  await page.goto(`${baseUrl}/#login`);
  await page.getByRole("button", { name: "Logout" }).click();
}

async function createUserAsAdmin(page: Page, username: string, role: string) {
  await page.goto(`${baseUrl}/#admin`);
  const adminPanel = page.getByLabel("Adminbereich");
  await adminPanel.getByLabel("Username").fill(username);
  await adminPanel.getByLabel("E-Mail").fill(`${username}@example.test`);
  await adminPanel.getByLabel("Rolle").first().selectOption(role);
  await adminPanel.getByRole("button", { name: "User anlegen" }).click();
  await expect(adminPanel.getByText(`${username}@example.test`)).toBeVisible();
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
  // Gameserver-Modul: AMP wird serverseitig gemockt (kein echter Controller im Test).
  process.env.HERMES_AMP_USERNAME = "hermes";
  process.env.HERMES_AMP_PASSWORD = "e2e";
  delete process.env.HERMES_AMP_CA_FILE;
  delete process.env.HERMES_AMP_REMEMBER_TOKEN_FILE;
  setAmpFetchForTests(mockAmpFetch as unknown as Parameters<typeof setAmpFetchForTests>[0]);

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
  setAmpFetchForTests(null);
  delete process.env.HERMES_AMP_USERNAME;
  delete process.env.HERMES_AMP_PASSWORD;
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
  await eventForm.getByRole("button", { name: "Runde anlegen" }).click();
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

test("gameserver: admin binds Minecraft, manager's event shows the server panel, user cannot control it", async ({
  page
}) => {
  test.setTimeout(90_000);
  await page.goto(baseUrl);
  await login(page, "hauptadmin");
  await createUserAsAdmin(page, "srvmanager", "manager");
  await createUserAsAdmin(page, "srvspieler", "user");

  // Modul aktivieren
  await page.goto(`${baseUrl}/#admin/betrieb`);
  const ops = page.locator("form#admin-betrieb");
  await ops.getByLabel("AMP-Anbindung aktivieren").check();
  await ops.getByLabel("AMP-Basis-URL").fill("https://amp-ctl.lanparty.example");
  await expect(ops.getByText("Einstellungen speichern, um danach Server-Bindungen anzulegen.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Server-Bindungen" })).toHaveCount(0);
  await expect(ops.getByLabel("Server automatisch starten, wenn ein Event bereit ist")).not.toBeChecked();
  await expect(ops.getByLabel("Leerlauf-Stopp nach Minuten (0 = aus)")).toHaveValue("0");
  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/api/admin/settings") && response.request().method() === "PUT"
  );
  await ops.getByRole("button", { name: "Einstellungen speichern" }).click();
  expect((await saved).status()).toBe(200);
  // Vor dem Speichern bleibt die Bindungsverwaltung aus; danach lädt sie die Instanzen ohne Reload.

  // Bindung Minecraft anlegen
  const bindings = page.getByRole("region", { name: "Server-Bindungen" });
  const bindingForm = bindings.locator("form");
  await expect(bindingForm.getByLabel("AMP-Instanz").locator(`option[value="${MINECRAFT_INSTANCE_ID}"]`)).toHaveCount(1);
  await bindingForm.getByLabel("Spieltitel").fill("Minecraft");
  await bindingForm.getByLabel("AMP-Instanz").selectOption(MINECRAFT_INSTANCE_ID);
  await bindingForm.getByLabel("Host (DNS-Name oder IP)").fill("minecraft.lanparty.example");
  await bindingForm.getByLabel("Port").fill("25565");
  await bindingForm.getByLabel("Verbinden über").selectOption("minecraft");
  await bindingForm.getByRole("button", { name: "Speichern" }).click();
  await expect(bindings.getByRole("cell", { name: "minecraft.lanparty.example:25565" })).toBeVisible();

  // Manager legt Event "Minecraft" an -> Bindung wird vorgeschlagen und verknüpft
  await logout(page);
  await login(page, "srvmanager");
  await page.goto(`${baseUrl}/#manager`);
  const eventForm = page.locator("form.event-form");
  await eventForm.getByLabel("Spiel").fill("Minecraft");
  await expect(eventForm.getByText("Server für „Minecraft“")).toBeVisible();
  await expect(eventForm.getByLabel("Server mit diesem Event verknüpfen")).toBeChecked();
  await eventForm.locator("select").first().selectOption("scheduled");
  await eventForm.getByLabel("Startzeit").fill("2027-06-01T20:00");
  await eventForm.getByLabel("Min").fill("2");
  await eventForm.getByLabel("Max").fill("8");
  await eventForm.getByRole("button", { name: "Runde anlegen" }).click();

  // Status holen (sofortiger Poll im Server); Minecraft01 steht in der Fixture auf Stopped
  await page.request.get(`${baseUrl}/api/integrations/amp/status?refresh=1`);
  await page.goto(`${baseUrl}/#events`);
  await page.getByRole("button", { name: /^Minecraft, .*Details aufklappen/ }).click();
  const managerPanel = page.getByRole("region", { name: "Gameserver" }).first();
  await expect(managerPanel).toBeVisible();
  await expect(managerPanel.getByText("Server aus")).toBeVisible();
  await expect(managerPanel.getByRole("button", { name: "Start", exact: true })).toBeVisible();

  // Spieler: Status + Verbinden, keine Steuerung
  await logout(page);
  await login(page, "srvspieler");
  await page.goto(`${baseUrl}/#events`);
  await page.getByRole("button", { name: /^Minecraft, .*Details aufklappen/ }).click();
  const playerPanel = page.getByRole("region", { name: "Gameserver" }).first();
  await expect(playerPanel).toBeVisible();
  await expect(playerPanel.getByText("Server aus")).toBeVisible();
  await expect(playerPanel.getByText("minecraft.lanparty.example")).toBeVisible();
  await expect(playerPanel.getByRole("button", { name: "Adresse kopieren" })).toBeVisible();
  for (const action of ["Start", "Stopp", "Neustart", "Mehr …"]) {
    await expect(playerPanel.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
});
