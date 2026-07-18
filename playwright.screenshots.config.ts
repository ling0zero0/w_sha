import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/screenshots",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: "test-results/readme-screenshots",
  use: {
    baseURL: "http://127.0.0.1:5274",
    trace: "off"
  },
  webServer: {
    command: "set NODE_ENV=test&& set PUBLIC_ADDRESS=192.168.50.10&& set PORT=3101&& set WEB_PORT=5274&& set DATABASE_PATH=:memory:&& corepack pnpm dev",
    url: "http://127.0.0.1:5274",
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "readme-chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" }
    }
  ]
});
