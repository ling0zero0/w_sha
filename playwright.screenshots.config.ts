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
    command: "corepack pnpm dev",
    env: {
      NODE_ENV: "test",
      PUBLIC_ADDRESS: "192.168.50.10",
      PORT: "3101",
      WEB_PORT: "5274",
      DATABASE_PATH: ":memory:"
    },
    url: "http://127.0.0.1:5274",
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "readme-chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
