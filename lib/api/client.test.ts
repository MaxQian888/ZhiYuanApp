import {
  api,
  isSessionRecoverySuppressed,
  parseApiResponse,
  parseSseChunk,
  resumeSessionRecovery,
  suppressSessionRecovery,
} from "@/lib/api/client"
import { uavSchema } from "@/lib/api/schemas"

describe("API boundary", () => {
  afterEach(() => resumeSessionRecovery())

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
    expect(() => suppressSessionRecovery()).not.toThrow()
    expect(isSessionRecoverySuppressed()).toBe(true)
    getItem.mockRestore()
    setItem.mockRestore()
  })

  it("accepts the versioned response envelope and validates its data", () => {
    const parsed = parseApiResponse(
      {
        code: 200,
        message: "ok",
        traceId: "trace-1",
        data: {
          id: 1,
          code: "UAV-01",
          name: "巡检一号",
          rfidTag: "RFID-0001",
          model: "DJI Mavic 3",
          ownerName: "Admin",
          status: "ONLINE",
          battery: 78,
          inHibernatePod: true,
          region: "南京",
          altitude: 30,
          speed: 5.2,
          latitude: 32.06,
          longitude: 118.78,
          updatedAt: "2026-08-12T10:00:00+08:00",
        },
      },
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

  it("parses complete SSE frames and retains an incomplete tail", () => {
    expect(parseSseChunk('event: telemetry\ndata: {"id":1}\n\nevent: heart')).toEqual({
      events: [{ event: "telemetry", data: { id: 1 } }],
      remainder: "event: heart",
    })
  })

  it("sends user mutations through the versioned API and validates the response", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        code: 200,
        message: "ok",
        traceId: "trace-user",
        data: {
          id: 9,
          username: "周岚",
          phone: "13911112222",
          createdAt: "2026-08-12T18:00:00+08:00",
          addresses: [],
        },
      }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(api.saveUser({ username: "周岚", phone: "13911112222" })).resolves.toMatchObject({
      id: 9,
      username: "周岚",
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/users",
      expect.objectContaining({ method: "POST", body: '{"username":"周岚","phone":"13911112222"}' })
    )
  })

  it("validates staff account mutations at the API boundary", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: "OK",
        traceId: "trace-staff",
        data: {
          id: 8,
          username: "night.ops",
          displayName: "夜航运营",
          role: "manager",
          phone: "13800000008",
          enabled: true,
        },
      }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(
      api.createStaffAccount({
        username: "night.ops",
        password: "nightops123",
        displayName: "夜航运营",
        role: "manager",
        phone: "13800000008",
      })
    ).resolves.toMatchObject({ id: 8, enabled: true })
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/admins",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          username: "night.ops",
          password: "nightops123",
          displayName: "夜航运营",
          role: "manager",
          phone: "13800000008",
        }),
      })
    )
  })
})
