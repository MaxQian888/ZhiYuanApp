import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-320", use: { viewport: { width: 320, height: 720 }, isMobile: true } },
    { name: "mobile-375", use: { viewport: { width: 375, height: 812 }, isMobile: true } },
    { name: "mobile-414", use: { viewport: { width: 414, height: 896 }, isMobile: true } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 } } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
