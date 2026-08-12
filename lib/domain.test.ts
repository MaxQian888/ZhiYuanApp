import {
  canTransitionOrder,
  canTransitionTask,
  filterUavs,
  parseVoiceCommand,
  type Uav,
} from "@/lib/domain"

const uavs: Uav[] = [
  {
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
  {
    id: 2,
    code: "UAV-02",
    name: "配送二号",
    rfidTag: "RFID-0002",
    model: "DJI Air 2S",
    ownerName: "Operator",
    status: "FLYING",
    battery: 42,
    inHibernatePod: false,
    region: "苏州",
    altitude: 82,
    speed: 12.4,
    latitude: 31.3,
    longitude: 120.62,
    updatedAt: "2026-08-12T10:01:00+08:00",
  },
]

describe("domain behavior", () => {
  it("filters UAVs by text and status without losing either constraint", () => {
    expect(filterUavs(uavs, "DJI", "FLYING")).toEqual([uavs[1]])
    expect(filterUavs(uavs, "RFID-0001", "ALL")).toEqual([uavs[0]])
  })

  it("enforces order transitions", () => {
    expect(canTransitionOrder("CREATED", "DISPATCHING")).toBe(true)
    expect(canTransitionOrder("FINISHED", "DELIVERING")).toBe(false)
    expect(canTransitionOrder("CANCELLED", "CREATED")).toBe(false)
  })

  it("enforces task transitions", () => {
    expect(canTransitionTask("WAITING", "FLYING")).toBe(true)
    expect(canTransitionTask("FLYING", "ARRIVED")).toBe(true)
    expect(canTransitionTask("ARRIVED", "FAILED")).toBe(false)
  })

  it("parses safe voice commands and rejects ambiguous text", () => {
    expect(parseVoiceCommand("无人机一号起飞", uavs)).toEqual({
      type: "TAKE_OFF",
      uavId: 1,
      transcript: "无人机一号起飞",
    })
    expect(parseVoiceCommand("stop UAV-02", uavs)).toEqual({
      type: "STOP",
      uavId: 2,
      transcript: "stop UAV-02",
    })
    expect(parseVoiceCommand("执行任务", uavs)).toBeNull()
  })
})
