import { defineConfig, devices } from "@playwright/test";

const apiPort = process.env.E2E_API_PORT ?? "3100";
const webPort = process.env.E2E_WEB_PORT ?? "5273";

export default defineConfig({
  timeout: 90_000,
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "on-first-retry"
  },
  webServer: {
    command: "corepack pnpm dev",
    env: {
      NODE_ENV: "test",
      PUBLIC_ADDRESS: "192.168.50.10",
      PORT: apiPort,
      WEB_PORT: webPort,
      DATABASE_PATH: ":memory:"
    },
    url: `http://127.0.0.1:${webPort}`,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "desktop-webkit",
      use: { ...devices["Desktop Safari"] }
    },
    {
      name: "desktop-firefox",
      use: { ...devices["Desktop Firefox"] }
    }
  ]
});
