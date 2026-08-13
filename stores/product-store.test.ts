describe("remote product store", () => {
  it("never exposes simulator records while live data is pending or cache is cleared", async () => {
    process.env.NEXT_PUBLIC_API_MODE = "remote"
    jest.resetModules()
    const [{ useProductStore }, { seedUavs }] = await Promise.all([
      import("./product-store"),
      import("@/lib/mock-data"),
    ])

    expect(useProductStore.getState().dataSyncPending).toBe(true)
    expect(useProductStore.getState().uavs).toEqual([])

    useProductStore.setState({ uavs: seedUavs, dataSyncPending: false })
    useProductStore.getState().clearNonAuthCache()

    expect(useProductStore.getState().uavs).toEqual([])
    expect(useProductStore.getState().dataSyncPending).toBe(true)
    process.env.NEXT_PUBLIC_API_MODE = "simulator"
  })
})
