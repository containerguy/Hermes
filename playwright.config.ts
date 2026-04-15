import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:0",
    trace: "on-first-retry"
  },
  reporter: [["list"]]
});
