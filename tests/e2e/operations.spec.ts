import { expect, test } from "@playwright/test"

const responsiveRoutes = [
  "/",
  "/uavs",
  "/uavs/detail?id=1",
  "/map",
  "/voice",
  "/alerts",
  "/logs",
  "/pods",
  "/users",
  "/goods",
  "/orders",
  "/orders/detail?id=1",
  "/tasks",
  "/settings",
  "/login",
]

test("complete operator navigation and global search remain available", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k")
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  for (const route of [
    "/uavs",
    "/map",
    "/voice",
    "/alerts",
    "/logs",
    "/pods",
    "/users",
    "/goods",
    "/orders",
    "/tasks",
    "/settings",
  ]) {
    await page.goto(route)
    await expect(page.locator("main.product-page")).toBeVisible()
  }
})

test("mobile layout has no horizontal overflow and keeps bottom navigation usable", async ({
  page,
}) => {
  await page.goto("/uavs")
  const metrics = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.client)
  if ((page.viewportSize()?.width ?? 0) <= 960) {
    await expect(page.locator("nav.mobile-nav")).toBeVisible()
  } else {
    await expect(page.locator("aside.side-nav")).toBeVisible()
  }
  await expect(page.getByRole("link", { name: /首页|Home/ })).toBeVisible()
})

test("text voice fallback parses and confirms a safety-sensitive command", async ({ page }) => {
  await page.goto("/voice")
  const input = page.getByRole("textbox")
  await input.fill("无人机一号起飞")
  await page.getByRole("button", { name: /解析|Parse/ }).click()
  await expect(page.getByText("TAKE_OFF", { exact: true })).toBeVisible()
})

test("every migrated route remains within the responsive viewport", async ({ page }) => {
  for (const route of responsiveRoutes) {
    await page.goto(route)
    const metrics = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    expect(metrics.scroll, `${route} overflowed the viewport`).toBeLessThanOrEqual(metrics.client)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  }
})
