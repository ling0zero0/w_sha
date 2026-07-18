import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:5273",
    trace: "on-first-retry"
  },
  webServer: {
    command: "set NODE_ENV=test&& set PUBLIC_ADDRESS=192.168.50.10&& set PORT=3100&& set WEB_PORT=5273&& set DATABASE_PATH=:memory:&& corepack pnpm dev",
    url: "http://127.0.0.1:5273",
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" }
    }
  ]
});
