import { deriveDataSyncState } from "./sync-state"

describe("deriveDataSyncState", () => {
  it("reports pending resources without treating them as failures", () => {
    expect(
      deriveDataSyncState([
        { key: "uavs", isPending: true, isError: false },
        { key: "alerts", isPending: false, isError: false },
      ])
    ).toEqual({ pending: true, failedResources: [] })
  })

  it("returns every failed resource for a visible retry state", () => {
    expect(
      deriveDataSyncState([
        { key: "uavs", isPending: false, isError: true },
        { key: "orders", isPending: false, isError: true },
      ])
    ).toEqual({ pending: false, failedResources: ["uavs", "orders"] })
  })
})
