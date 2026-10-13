import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Specs own fixed local ports and process-wide counters, so their server
  // lifecycles must not overlap.
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:5177", trace: "on-first-retry", channel: "chrome", ...devices["Desktop Chrome"] },
});
