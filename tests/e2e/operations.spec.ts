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

test("fleet and goods filters update the visible records", async ({ page }) => {
  await page.goto("/uavs")
  await page.getByRole("combobox", { name: /区域|Region/ }).selectOption("苏州")
  await expect(page.locator(".data-table .table-row")).toHaveCount(1)
  await expect(page.locator(".data-table .table-row")).toContainText("苏州")

  await page.goto("/goods")
  await page.getByPlaceholder(/搜索商品|Search goods/).fill("工业检测仪")
  await expect(page.locator(".goods-table .table-row")).toHaveCount(1)
  await expect(page.getByText("工业检测仪", { exact: true })).toBeVisible()
})

test("text voice fallback parses and confirms a safety-sensitive command", async ({ page }) => {
  await page.goto("/voice")
  const input = page.getByRole("textbox")
  await input.fill("无人机一号起飞")
  await page.getByRole("button", { name: /解析|Parse/ }).click()
  await expect(page.getByText("TAKE_OFF", { exact: true })).toBeVisible()
})

test("failed or timed out commands can be retried as a new tracked command", async ({ page }) => {
  await page.goto("/uavs/detail?id=1")
  const receipts = page.locator(".timeline").first().locator(":scope > div")
  const before = await receipts.count()
  await page.getByRole("button", { name: /重试|Retry/ }).click()
  await expect(receipts).toHaveCount(before + 1)
  await expect(receipts.first()).toContainText("RETURN_HOME")
})

test("operators can create an order and deduct stock through the flat workflow", async ({
  page,
}) => {
  await page.goto("/orders")
  const rows = page.locator(".data-table .table-row")
  const before = await rows.count()
  await page.getByRole("button", { name: /新增|Add/ }).click()
  await expect(page.getByRole("heading", { name: /创建订单|Create order/ })).toBeVisible()
  await page.getByRole("spinbutton", { name: /应急药品包 quantity/ }).fill("2")
  await page.getByRole("button", { name: /保存|Save/ }).click()
  await expect(page.getByRole("heading", { name: /创建订单|Create order/ })).toBeHidden()
  await expect(rows).toHaveCount(before + 1)
})

test("pod controls and address maintenance submit real state changes", async ({ page }) => {
  await page.goto("/pods")
  await page
    .getByRole("combobox", { name: /POD-01.*舱门状态|POD-01 door status/ })
    .selectOption("OPEN")
  await expect(page.getByText(/保存|Save/, { exact: true }).last()).toBeVisible()

  await page.goto("/users")
  await page
    .getByRole("button", { name: /编辑|Edit/ })
    .first()
    .click()
  await expect(page.getByRole("heading", { name: /收货地址|Addresses/ })).toBeVisible()
  await page.getByRole("button", { name: /编辑|Edit/ }).click()
  await expect(page.getByRole("spinbutton", { name: /纬度|Latitude/ })).toHaveValue("32.05")
  await expect(page.getByRole("spinbutton", { name: /经度|Longitude/ })).toHaveValue("118.79")
  await page.getByRole("button", { name: /保存|Save/ }).click()
  await page.getByRole("button", { name: /删除|Delete/ }).click()
  const deleteConfirmation = page.getByRole("alertdialog")
  await expect(deleteConfirmation).toBeVisible()
  await deleteConfirmation.getByRole("button", { name: /删除|Delete/ }).click()
  await expect(page.getByText("南京市玄武区珠江路 1 号", { exact: true })).toBeHidden()
})

test("failed delivery tasks require and retain an operator reason", async ({ page }) => {
  await page.goto("/tasks")
  await page.getByRole("button", { name: /失败|Fail/ }).click()
  await expect(page.getByRole("heading", { name: /记录失败原因|Record failure/ })).toBeVisible()
  await page.getByRole("textbox", { name: /失败原因|Failure reason/ }).fill("侧风超过安全阈值")
  await page
    .getByRole("button", { name: /失败|Fail/ })
    .last()
    .click()
  await expect(page.getByText("侧风超过安全阈值")).toBeVisible()
})

test("administrators can create and disable staff accounts", async ({ page }) => {
  await page.goto("/settings")
  await page.getByRole("button", { name: /新增员工|Add staff/ }).click()
  const dialog = page.getByRole("dialog")
  await expect(
    dialog.getByRole("heading", { name: /新增员工账号|Add staff account/ })
  ).toBeVisible()
  await dialog.getByRole("textbox", { name: /用户名|Username/ }).fill("night.ops")
  await dialog.getByRole("textbox", { name: /显示名称|Display name/ }).fill("夜航运营")
  await dialog.getByRole("textbox", { name: /手机号|Phone/ }).fill("13800000008")
  await dialog.getByLabel(/初始密码|Initial password/).fill("nightops123")
  await dialog.getByRole("button", { name: /保存|Save/ }).click()

  const staffRow = page.locator(".data-table .table-row").filter({ hasText: "night.ops" })
  await expect(staffRow).toContainText("夜航运营")
  await staffRow.getByRole("button", { name: /停用|Disable/ }).click()
  const confirmation = page.getByRole("alertdialog")
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole("button", { name: /停用|Disable/ }).click()
  await expect(staffRow).toContainText("DISABLED")

  await staffRow.getByRole("button", { name: /编辑|Edit/ }).click()
  const editDialog = page.getByRole("dialog")
  await editDialog.getByRole("textbox", { name: /显示名称|Display name/ }).fill("夜航运营主管")
  await editDialog.getByRole("combobox", { name: /状态|Status/ }).selectOption("enabled")
  await editDialog.getByRole("button", { name: /保存|Save/ }).click()
  await expect(staffRow).toContainText("夜航运营主管")
  await expect(staffRow).toContainText("ENABLED")
})

test("profile edits stay synchronized with the current staff account", async ({ page }) => {
  await page.goto("/settings")
  const profile = page.locator("#profile")
  await profile.getByRole("textbox", { name: /显示名称|Display name/ }).fill("陈屿更新")
  await profile.getByRole("textbox", { name: /手机号|Phone/ }).fill("13800000007")
  await profile.getByRole("button", { name: /保存|Save/ }).click()
  const currentStaff = page.locator("#staff .table-row").filter({ hasText: "@admin" })
  await expect(currentStaff).toContainText("陈屿更新")
  await expect(currentStaff).toContainText("13800000007")

  await currentStaff.getByRole("button", { name: /编辑|Edit/ }).click()
  const editDialog = page.getByRole("dialog")
  await editDialog.getByRole("textbox", { name: /显示名称|Display name/ }).fill("陈屿值班")
  await editDialog.getByRole("button", { name: /保存|Save/ }).click()
  await expect(profile.getByRole("textbox", { name: /显示名称|Display name/ })).toHaveValue(
    "陈屿值班"
  )
})

test("sign out returns to the dedicated login route", async ({ page }) => {
  await page.goto("/settings")
  await page.getByRole("button", { name: /退出登录|Sign out/ }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole("heading", { name: /登录|Sign in/ })).toBeVisible()
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
