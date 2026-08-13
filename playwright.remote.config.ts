import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e-remote",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command:
        "DB_URL='jdbc:mysql://localhost:3306/zhiyuan?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai' DB_USERNAME=zhiyuan DB_PASSWORD=zhiyuan-dev mvn -f server/pom.xml spring-boot:run",
      url: "http://localhost:8080/api/v1/system/about",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "NEXT_PUBLIC_API_MODE=remote NEXT_PUBLIC_API_URL=http://localhost:8080 pnpm dev",
      url: "http://localhost:3000/login",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
