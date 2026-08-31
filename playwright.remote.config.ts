import { defineConfig, devices } from "@playwright/test"

const asrContract = {
  apiKey: "remote-e2e-only",
  resourceId: "volc.bigasr.auc_turbo",
  transcript: "无人机一号返航",
}

const serverEnv = {
  SPRING_PROFILES_ACTIVE: "development",
  REALTIME_OUTBOX_PUBLISHER_ENABLED: "true",
  CORS_ORIGINS: "http://localhost:3000",
  MQTT_URL: "tcp://localhost:1883",
  CLICKHOUSE_URL: "http://localhost:8123",
  CLICKHOUSE_USERNAME: "zhiyuan",
  CLICKHOUSE_PASSWORD: "zhiyuan-dev",
  DB_URL:
    "jdbc:mysql://localhost:3306/zhiyuan?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai",
  DB_USERNAME: "zhiyuan",
  DB_PASSWORD: "zhiyuan-dev",
  ASR_ENABLED: "true",
  ASR_PUBLIC_WEBSOCKET_URL: "ws://localhost:8080/api/v1/asr/ws",
  VOLCENGINE_ASR_API_KEY: asrContract.apiKey,
  VOLCENGINE_ASR_ENDPOINT: "http://localhost:18081/api/v3/auc/bigmodel/recognize/flash",
}

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
      command: "node scripts/fake-volcengine-asr.mjs",
      env: {
        FAKE_ASR_API_KEY: asrContract.apiKey,
        FAKE_ASR_RESOURCE_ID: asrContract.resourceId,
        FAKE_ASR_TRANSCRIPT: asrContract.transcript,
      },
      url: "http://localhost:18081/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "mvn -f server/pom.xml spring-boot:run",
      env: serverEnv,
      url: "http://localhost:8080/api/v1/system/about",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm dev",
      env: {
        NEXT_PUBLIC_API_MODE: "remote",
        NEXT_PUBLIC_API_URL: "http://localhost:8080",
      },
      url: "http://localhost:3000/login",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
