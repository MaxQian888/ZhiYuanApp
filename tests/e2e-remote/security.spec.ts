import { expect, test } from "@playwright/test"
import { connectAsync } from "mqtt"

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login")
  await page.getByRole("textbox", { name: /用户名|Username/ }).fill("admin")
  await page.getByLabel(/密码|Password/).fill("admin123")
  await page.getByRole("button", { name: /登录|Sign in/ }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator("main.product-page")).toBeVisible()
}

async function loginViaApi(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(async () => {
    const response = await fetch("http://localhost:8080/api/v1/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123", client: "web" }),
    })
    if (!response.ok) throw new Error(`API login failed: ${response.status}`)
    return (await response.json()).data.accessToken as string
  })
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

test("the refresh session restores API access after the in-memory token is lost", async ({
  page,
}) => {
  await login(page)

  // A full reload clears the module-scoped access token. The HttpOnly refresh cookie must
  // recover the session before protected remote data can render again.
  await page.reload()
  await expect(page.locator("main.product-page")).toBeVisible()
  await page.goto("/settings")
  await expect(page.locator("#profile")).toBeVisible()
})

test("authenticated ASR ticket streams PCM once through the server gateway", async ({ page }) => {
  await page.goto("/login")
  const accessToken = await loginViaApi(page)

  const result = await page.evaluate(async (token) => {
    const reservation = await fetch("http://localhost:8080/api/v1/asr/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!reservation.ok) throw new Error(`ASR reservation failed: ${reservation.status}`)
    const websocketUrl = (await reservation.json()).data.websocketUrl as string

    const transcript = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(websocketUrl)
      let settled = false
      const timer = window.setTimeout(() => {
        if (settled) return
        settled = true
        socket.close()
        reject(new Error("ASR final transcript timed out"))
      }, 5_000)
      const fail = (message: string) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        socket.close()
        reject(new Error(message))
      }
      socket.binaryType = "arraybuffer"
      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: "start",
            locale: "zh-CN",
            mimeType: "audio/pcm;rate=16000",
          })
        )
        socket.send(new Uint8Array([1, 2, 3, 4]).buffer)
        socket.send(JSON.stringify({ type: "stop" }))
      }
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as {
          type: string
          text?: string
          reason?: string
        }
        if (message.type === "final" && message.text) {
          settled = true
          window.clearTimeout(timer)
          socket.close()
          resolve(message.text)
        } else if (message.type === "error") {
          fail(`ASR gateway error: ${message.reason ?? "unknown"}`)
        }
      }
      socket.onerror = () => fail("first ASR WebSocket failed")
      socket.onclose = () => {
        fail("ASR WebSocket closed before final transcript")
      }
    })

    const replayRejected = await new Promise<boolean>((resolve) => {
      const replay = new WebSocket(websocketUrl)
      let settled = false
      const timer = window.setTimeout(() => {
        if (settled) return
        settled = true
        replay.close()
        resolve(false)
      }, 5_000)
      replay.onopen = () => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        replay.close()
        resolve(false)
      }
      replay.onerror = () => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        replay.close()
        resolve(true)
      }
    })

    const freshReservation = await fetch("http://localhost:8080/api/v1/asr/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!freshReservation.ok) {
      throw new Error(`Fresh ASR reservation failed: ${freshReservation.status}`)
    }
    const freshWebsocketUrl = (await freshReservation.json()).data.websocketUrl as string
    const freshConnected = await new Promise<boolean>((resolve) => {
      const fresh = new WebSocket(freshWebsocketUrl)
      let settled = false
      const timer = window.setTimeout(() => {
        if (settled) return
        settled = true
        fresh.close()
        resolve(false)
      }, 5_000)
      fresh.onopen = () => {
        settled = true
        window.clearTimeout(timer)
        fresh.close()
        resolve(true)
      }
      fresh.onerror = () => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        fresh.close()
        resolve(false)
      }
    })
    return { transcript, replayRejected, freshConnected }
  }, accessToken)

  expect(result).toEqual({
    transcript: "无人机一号返航",
    replayRejected: true,
    freshConnected: true,
  })
})

test("browser CORS preflight and repeated order submissions preserve idempotency", async ({
  page,
}) => {
  await page.goto("/login")
  const accessToken = await loginViaApi(page)
  const preflight = page.waitForRequest(
    (request) => request.method() === "OPTIONS" && request.url().endsWith("/api/v1/orders")
  )

  const result = await page.evaluate(async (token) => {
    const key = crypto.randomUUID()
    const body = JSON.stringify({ userId: 1, addressId: 1, items: [{ goodsId: 1, count: 1 }] })
    const submit = (payload: string) =>
      fetch("http://localhost:8080/api/v1/orders", {
        method: "POST",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: payload,
      })

    const first = await submit(body)
    const firstPayload = await first.json()
    const replay = await submit(body)
    const replayPayload = await replay.json()
    const conflict = await submit(
      JSON.stringify({ userId: 1, addressId: 1, items: [{ goodsId: 1, count: 2 }] })
    )

    return {
      firstStatus: first.status,
      replayStatus: replay.status,
      conflictStatus: conflict.status,
      firstOrderId: firstPayload.data.id,
      replayOrderId: replayPayload.data.id,
    }
  }, accessToken)

  const options = await preflight
  expect(options.headers()["access-control-request-headers"]?.toLowerCase()).toContain(
    "idempotency-key"
  )
  expect(result).toMatchObject({
    firstStatus: 200,
    replayStatus: 200,
    conflictStatus: 409,
  })
  expect(result.replayOrderId).toBe(result.firstOrderId)
})

test("the public telemetry endpoint reads the MQTT sample persisted in ClickHouse", async ({
  page,
}) => {
  const eventId = crypto.randomUUID()
  const observedAt = new Date()
  const battery = 68
  const payload = JSON.stringify({
    schemaVersion: 1,
    eventId,
    uavCode: "UAV-01",
    sequence: Date.now(),
    observedAt: observedAt.toISOString(),
    status: "FLYING",
    battery,
    latitude: 32.0602,
    longitude: 118.7802,
    altitude: 52.5,
    speed: 9.3,
  })
  const mqtt = await connectAsync("mqtt://127.0.0.1:1883", {
    clientId: `playwright-${eventId}`,
    reconnectPeriod: 0,
  })
  try {
    await page.goto("/login")

    const accessToken = await loginViaApi(page)

    await expect
      .poll(
        async () => {
          // The HTTP readiness probe can win the race with the MQTT subscription. Replaying the
          // same immutable event makes the fixture reliable without creating extra history rows.
          await mqtt.publishAsync("zhiyuan/v1/uavs/UAV-01/telemetry", payload, { qos: 1 })
          return page.evaluate(
            async ({ token, expectedEventTime, expectedBattery }) => {
              const observed = new Date(expectedEventTime).getTime()
              const query = new URLSearchParams({
                from: new Date(observed - 60_000).toISOString(),
                to: new Date(observed + 60_000).toISOString(),
                resolution: "raw",
              })
              const response = await fetch(
                `http://localhost:8080/api/v1/uavs/1/telemetry?${query}`,
                { headers: { Authorization: `Bearer ${token}` } }
              )
              if (!response.ok) return false
              const telemetry = await response.json()
              return telemetry.data.some(
                (point: { uavCode: string; battery: number; observedAt: string }) =>
                  point.uavCode === "UAV-01" &&
                  point.battery === expectedBattery &&
                  new Date(point.observedAt).getTime() === observed
              )
            },
            {
              token: accessToken,
              expectedEventTime: observedAt.toISOString(),
              expectedBattery: battery,
            }
          )
        },
        { timeout: 15_000 }
      )
      .toBe(true)
  } finally {
    await mqtt.endAsync()
  }
})
