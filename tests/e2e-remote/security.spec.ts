import { expect, test } from "@playwright/test"

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login")
  await page.getByRole("textbox", { name: /用户名|Username/ }).fill("admin")
  await page.getByLabel(/密码|Password/).fill("admin123")
  await page.getByRole("button", { name: /登录|Sign in/ }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator("main.product-page")).toBeVisible()
}

test("staff mutations cross Spring, Flyway, and the browser API boundary", async ({ page }) => {
  await login(page)
  await page.goto("/settings")
  await page.getByRole("button", { name: /新增员工|Add staff/ }).click()
  const dialog = page.getByRole("dialog")
  const suffix = Date.now().toString().slice(-8)
  const username = `e2e.${suffix}`
  await dialog.getByRole("textbox", { name: /用户名|Username/ }).fill(username)
  await dialog.getByRole("textbox", { name: /显示名称|Display name/ }).fill("远端验收员工")
  await dialog.getByRole("textbox", { name: /手机号|Phone/ }).fill(`139${suffix}`)
  await dialog.getByLabel(/初始密码|Initial password/).fill("remote-e2e-123")
  await dialog.getByRole("button", { name: /保存|Save/ }).click()

  const staffRow = page.locator("#staff .table-row").filter({ hasText: username })
  await expect(staffRow).toContainText("远端验收员工")
  await staffRow.getByRole("button", { name: /停用|Disable/ }).click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /停用|Disable/ })
    .click()
  await expect(staffRow).toContainText("DISABLED")
})

test("explicit logout stays logged out when server revocation is unavailable", async ({ page }) => {
  await login(page)
  await page.route("**/api/v1/auth/logout", (route) => route.abort("failed"))
  await page.goto("/settings")
  await page.getByRole("button", { name: /退出登录|Sign out/ }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto("/")
  await expect(page.getByRole("heading", { name: /登录|Sign in/ })).toBeVisible()
})
