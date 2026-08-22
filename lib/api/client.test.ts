import {
  ApiError,
  api,
  isSessionRecoverySuppressed,
  parseApiResponse,
  parseSseChunk,
  resumeSessionRecovery,
  setAccessToken,
  streamTelemetry,
  suppressSessionRecovery,
} from "@/lib/api/client"
import { uavSchema } from "@/lib/api/schemas"

const BASE = "http://localhost:8080"

type FetchMock = jest.Mock<Promise<unknown>, [string, RequestInit?]>

/** Builds a successful `{ code, message, data, traceId }` envelope response. */
function ok(data: unknown, status = 200) {
  return {
    ok: true,
    status,
    statusText: "OK",
    json: async () => ({ code: 200, message: "ok", traceId: "trace-test", data }),
  }
}

function failure(status: number, body: unknown = { message: "boom", traceId: "trace-err" }) {
  return { ok: false, status, statusText: "Bad Request", json: async () => body }
}

function mockFetch(...responses: unknown[]): FetchMock {
  const fetchMock = jest.fn() as FetchMock
  responses.forEach((response) => fetchMock.mockResolvedValueOnce(response))
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

const uavRow = {
  id: 1,
  code: "UAV-01",
  name: "巡检一号",
  rfidTag: "RFID-0001",
  model: "DJI Mavic 3",
  ownerName: "Admin",
  status: "ONLINE" as const,
  battery: 78,
  inHibernatePod: true,
  region: "南京",
  altitude: 30,
  speed: 5.2,
  latitude: 32.06,
  longitude: 118.78,
  updatedAt: "2026-08-12T10:00:00+08:00",
}

const staffRow = {
  id: 1,
  username: "admin",
  displayName: "陈屿",
  role: "admin" as const,
  phone: "13900000001",
}

const page = <T>(items: T[], overrides: Partial<Record<string, number>> = {}) => ({
  items,
  page: 1,
  size: 100,
  total: items.length,
  totalPages: 1,
  ...overrides,
})

afterEach(() => {
  setAccessToken(null)
  resumeSessionRecovery()
})

describe("API boundary · envelope and session flags", () => {
  it("keeps automatic session recovery disabled after an explicit logout", () => {
    suppressSessionRecovery()
    expect(isSessionRecoverySuppressed()).toBe(true)
    resumeSessionRecovery()
    expect(isSessionRecoverySuppressed()).toBe(false)
  })

  it("fails safe when browser storage is unavailable", () => {
    const getItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError")
    })
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError")
    })
    const removeItem = jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError")
    })
    expect(() => suppressSessionRecovery()).not.toThrow()
    expect(() => resumeSessionRecovery()).not.toThrow()
    expect(isSessionRecoverySuppressed()).toBe(true)
    getItem.mockRestore()
    setItem.mockRestore()
    removeItem.mockRestore()
  })

  it("accepts the versioned response envelope and validates its data", () => {
    const parsed = parseApiResponse(
      { code: 200, message: "ok", traceId: "trace-1", data: uavRow },
      uavSchema
    )
    expect(parsed.data.code).toBe("UAV-01")
    expect(parsed.traceId).toBe("trace-1")
  })

  it("rejects invalid boundary data", () => {
    expect(() =>
      parseApiResponse(
        { code: 200, message: "ok", traceId: "trace-1", data: { id: 1, battery: 140 } },
        uavSchema
      )
    ).toThrow()
  })
})

describe("API boundary · request plumbing", () => {
  it("attaches the bearer token and a JSON content type to bodied requests", async () => {
    setAccessToken("token-abc")
    const fetchMock = mockFetch(ok(staffRow))

    await api.updateProfile("陈屿", "13900000001")

    const init = fetchMock.mock.calls[0][1]!
    const headers = init.headers as Headers
    expect(headers.get("Authorization")).toBe("Bearer token-abc")
    expect(headers.get("Content-Type")).toBe("application/json")
    expect(init.credentials).toBe("include")
  })

  it("does not force a JSON content type onto bodyless requests", async () => {
    const fetchMock = mockFetch(ok(staffRow))
    await api.me()
    const headers = fetchMock.mock.calls[0][1]!.headers as Headers
    expect(headers.has("Content-Type")).toBe(false)
  })

  it("surfaces the server message and trace id as an ApiError", async () => {
    mockFetch(failure(409, { message: "库存不足", traceId: "trace-409" }))
    await expect(api.dashboard()).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      message: "库存不足",
      traceId: "trace-409",
    })
  })

  it("falls back to the status text when the error body is not an envelope", async () => {
    mockFetch({ ok: false, status: 500, statusText: "Server Error", json: async () => "nope" })
    await expect(api.dashboard()).rejects.toMatchObject({ status: 500, message: "Server Error" })
  })

  it("tolerates a body that is not valid JSON at all", async () => {
    mockFetch({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => {
        throw new SyntaxError("Unexpected token")
      },
    })
    await expect(api.dashboard()).rejects.toMatchObject({ status: 502, message: "Bad Gateway" })
  })

  it("refreshes once on a 401 and replays the original request", async () => {
    const fetchMock = mockFetch(
      failure(401, { message: "expired" }),
      ok({ accessToken: "fresh-token" }),
      ok({ totalUav: 6, onlineUav: 5, inPod: 2, alerts: 3 })
    )

    await expect(api.dashboard()).resolves.toMatchObject({ totalUav: 6 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE}/api/v1/auth/refresh`)
    // The replay carries the new token.
    const replayHeaders = fetchMock.mock.calls[2][1]!.headers as Headers
    expect(replayHeaders.get("Authorization")).toBe("Bearer fresh-token")
  })

  it("gives up when the refresh itself is rejected", async () => {
    const fetchMock = mockFetch(failure(401), { ok: false, status: 401, json: async () => ({}) })
    await expect(api.dashboard()).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not retry a second time after a refreshed request still returns 401", async () => {
    const fetchMock = mockFetch(
      failure(401),
      ok({ accessToken: "fresh-token" }),
      failure(401, { message: "still expired" })
    )
    await expect(api.dashboard()).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe("API boundary · authentication", () => {
  it("returns a challenge instead of a session when a second factor is owed", async () => {
    // Nothing is stored: until the code is verified this browser holds no session at all,
    // which is the whole point of the second step.
    mockFetch(ok({ mfaRequired: true, mfaToken: "challenge-token" }))

    await expect(api.login("admin", "admin123")).resolves.toEqual({
      kind: "second-factor",
      mfaToken: "challenge-token",
    })

    const fetchMock = mockFetch(ok(staffRow))
    await api.me()
    expect((fetchMock.mock.calls[0][1]!.headers as Headers).get("Authorization")).toBeNull()
  })

  it("refuses a second-factor response that carries no challenge", async () => {
    // A client that treated this as "signed in" would show an empty console; one that
    // treated it as "wrong password" would send the operator round in circles.
    mockFetch(ok({ mfaRequired: true }))

    await expect(api.login("admin", "admin123")).rejects.toThrow(/no challenge/)
  })

  it("completes a sign-in by answering the challenge", async () => {
    const fetchMock = mockFetch(ok({ accessToken: "verified-token", staff: staffRow }))

    await expect(api.verifyMfa("challenge-token", "123456")).resolves.toMatchObject({
      kind: "signed-in",
      staff: { username: "admin" },
    })
    expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/auth/mfa/verify")
    expect(fetchMock.mock.calls[0][1]!.body).toBe(
      JSON.stringify({ mfaToken: "challenge-token", code: "123456", client: "web" })
    )
  })

  it("reads the second-factor status", async () => {
    mockFetch(ok({ enabled: true, pendingEnrolment: false, remainingRecoveryCodes: 4 }))

    await expect(api.mfaStatus()).resolves.toEqual({
      enabled: true,
      pendingEnrolment: false,
      remainingRecoveryCodes: 4,
    })
  })

  it("starts enrolment and returns the secret with its provisioning uri", async () => {
    const fetchMock = mockFetch(
      ok({ secret: "JBSWY3DPEHPK3PXP", provisioningUri: "otpauth://totp/ZhiYuan:admin" })
    )

    await expect(api.beginMfaEnrolment()).resolves.toMatchObject({ secret: "JBSWY3DPEHPK3PXP" })
    expect(fetchMock.mock.calls[0][1]!.method).toBe("POST")
  })

  it("confirms enrolment and hands back the recovery codes", async () => {
    const fetchMock = mockFetch(ok({ recoveryCodes: ["AAAA-BBBB-CCCC"] }))

    await expect(api.confirmMfaEnrolment("123456")).resolves.toEqual({
      recoveryCodes: ["AAAA-BBBB-CCCC"],
    })
    expect(fetchMock.mock.calls[0][1]!.body).toBe(JSON.stringify({ code: "123456" }))
  })

  it("reissues recovery codes and removes the factor, both proving a current code", async () => {
    const reissue = mockFetch(ok({ recoveryCodes: ["DDDD-EEEE-FFFF"] }))
    await expect(api.regenerateRecoveryCodes("123456")).resolves.toMatchObject({
      recoveryCodes: ["DDDD-EEEE-FFFF"],
    })
    expect(reissue.mock.calls[0][1]!.body).toBe(JSON.stringify({ code: "123456" }))

    const remove = mockFetch(ok(null))
    await api.disableMfa("654321")
    expect(remove.mock.calls[0][1]!.method).toBe("DELETE")
    expect(remove.mock.calls[0][1]!.body).toBe(JSON.stringify({ code: "654321" }))
  })

  it("surfaces a lockout with the status the caller needs to distinguish it", async () => {
    // A 429 is not a wrong password, and the login view branches on exactly this.
    mockFetch({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      json: async () => ({
        code: 429,
        message: "Too many sign-in attempts. Try again in 240 seconds.",
        traceId: "abc",
      }),
    })

    await expect(api.login("admin", "whatever")).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining("240 seconds"),
    })
  })

  it("stores the access token returned by login and re-arms session recovery", async () => {
    suppressSessionRecovery()
    const fetchMock = mockFetch(ok({ accessToken: "login-token", staff: staffRow }))

    await expect(api.login("admin", "admin123")).resolves.toMatchObject({
      kind: "signed-in",
      staff: { username: "admin" },
    })
    expect(isSessionRecoverySuppressed()).toBe(false)
    expect(fetchMock.mock.calls[0][1]!.body).toBe(
      JSON.stringify({ username: "admin", password: "admin123", client: "web" })
    )

    // The token is now in use for subsequent calls.
    mockFetch(ok(staffRow))
    await api.me()
    const headers = (global.fetch as unknown as FetchMock).mock.calls[0][1]!.headers as Headers
    expect(headers.get("Authorization")).toBe("Bearer login-token")
  })

  it("clears the access token on logout", async () => {
    setAccessToken("token-abc")
    mockFetch(ok(null))
    await api.logout()

    mockFetch(ok(staffRow))
    await api.me()
    const headers = (global.fetch as unknown as FetchMock).mock.calls[0][1]!.headers as Headers
    expect(headers.has("Authorization")).toBe(false)
  })

  it("forgetAuthentication drops the token without calling the server", async () => {
    setAccessToken("token-abc")
    const fetchMock = mockFetch()
    await api.forgetAuthentication()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("lists and revokes refresh sessions", async () => {
    mockFetch(
      ok([
        {
          id: "session-1",
          userAgent: "Chrome",
          ipAddress: "127.0.0.1",
          createdAt: "2026-08-12T10:00:00+08:00",
          expiresAt: "2026-08-26T10:00:00+08:00",
          current: true,
        },
      ])
    )
    await expect(api.sessions()).resolves.toHaveLength(1)

    const fetchMock = mockFetch(ok(null))
    await api.revokeSession("session 1")
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/auth/sessions?id=session%201`)
  })

  it("changes the password through the versioned endpoint", async () => {
    const fetchMock = mockFetch(ok(null))
    await api.changePassword("old-secret", "new-secret")
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/auth/password`)
    expect(fetchMock.mock.calls[0][1]!.method).toBe("PATCH")
  })
})

describe("API boundary · staff administration", () => {
  const accountRow = { ...staffRow, id: 8, username: "night.ops", role: "manager", enabled: true }

  it("lists, creates, updates and disables staff accounts", async () => {
    mockFetch(ok([accountRow]))
    await expect(api.staffAccounts()).resolves.toHaveLength(1)

    let fetchMock = mockFetch(ok(accountRow))
    await api.createStaffAccount({
      username: "night.ops",
      password: "nightops123",
      displayName: "陈屿",
      role: "manager",
      phone: "13900000001",
    })
    expect(fetchMock.mock.calls[0][1]!.method).toBe("POST")

    fetchMock = mockFetch(ok(accountRow))
    await api.updateStaffAccount(8, {
      username: "night.ops",
      displayName: "陈屿",
      role: "manager",
      phone: "13900000001",
      enabled: true,
    })
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/admins/8`)
    expect(fetchMock.mock.calls[0][1]!.method).toBe("PUT")

    fetchMock = mockFetch(ok(accountRow))
    await api.disableStaffAccount(8)
    expect(fetchMock.mock.calls[0][1]!.method).toBe("DELETE")
  })
})

describe("API boundary · fleet", () => {
  it("reads the dashboard, search results and a single UAV", async () => {
    mockFetch(ok({ totalUav: 6, onlineUav: 5, inPod: 2, alerts: 3 }))
    await expect(api.dashboard()).resolves.toMatchObject({ totalUav: 6 })

    const fetchMock = mockFetch(
      ok([{ type: "uav", id: 1, title: "UAV-01 · 巡检一号", href: "/uavs/detail?id=1" }])
    )
    await expect(api.search("巡检 一号")).resolves.toHaveLength(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BASE}/api/v1/search?q=%E5%B7%A1%E6%A3%80%20%E4%B8%80%E5%8F%B7`
    )

    mockFetch(ok(uavRow))
    await expect(api.uav(1)).resolves.toMatchObject({ code: "UAV-01" })
  })

  it("pages through the fleet and concatenates every page", async () => {
    const fetchMock = mockFetch(
      ok(page([uavRow], { totalPages: 3, total: 3 })),
      ok(page([{ ...uavRow, id: 2, code: "UAV-02" }], { page: 2, totalPages: 3, total: 3 })),
      ok(page([{ ...uavRow, id: 3, code: "UAV-03" }], { page: 3, totalPages: 3, total: 3 }))
    )

    await expect(api.allUavs()).resolves.toHaveLength(3)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${BASE}/api/v1/uavs?page=1&size=100`,
      `${BASE}/api/v1/uavs?page=2&size=100`,
      `${BASE}/api/v1/uavs?page=3&size=100`,
    ])
  })

  it("stops after one request when the collection fits on a single page", async () => {
    const fetchMock = mockFetch(ok(page([uavRow])))
    await expect(api.allUavs()).resolves.toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("appends the paging separator correctly to a query that already has one", async () => {
    const fetchMock = mockFetch(ok(page([uavRow])))
    await api.uavs("?status=ONLINE")
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/uavs?status=ONLINE`)
  })

  it("sends a control command and reads back the queue receipt", async () => {
    const fetchMock = mockFetch(ok({ commandId: "cmd-1", status: "QUEUED", adapter: "simulator" }))
    await expect(api.command(2, { type: "RETURN_HOME", source: "MANUAL" })).resolves.toMatchObject({
      commandId: "cmd-1",
    })
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/uavs/2/commands`)
  })

  it("lists commands and flight logs", async () => {
    mockFetch(
      ok([
        {
          id: "cmd-1",
          uavId: 2,
          type: "RETURN_HOME",
          status: "SENT",
          source: "MANUAL",
          createdAt: "2026-08-12T10:00:00+08:00",
        },
      ])
    )
    await expect(api.commands()).resolves.toHaveLength(1)

    mockFetch(
      ok([
        {
          id: 1,
          uavId: 2,
          event: "任务起飞",
          detail: "订单 ZY-1",
          occurredAt: "2026-08-12T10:00:00+08:00",
        },
      ])
    )
    await expect(api.flightLogs(2)).resolves.toHaveLength(1)
  })
})

describe("API boundary · alerts, logs, pods and bindings", () => {
  const alertRow = {
    id: 1,
    uavId: 2,
    title: "电量低",
    level: "HIGH" as const,
    occurredAt: "2026-08-12T10:00:00+08:00",
    resolved: false,
    status: "OPEN" as const,
  }

  it("filters alerts by level and walks the acknowledge/resolve pair", async () => {
    let fetchMock = mockFetch(ok([alertRow]))
    await api.alerts("HIGH")
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/alerts?level=HIGH`)

    fetchMock = mockFetch(ok([alertRow]))
    await api.alerts()
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/alerts`)

    mockFetch(ok({ ...alertRow, status: "ACKNOWLEDGED" }))
    await expect(api.acknowledgeAlert(1)).resolves.toMatchObject({ status: "ACKNOWLEDGED" })

    mockFetch(ok({ ...alertRow, status: "RESOLVED", resolved: true }))
    await expect(api.resolveAlert(1)).resolves.toMatchObject({ resolved: true })
  })

  it("reads the paged audit log", async () => {
    const fetchMock = mockFetch(
      ok(
        page([
          {
            id: "F-1",
            category: "FLIGHT",
            uavId: 2,
            title: "任务起飞",
            detail: "订单 ZY-1",
            status: "RECORDED",
            source: "UAV",
            occurredAt: "2026-08-12T10:00:00+08:00",
          },
        ])
      )
    )
    await expect(api.auditLogs("?page=1&size=20")).resolves.toMatchObject({ total: 1 })
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/logs?page=1&size=20`)
  })

  it("reads and updates hibernate pods", async () => {
    const podRow = { id: 1, name: "POD-01", region: "南京", doorStatus: "CLOSED" as const }
    mockFetch(ok([podRow]))
    await expect(api.pods()).resolves.toHaveLength(1)

    const fetchMock = mockFetch(ok({ ...podRow, doorStatus: "OPEN", uavId: 1 }))
    await expect(api.updatePod(1, "OPEN", 1)).resolves.toMatchObject({ doorStatus: "OPEN" })
    expect(fetchMock.mock.calls[0][1]!.body).toBe('{"doorStatus":"OPEN","uavId":1}')
  })

  it("binds and unbinds devices", async () => {
    const bindingRow = { id: 1, staffId: 1, uavId: 3, boundAt: "2026-08-12T10:00:00+08:00" }
    mockFetch(ok([bindingRow]))
    await expect(api.bindings()).resolves.toHaveLength(1)

    mockFetch(ok(bindingRow))
    await expect(api.bindDevice(1, 3)).resolves.toMatchObject({ uavId: 3 })

    const fetchMock = mockFetch(ok(null))
    await api.unbindDevice(1)
    expect(fetchMock.mock.calls[0][1]!.method).toBe("DELETE")
  })
})

describe("API boundary · customers, goods, orders and tasks", () => {
  const userRow = {
    id: 9,
    username: "周岚",
    phone: "13911112222",
    createdAt: "2026-08-12T18:00:00+08:00",
    addresses: [],
  }
  const addressRow = {
    id: 5,
    userId: 9,
    receiverName: "周岚",
    receiverPhone: "13911112222",
    detail: "南京市玄武区",
    latitude: 32.05,
    longitude: 118.79,
    isDefault: true,
  }
  const goodsRow = {
    id: 3,
    name: "应急药品包",
    category: "medicine" as const,
    price: 89,
    stock: 42,
    weight: 0.8,
    status: 1 as const,
  }
  const orderRow = {
    id: 1,
    orderNo: "ZY-20260812-001",
    userId: 9,
    addressId: 5,
    totalPrice: 89,
    status: "CREATED" as const,
    createdAt: "2026-08-12T18:00:00+08:00",
    items: [{ id: 1, goodsId: 3, goodsName: "应急药品包", count: 1, price: 89 }],
  }
  const taskRow = { id: 1, orderId: 1, uavId: 2, taskStatus: "WAITING" as const }

  it("sends user mutations through the versioned API and validates the response", async () => {
    const fetchMock = mockFetch(ok(userRow))
    await expect(api.saveUser({ username: "周岚", phone: "13911112222" })).resolves.toMatchObject({
      id: 9,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/api/v1/users`,
      expect.objectContaining({ method: "POST", body: '{"username":"周岚","phone":"13911112222"}' })
    )
  })

  it("switches to PUT when the customer already exists", async () => {
    const fetchMock = mockFetch(ok(userRow))
    await api.saveUser({ id: 9, username: "周岚", phone: "13911112222" })
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/users/9`)
    expect(fetchMock.mock.calls[0][1]!.method).toBe("PUT")
  })

  it("lists and pages customers, and deletes one", async () => {
    mockFetch(ok(page([userRow])))
    await expect(api.users()).resolves.toMatchObject({ total: 1 })

    mockFetch(ok(page([userRow])))
    await expect(api.allUsers()).resolves.toHaveLength(1)

    const fetchMock = mockFetch(ok(null))
    await api.deleteUser(9)
    expect(fetchMock.mock.calls[0][1]!.method).toBe("DELETE")
  })

  it("creates, updates, defaults and deletes addresses", async () => {
    let fetchMock = mockFetch(ok(addressRow))
    await api.saveAddress(9, {
      receiverName: "周岚",
      receiverPhone: "13911112222",
      detail: "南京市玄武区",
      latitude: 32.05,
      longitude: 118.79,
      isDefault: true,
    })
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/users/9/addresses`)
    expect(fetchMock.mock.calls[0][1]!.method).toBe("POST")

    fetchMock = mockFetch(ok(addressRow))
    await api.saveAddress(9, {
      id: 5,
      receiverName: "周岚",
      receiverPhone: "13911112222",
      detail: "南京市玄武区",
      latitude: 32.05,
      longitude: 118.79,
      isDefault: true,
    })
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/users/9/addresses/5`)
    expect(fetchMock.mock.calls[0][1]!.method).toBe("PUT")

    fetchMock = mockFetch(ok(addressRow))
    await api.setDefaultAddress(9, 5)
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/users/9/addresses/5/default`)

    fetchMock = mockFetch(ok(null))
    await api.deleteAddress(9, 5)
    expect(fetchMock.mock.calls[0][1]!.method).toBe("DELETE")
  })

  it("reads goods, saves them and toggles the listing flag", async () => {
    mockFetch(ok(page([goodsRow])))
    await expect(api.goods("?category=medicine")).resolves.toMatchObject({ total: 1 })

    mockFetch(ok(page([goodsRow])))
    await expect(api.allGoods()).resolves.toHaveLength(1)

    let fetchMock = mockFetch(ok(goodsRow))
    await api.saveGoods({
      name: "应急药品包",
      category: "medicine",
      price: 89,
      stock: 42,
      weight: 0.8,
      status: 1,
    })
    expect(fetchMock.mock.calls[0][1]!.method).toBe("POST")

    fetchMock = mockFetch(ok(goodsRow))
    await api.saveGoods({
      id: 3,
      name: "应急药品包",
      category: "medicine",
      price: 89,
      stock: 42,
      weight: 0.8,
      status: 1,
    })
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/goods/3`)

    fetchMock = mockFetch(ok({ ...goodsRow, status: 0 }))
    await expect(api.toggleGoods(3)).resolves.toMatchObject({ status: 0 })
  })

  it("deletes a single product by path and a batch by body", async () => {
    let fetchMock = mockFetch(ok(null))
    await api.deleteGoods([3])
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/goods/3`)
    expect(fetchMock.mock.calls[0][1]!.body).toBeUndefined()

    fetchMock = mockFetch(ok(null))
    await api.deleteGoods([3, 4])
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/goods`)
    expect(fetchMock.mock.calls[0][1]!.body).toBe('{"ids":[3,4]}')
  })

  it("reads orders, creates one, dispatches it and cancels it", async () => {
    mockFetch(ok(page([orderRow])))
    await expect(api.orders()).resolves.toMatchObject({ total: 1 })

    mockFetch(ok(page([orderRow])))
    await expect(api.allOrders()).resolves.toHaveLength(1)

    let fetchMock = mockFetch(ok(orderRow))
    await api.createOrder(9, 5, [{ goodsId: 3, count: 1 }])
    expect(fetchMock.mock.calls[0][1]!.body).toBe(
      '{"userId":9,"addressId":5,"items":[{"goodsId":3,"count":1}]}'
    )

    fetchMock = mockFetch(ok(taskRow))
    await expect(api.dispatchOrder(1, 2)).resolves.toMatchObject({ uavId: 2 })
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/orders/1/dispatch`)

    fetchMock = mockFetch(ok({ ...orderRow, status: "CANCELLED" }))
    await expect(api.cancelOrder(1)).resolves.toMatchObject({ status: "CANCELLED" })
  })

  it("maps every task transition to its own action path", async () => {
    mockFetch(ok(page([taskRow])))
    await expect(api.tasks()).resolves.toMatchObject({ total: 1 })

    mockFetch(ok(page([taskRow])))
    await expect(api.allTasks()).resolves.toHaveLength(1)

    let fetchMock = mockFetch(ok({ ...taskRow, taskStatus: "FLYING" }))
    await api.transitionTask(1, "FLYING")
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/tasks/1/start`)
    expect(fetchMock.mock.calls[0][1]!.body).toBeUndefined()

    fetchMock = mockFetch(ok({ ...taskRow, taskStatus: "ARRIVED" }))
    await api.transitionTask(1, "ARRIVED")
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/tasks/1/arrive`)

    fetchMock = mockFetch(ok({ ...taskRow, taskStatus: "FAILED", failureReason: "强风" }))
    await api.transitionTask(1, "FAILED", "强风")
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/tasks/1/fail`)
    expect(fetchMock.mock.calls[0][1]!.body).toBe('{"reason":"强风"}')
  })

  it("reads the updater version descriptor", async () => {
    mockFetch(ok({ configured: true, currentVersion: "0.1.0", manifestUrl: "https://example" }))
    await expect(api.version()).resolves.toMatchObject({ configured: true })
  })
})

describe("API boundary · telemetry stream", () => {
  /** Minimal Response-alike whose body yields the given UTF-8 chunks then closes. */
  function streamResponse(chunks: string[], status = 200) {
    const encoder = new TextEncoder()
    let index = 0
    return {
      ok: status < 400,
      status,
      statusText: "OK",
      body: {
        getReader: () => ({
          read: async () =>
            index < chunks.length
              ? { value: encoder.encode(chunks[index++]), done: false }
              : { value: undefined, done: true },
        }),
      },
    }
  }

  it("parses complete SSE frames and retains an incomplete tail", () => {
    expect(parseSseChunk('event: telemetry\ndata: {"id":1}\n\nevent: heart')).toEqual({
      events: [{ event: "telemetry", data: { id: 1 } }],
      remainder: "event: heart",
    })
  })

  it("drops frames with no data line and frames whose payload is not JSON", () => {
    expect(parseSseChunk("event: ping\n\n").events).toEqual([])
    expect(parseSseChunk("event: telemetry\ndata: not-json\n\n").events).toEqual([])
  })

  it("defaults the event name to `message` when the frame omits it", () => {
    expect(parseSseChunk('data: {"ok":true}\n\n').events).toEqual([
      { event: "message", data: { ok: true } },
    ])
  })

  it("joins a multi-line data payload before parsing", () => {
    expect(parseSseChunk('event: telemetry\ndata: {"id":\ndata: 1}\n\n').events).toEqual([
      { event: "telemetry", data: { id: 1 } },
    ])
  })

  it("reports `live`, forwards events, then `offline` once the caller aborts", async () => {
    const controller = new AbortController()
    mockFetch(streamResponse(['event: telemetry\ndata: [{"id":1}]\n\n']))

    const events: unknown[] = []
    const states: string[] = []
    const stream = streamTelemetry(
      (event) => {
        events.push(event)
        controller.abort()
      },
      (state) => states.push(state),
      controller.signal
    )
    await stream

    expect(events).toEqual([{ event: "telemetry", data: [{ id: 1 }] }])
    expect(states[0]).toBe("live")
    expect(states.at(-1)).toBe("offline")
  })

  it("refreshes the token when the stream endpoint answers 401", async () => {
    const controller = new AbortController()
    setAccessToken("stale-token")
    const fetchMock = mockFetch(
      { ok: false, status: 401, statusText: "Unauthorized", json: async () => ({}) },
      ok({ accessToken: "fresh-token" }),
      streamResponse(['event: telemetry\ndata: [{"id":1}]\n\n'])
    )

    await streamTelemetry(
      () => controller.abort(),
      () => {},
      controller.signal
    )

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const retryHeaders = fetchMock.mock.calls[2][1]!.headers as Headers
    expect(retryHeaders.get("Authorization")).toBe("Bearer fresh-token")
  })

  it("reports `reconnecting` and backs off when the connection drops", async () => {
    jest.useFakeTimers()
    try {
      const controller = new AbortController()
      const fetchMock = jest
        .fn()
        .mockRejectedValueOnce(new Error("network down"))
        .mockImplementation(async () => {
          controller.abort()
          throw new Error("network down")
        })
      global.fetch = fetchMock as unknown as typeof fetch

      const states: string[] = []
      const stream = streamTelemetry(
        () => {},
        (state) => states.push(state),
        controller.signal
      )
      await jest.advanceTimersByTimeAsync(1_000)
      await stream

      expect(states).toContain("reconnecting")
      expect(states.at(-1)).toBe("offline")
    } finally {
      jest.useRealTimers()
    }
  })

  it("parses the event id so a reconnect can resume from it", () => {
    expect(parseSseChunk('id: 42\nevent: telemetry\ndata: [{"id":1}]\n\n').events).toEqual([
      { event: "telemetry", id: "42", data: [{ id: 1 }] },
    ])
  })

  it("resends the last seen event id on reconnect instead of refetching everything", async () => {
    jest.useFakeTimers()
    try {
      const controller = new AbortController()
      let attempt = 0
      const fetchMock = jest.fn().mockImplementation(async () => {
        attempt += 1
        if (attempt === 1) {
          return streamResponse(['id: 7\nevent: telemetry\ndata: [{"id":1}]\n\n'])
        }
        controller.abort()
        throw new Error("network down")
      })
      global.fetch = fetchMock as unknown as typeof fetch

      const stream = streamTelemetry(
        () => {},
        () => {},
        controller.signal
      )
      await jest.advanceTimersByTimeAsync(2_000)
      await stream

      expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
      const firstHeaders = fetchMock.mock.calls[0][1]!.headers as Headers
      const retryHeaders = fetchMock.mock.calls[1][1]!.headers as Headers
      expect(firstHeaders.has("Last-Event-ID")).toBe(false)
      expect(retryHeaders.get("Last-Event-ID")).toBe("7")
    } finally {
      jest.useRealTimers()
    }
  })

  it("treats a non-OK stream response as a failure", async () => {
    const controller = new AbortController()
    const fetchMock = jest.fn().mockImplementation(async () => {
      if (fetchMock.mock.calls.length > 1) controller.abort()
      return { ok: false, status: 503, statusText: "Unavailable", json: async () => ({}) }
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const states: string[] = []
    await streamTelemetry(
      () => {},
      (state) => states.push(state),
      controller.signal
    )
    expect(states).toContain("reconnecting")
  })

  it("exposes ApiError for callers that need to branch on transport failures", () => {
    const error = new ApiError(503, "Unavailable", "trace-503")
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("ApiError")
    expect(error.status).toBe(503)
    expect(error.traceId).toBe("trace-503")
  })
})

describe("API boundary · desktop refresh token", () => {
  afterEach(() => {
    jest.resetModules()
    jest.dontMock("@/lib/tauri")
  })

  async function loadWithVault(token: string | null) {
    jest.resetModules()
    const save = jest.fn().mockResolvedValue(undefined)
    const clear = jest.fn().mockResolvedValue(undefined)
    jest.doMock("@/lib/tauri", () => ({
      isTauri: () => true,
      loadRefreshToken: jest.fn().mockResolvedValue(token),
      saveRefreshToken: save,
      clearRefreshToken: clear,
    }))
    const client = await import("@/lib/api/client")
    return { client, save, clear }
  }

  it("persists a desktop refresh token on login and sends it on refresh", async () => {
    const { client, save } = await loadWithVault("stored-refresh")
    mockFetch(ok({ accessToken: "a", refreshToken: "r", staff: staffRow }))
    await client.api.login("admin", "admin123")
    expect(save).toHaveBeenCalledWith("r")
    expect((global.fetch as unknown as FetchMock).mock.calls[0][1]!.body).toContain(
      '"client":"tauri"'
    )

    const fetchMock = mockFetch(
      failure(401),
      ok({ accessToken: "a2", refreshToken: "r2" }),
      ok({ totalUav: 1, onlineUav: 1, inPod: 0, alerts: 0 })
    )
    await client.api.dashboard()
    const refreshHeaders = fetchMock.mock.calls[1][1]!.headers as Headers
    expect(refreshHeaders.get("X-Refresh-Token")).toBe("stored-refresh")
    expect(save).toHaveBeenCalledWith("r2")
  })

  it("clears the vault on logout and forwards the token while doing so", async () => {
    const { client, clear } = await loadWithVault("stored-refresh")
    const fetchMock = mockFetch(ok(null))
    await client.api.logout()
    expect((fetchMock.mock.calls[0][1]!.headers as Headers).get("X-Refresh-Token")).toBe(
      "stored-refresh"
    )
    expect(clear).toHaveBeenCalled()
  })

  it("omits the header when the vault is empty", async () => {
    const { client } = await loadWithVault(null)
    const fetchMock = mockFetch(ok(null))
    await client.api.logout()
    expect((fetchMock.mock.calls[0][1]!.headers as Headers).get("X-Refresh-Token")).toBeNull()
  })

  it("sends the stored token when listing sessions", async () => {
    const { client } = await loadWithVault("stored-refresh")
    const fetchMock = mockFetch(ok([]))
    await client.api.sessions()
    expect((fetchMock.mock.calls[0][1]!.headers as Headers).get("X-Refresh-Token")).toBe(
      "stored-refresh"
    )
  })
})
