import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Playwright-Specs unter e2e/ laufen über `npx playwright test`, nicht über Vitest.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      exclude: [...configDefaults.exclude, "e2e/**"]
    }
  })
);
