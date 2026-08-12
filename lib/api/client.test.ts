import { parseApiResponse, parseSseChunk } from "@/lib/api/client"
import { uavSchema } from "@/lib/api/schemas"

describe("API boundary", () => {
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
})
