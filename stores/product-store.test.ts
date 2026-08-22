import type { useProductStore as UseProductStore } from "./product-store"

type Store = typeof UseProductStore

/**
 * `remoteMode` is captured once at module load, so switching data modes means
 * reloading the module graph. Every helper below returns a freshly seeded store.
 */
async function loadSimulatorStore(): Promise<Store> {
  process.env.NEXT_PUBLIC_API_MODE = "simulator"
  jest.resetModules()
  const { useProductStore } = await import("./product-store")
  return useProductStore
}

type ApiMock = Record<string, jest.Mock>

async function loadRemoteStore(api: ApiMock): Promise<Store> {
  process.env.NEXT_PUBLIC_API_MODE = "remote"
  jest.resetModules()
  jest.doMock("@/lib/api/client", () => ({
    api,
    ApiError: class ApiError extends Error {},
    isSessionRecoverySuppressed: () => false,
    streamTelemetry: jest.fn(),
    setAccessToken: jest.fn(),
  }))
  const { useProductStore } = await import("./product-store")
  return useProductStore
}

afterEach(() => {
  process.env.NEXT_PUBLIC_API_MODE = "simulator"
  jest.dontMock("@/lib/api/client")
})

describe("product store · simulator mode", () => {
  let store: Store

  beforeEach(async () => {
    store = await loadSimulatorStore()
  })

  it("starts authenticated with seeded data so the UI is previewable offline", () => {
    const state = store.getState()
    expect(state.authenticated).toBe(true)
    expect(state.realtimeState).toBe("live")
    expect(state.dataSyncPending).toBe(false)
    expect(state.uavs.length).toBeGreaterThan(0)
    expect(state.goods.length).toBeGreaterThan(0)
  })

  it("accepts the demo credentials and rejects everything else", () => {
    expect(store.getState().login("admin", "admin123")).toBe(true)
    expect(store.getState().authenticated).toBe(true)
    expect(store.getState().login("admin", "wrong")).toBe(false)
    expect(store.getState().login("intruder", "admin123")).toBe(false)
  })

  it("keeps seeded data on logout because there is no remote cache to protect", () => {
    store.getState().logout()
    const state = store.getState()
    expect(state.authenticated).toBe(false)
    expect(state.staff).toBeNull()
    expect(state.uavs.length).toBeGreaterThan(0)
  })

  it("sets locale and selected UAV", () => {
    store.getState().setLocale("en")
    store.getState().setSelectedUav(4)
    expect(store.getState().locale).toBe("en")
    expect(store.getState().selectedUavId).toBe(4)
  })

  it("clearNonAuthCache only resets the selection", () => {
    store.getState().setSelectedUav(5)
    store.getState().clearNonAuthCache()
    expect(store.getState().selectedUavId).toBe(1)
    expect(store.getState().uavs.length).toBeGreaterThan(0)
  })

  it("patches the signed-in staff profile", async () => {
    await store.getState().updateStaff({ displayName: "新名字", phone: "13900000000" })
    expect(store.getState().staff?.displayName).toBe("新名字")
    expect(store.getState().staff?.phone).toBe("13900000000")
  })

  it("ignores a profile patch when nobody is signed in", async () => {
    store.setState({ staff: null })
    await store.getState().updateStaff({ displayName: "无人" })
    expect(store.getState().staff).toBeNull()
  })

  it("walks a manual command from QUEUED through SENT to ACKNOWLEDGED", async () => {
    jest.useFakeTimers()
    try {
      const id = await store.getState().sendCommand(2, "RETURN_HOME", "MANUAL")
      expect(store.getState().commands[0]).toMatchObject({ id, status: "QUEUED", source: "MANUAL" })
      expect(store.getState().auditLogs[0]).toMatchObject({ id: `C-${id}`, category: "CONTROL" })

      jest.advanceTimersByTime(400)
      expect(store.getState().commands[0].status).toBe("SENT")
      expect(store.getState().auditLogs[0].status).toBe("SENT")

      jest.advanceTimersByTime(700)
      expect(store.getState().commands[0].status).toBe("ACKNOWLEDGED")
      expect(store.getState().auditLogs[0].status).toBe("ACKNOWLEDGED")
    } finally {
      jest.useRealTimers()
    }
  })

  it("files a voice command under the VOICE audit category with its transcript", async () => {
    await store.getState().sendCommand(1, "LAND", "VOICE", "无人机一号降落")
    const log = store.getState().auditLogs[0]
    expect(log.category).toBe("VOICE")
    expect(log.detail).toBe("无人机一号降落")
  })

  it("acknowledges then resolves an alert, stamping the operator each time", async () => {
    const open = store.getState().alerts.find((alert) => alert.status === "OPEN")!
    await store.getState().acknowledgeAlert(open.id)
    let alert = store.getState().alerts.find((item) => item.id === open.id)!
    expect(alert.status).toBe("ACKNOWLEDGED")
    expect(alert.acknowledgedBy).toBe(store.getState().staff?.id)

    await store.getState().resolveAlert(open.id)
    alert = store.getState().alerts.find((item) => item.id === open.id)!
    expect(alert.status).toBe("RESOLVED")
    expect(alert.resolved).toBe(true)
  })

  it("creates, updates and deletes a customer", async () => {
    const before = store.getState().users.length
    await store.getState().saveUser({ username: "新客户", phone: "13800000001" })
    expect(store.getState().users).toHaveLength(before + 1)

    const created = store.getState().users.at(-1)!
    await store.getState().saveUser({ id: created.id, username: "改名", phone: "13800000002" })
    expect(store.getState().users.at(-1)).toMatchObject({ username: "改名", phone: "13800000002" })

    await store.getState().deleteUser(created.id)
    expect(store.getState().users).toHaveLength(before)
  })

  it("moves the default flag when a new default address is saved", async () => {
    const user = store.getState().users.find((item) => item.addresses.length > 0)!
    await store.getState().saveAddress(user.id, {
      receiverName: "第二地址",
      receiverPhone: "13800000003",
      detail: "上海市浦东新区",
      latitude: 31.2,
      longitude: 121.5,
      isDefault: true,
    })
    const addresses = store.getState().users.find((item) => item.id === user.id)!.addresses
    expect(addresses.filter((address) => address.isDefault)).toHaveLength(1)
    expect(addresses.at(-1)?.isDefault).toBe(true)
  })

  it("edits an existing address in place", async () => {
    const user = store.getState().users.find((item) => item.addresses.length > 0)!
    const address = user.addresses[0]
    await store.getState().saveAddress(user.id, { ...address, detail: "新的详细地址" })
    const updated = store.getState().users.find((item) => item.id === user.id)!.addresses[0]
    expect(updated.detail).toBe("新的详细地址")
  })

  it("leaves other customers untouched when saving an address", async () => {
    const [first, second] = store.getState().users
    const snapshot = JSON.stringify(second.addresses)
    await store.getState().saveAddress(first.id, {
      receiverName: "x",
      receiverPhone: "13800000004",
      detail: "y",
      latitude: 0,
      longitude: 0,
      isDefault: false,
    })
    expect(JSON.stringify(store.getState().users[1].addresses)).toBe(snapshot)
  })

  it("promotes the next address to default when the default one is deleted", async () => {
    const user = store.getState().users.find((item) => item.addresses.length > 0)!
    await store.getState().saveAddress(user.id, {
      receiverName: "备用",
      receiverPhone: "13800000005",
      detail: "备用地址",
      latitude: 30,
      longitude: 120,
      isDefault: false,
    })
    const withTwo = store.getState().users.find((item) => item.id === user.id)!
    const defaultAddress = withTwo.addresses.find((address) => address.isDefault)!

    await store.getState().deleteAddress(user.id, defaultAddress.id)
    const remaining = store.getState().users.find((item) => item.id === user.id)!.addresses
    expect(remaining.some((address) => address.id === defaultAddress.id)).toBe(false)
    expect(remaining[0].isDefault).toBe(true)
  })

  it("deleting a non-default address does not reshuffle the default", async () => {
    const user = store.getState().users.find((item) => item.addresses.length > 0)!
    await store.getState().saveAddress(user.id, {
      receiverName: "临时",
      receiverPhone: "13800000006",
      detail: "临时地址",
      latitude: 30,
      longitude: 120,
      isDefault: false,
    })
    const added = store
      .getState()
      .users.find((item) => item.id === user.id)!
      .addresses.at(-1)!
    await store.getState().deleteAddress(user.id, added.id)
    const remaining = store.getState().users.find((item) => item.id === user.id)!.addresses
    expect(remaining.filter((address) => address.isDefault)).toHaveLength(1)
  })

  it("setDefaultAddress leaves exactly one default", async () => {
    const user = store.getState().users.find((item) => item.addresses.length > 0)!
    await store.getState().saveAddress(user.id, {
      receiverName: "另一个",
      receiverPhone: "13800000007",
      detail: "另一个地址",
      latitude: 30,
      longitude: 120,
      isDefault: false,
    })
    const target = store
      .getState()
      .users.find((item) => item.id === user.id)!
      .addresses.at(-1)!
    await store.getState().setDefaultAddress(user.id, target.id)
    const addresses = store.getState().users.find((item) => item.id === user.id)!.addresses
    expect(addresses.filter((address) => address.isDefault)).toHaveLength(1)
    expect(addresses.find((address) => address.id === target.id)?.isDefault).toBe(true)
  })

  it("creates, edits, toggles and bulk-deletes goods", async () => {
    const before = store.getState().goods.length
    await store.getState().saveGoods({
      name: "测试商品",
      category: "life",
      price: 10,
      stock: 3,
      weight: 1,
      status: 1,
    })
    const created = store.getState().goods.at(-1)!
    expect(store.getState().goods).toHaveLength(before + 1)

    await store.getState().saveGoods({ ...created, name: "改过的商品" })
    expect(store.getState().goods.at(-1)?.name).toBe("改过的商品")

    await store.getState().toggleGoods(created.id)
    expect(store.getState().goods.at(-1)?.status).toBe(0)
    await store.getState().toggleGoods(created.id)
    expect(store.getState().goods.at(-1)?.status).toBe(1)

    await store.getState().deleteGoods([created.id])
    expect(store.getState().goods).toHaveLength(before)
  })

  it("creates an order, snapshots the address and reduces available stock", async () => {
    const user = store.getState().users.find((item) => item.addresses.length > 0)!
    const goods = store.getState().goods.find((item) => item.status === 1 && item.stock >= 2)!
    const stockBefore = goods.stock

    await store
      .getState()
      .createOrder(user.id, user.addresses[0].id, [{ goodsId: goods.id, count: 2 }])

    const order = store.getState().orders[0]
    expect(order.status).toBe("CREATED")
    expect(order.totalPrice).toBeCloseTo(goods.price * 2)
    expect(order.addressSnapshot?.receiverName).toBe(user.addresses[0].receiverName)
    expect(store.getState().goods.find((item) => item.id === goods.id)?.stock).toBe(stockBefore - 2)
  })

  it("moves stock from available to reserved without changing the physical count", async () => {
    const user = store.getState().users.find((item) => item.addresses.length > 0)!
    const goods = store.getState().goods.find((item) => item.status === 1 && item.stock >= 2)!
    const availableBefore = goods.stock
    const reservedBefore = goods.reservedStock

    await store
      .getState()
      .createOrder(user.id, user.addresses[0].id, [{ goodsId: goods.id, count: 2 }])

    const after = store.getState().goods.find((item) => item.id === goods.id)!
    expect(after.stock).toBe(availableBefore - 2)
    expect(after.reservedStock).toBe(reservedBefore + 2)
    expect(after.stock + after.reservedStock).toBe(availableBefore + reservedBefore)
  })

  it("cancelling an order returns its reservation to available stock", async () => {
    const created = store.getState().orders.find((order) => order.status === "CREATED")!
    const line = created.items[0]
    const before = store.getState().goods.find((item) => item.id === line.goodsId)!

    expect(await store.getState().transitionOrder(created.id, "CANCELLED")).toBe(true)

    const after = store.getState().goods.find((item) => item.id === line.goodsId)!
    expect(after.stock).toBe(before.stock + line.count)
    expect(after.reservedStock).toBe(before.reservedStock - line.count)
  })

  it("arriving consumes the reservation and drops the physical count", async () => {
    const task = store.getState().tasks.find((item) => item.taskStatus === "FLYING")!
    const order = store.getState().orders.find((item) => item.id === task.orderId)!
    const line = order.items[0]
    const before = store.getState().goods.find((item) => item.id === line.goodsId)!

    expect(await store.getState().transitionTask(task.id, "ARRIVED")).toBe(true)

    const after = store.getState().goods.find((item) => item.id === line.goodsId)!
    expect(after.stock).toBe(before.stock)
    expect(after.reservedStock).toBe(before.reservedStock - line.count)
    expect(after.stock + after.reservedStock).toBeLessThan(before.stock + before.reservedStock)
    expect(store.getState().orders.find((item) => item.id === order.id)?.status).toBe("FINISHED")
  })

  it("a failed task keeps its reservation so the order can be re-dispatched", async () => {
    const waiting = store.getState().tasks.find((item) => item.taskStatus === "WAITING")!
    const order = store.getState().orders.find((item) => item.id === waiting.orderId)!
    const line = order.items[0]
    const before = store.getState().goods.find((item) => item.id === line.goodsId)!

    expect(await store.getState().transitionTask(waiting.id, "FAILED", "强风")).toBe(true)

    const after = store.getState().goods.find((item) => item.id === line.goodsId)!
    expect(after.stock).toBe(before.stock)
    expect(after.reservedStock).toBe(before.reservedStock)
    expect(store.getState().orders.find((item) => item.id === order.id)?.status).toBe("ERROR")
  })

  it("refuses an order with no items, an unknown customer or an unknown address", async () => {
    const user = store.getState().users.find((item) => item.addresses.length > 0)!
    await expect(store.getState().createOrder(user.id, user.addresses[0].id, [])).rejects.toThrow(
      "Invalid order data"
    )
    await expect(
      store.getState().createOrder(9999, user.addresses[0].id, [{ goodsId: 1, count: 1 }])
    ).rejects.toThrow("Invalid order data")
    await expect(
      store.getState().createOrder(user.id, 9999, [{ goodsId: 1, count: 1 }])
    ).rejects.toThrow("Invalid order data")
  })

  it("refuses an order that exceeds stock or targets a delisted product", async () => {
    const user = store.getState().users.find((item) => item.addresses.length > 0)!
    const goods = store.getState().goods.find((item) => item.status === 1)!
    await expect(
      store
        .getState()
        .createOrder(user.id, user.addresses[0].id, [{ goodsId: goods.id, count: goods.stock + 1 }])
    ).rejects.toThrow("Insufficient stock")

    const delisted = store.getState().goods.find((item) => item.status === 0)
    if (delisted) {
      await expect(
        store
          .getState()
          .createOrder(user.id, user.addresses[0].id, [{ goodsId: delisted.id, count: 1 }])
      ).rejects.toThrow("Insufficient stock")
    }
  })

  it("enforces the order state machine", async () => {
    const created = store.getState().orders.find((order) => order.status === "CREATED")!
    expect(await store.getState().transitionOrder(created.id, "FINISHED")).toBe(false)
    expect(await store.getState().transitionOrder(9999, "CANCELLED")).toBe(false)
    expect(await store.getState().transitionOrder(created.id, "CANCELLED")).toBe(true)
    expect(store.getState().orders.find((order) => order.id === created.id)?.status).toBe(
      "CANCELLED"
    )
  })

  it("fails the in-flight task when its order is cancelled", async () => {
    const task = store.getState().tasks.find((item) => item.taskStatus === "FLYING")!
    store.setState((state) => ({
      orders: state.orders.map((order) =>
        order.id === task.orderId ? { ...order, status: "DISPATCHING" as const } : order
      ),
    }))

    expect(await store.getState().transitionOrder(task.orderId, "CANCELLED")).toBe(true)
    const after = store.getState().tasks.find((item) => item.id === task.id)!
    expect(after.taskStatus).toBe("FAILED")
    expect(after.endTime).toBeDefined()
  })

  it("dispatching an order creates a waiting task", async () => {
    const created = store.getState().orders.find((order) => order.status === "CREATED")!
    expect(await store.getState().dispatchOrder(created.id, 1)).toBe(true)
    expect(store.getState().orders.find((order) => order.id === created.id)?.status).toBe(
      "DISPATCHING"
    )
    const task = store.getState().tasks.at(-1)!
    expect(task).toMatchObject({ orderId: created.id, uavId: 1, taskStatus: "WAITING" })
  })

  it("refuses to dispatch an unknown or already-delivering order", async () => {
    expect(await store.getState().dispatchOrder(9999, 1)).toBe(false)
    const delivering = store.getState().orders.find((order) => order.status === "DELIVERING")
    if (delivering) expect(await store.getState().dispatchOrder(delivering.id, 1)).toBe(false)
  })

  it("enforces the task state machine and stamps timings", async () => {
    const waiting = store.getState().tasks.find((item) => item.taskStatus === "WAITING")!
    expect(await store.getState().transitionTask(waiting.id, "ARRIVED")).toBe(false)
    expect(await store.getState().transitionTask(9999, "FLYING")).toBe(false)
    expect(await store.getState().transitionTask(waiting.id, "WAITING")).toBe(false)

    expect(await store.getState().transitionTask(waiting.id, "FLYING")).toBe(true)
    expect(store.getState().tasks.find((item) => item.id === waiting.id)?.startTime).toBeDefined()

    expect(await store.getState().transitionTask(waiting.id, "ARRIVED")).toBe(true)
    expect(store.getState().tasks.find((item) => item.id === waiting.id)?.endTime).toBeDefined()
  })

  it("records the failure reason when a task fails", async () => {
    const waiting = store.getState().tasks.find((item) => item.taskStatus === "WAITING")!
    expect(await store.getState().transitionTask(waiting.id, "FAILED", "强风")).toBe(true)
    const failed = store.getState().tasks.find((item) => item.id === waiting.id)!
    expect(failed).toMatchObject({ taskStatus: "FAILED", failureReason: "强风" })
  })

  it("binds a device once and then revokes it", async () => {
    const before = store.getState().bindings.length
    await store.getState().bindDevice(6)
    expect(store.getState().bindings).toHaveLength(before + 1)

    await store.getState().bindDevice(6)
    expect(store.getState().bindings).toHaveLength(before + 1)

    const binding = store.getState().bindings.at(-1)!
    await store.getState().unbindDevice(binding.id)
    expect(store.getState().bindings.at(-1)?.unboundAt).toBeDefined()
  })

  it("does not bind a device when nobody is signed in", async () => {
    store.setState({ staff: null })
    const before = store.getState().bindings.length
    await store.getState().bindDevice(6)
    expect(store.getState().bindings).toHaveLength(before)
  })

  it("updates a pod door and its occupant", async () => {
    const pod = store.getState().pods[0]
    await store.getState().updatePod(pod.id, "OPEN", 5)
    expect(store.getState().pods.find((item) => item.id === pod.id)).toMatchObject({
      doorStatus: "OPEN",
      uavId: 5,
    })
  })
})

describe("product store · remote mode", () => {
  const staff = {
    id: 7,
    username: "admin",
    displayName: "远程管理员",
    role: "admin" as const,
    phone: "13900000009",
  }

  function buildApi(overrides: ApiMock = {}): ApiMock {
    return {
      updateProfile: jest.fn().mockResolvedValue({ ...staff, displayName: "远程改名" }),
      command: jest
        .fn()
        .mockResolvedValue({ commandId: "srv-1", status: "QUEUED", adapter: "mqtt" }),
      acknowledgeAlert: jest.fn().mockResolvedValue({
        id: 1,
        uavId: 2,
        title: "服务端告警",
        level: "HIGH",
        occurredAt: "2026-08-22T00:00:00+08:00",
        resolved: false,
        status: "ACKNOWLEDGED",
      }),
      resolveAlert: jest.fn().mockResolvedValue({
        id: 1,
        uavId: 2,
        title: "服务端告警",
        level: "HIGH",
        occurredAt: "2026-08-22T00:00:00+08:00",
        resolved: true,
        status: "RESOLVED",
      }),
      saveUser: jest.fn().mockResolvedValue({
        id: 11,
        username: "服务端客户",
        phone: "13800000011",
        createdAt: "2026-08-22T00:00:00+08:00",
        addresses: [],
      }),
      deleteUser: jest.fn().mockResolvedValue(null),
      saveAddress: jest.fn().mockResolvedValue({
        id: 21,
        userId: 11,
        receiverName: "服务端收件人",
        receiverPhone: "13800000012",
        detail: "服务端地址",
        latitude: 30,
        longitude: 120,
        isDefault: true,
      }),
      deleteAddress: jest.fn().mockResolvedValue(null),
      setDefaultAddress: jest.fn().mockResolvedValue({
        id: 21,
        userId: 11,
        receiverName: "服务端收件人",
        receiverPhone: "13800000012",
        detail: "服务端地址",
        latitude: 30,
        longitude: 120,
        isDefault: true,
      }),
      saveGoods: jest.fn().mockResolvedValue({
        id: 31,
        name: "服务端商品",
        category: "life",
        price: 12,
        stock: 9,
        weight: 1,
        status: 1,
      }),
      deleteGoods: jest.fn().mockResolvedValue(null),
      toggleGoods: jest.fn().mockResolvedValue({
        id: 31,
        name: "服务端商品",
        category: "life",
        price: 12,
        stock: 9,
        weight: 1,
        status: 0,
      }),
      cancelOrder: jest.fn().mockResolvedValue({
        id: 41,
        orderNo: "ZY-1",
        userId: 11,
        addressId: 21,
        totalPrice: 12,
        status: "CANCELLED",
        createdAt: "2026-08-22T00:00:00+08:00",
        items: [],
      }),
      createOrder: jest.fn().mockResolvedValue({
        id: 42,
        orderNo: "ZY-2",
        userId: 11,
        addressId: 21,
        totalPrice: 24,
        status: "CREATED",
        createdAt: "2026-08-22T00:00:00+08:00",
        items: [],
      }),
      dispatchOrder: jest
        .fn()
        .mockResolvedValue({ id: 51, orderId: 41, uavId: 2, taskStatus: "WAITING" }),
      transitionTask: jest
        .fn()
        .mockResolvedValue({ id: 51, orderId: 41, uavId: 2, taskStatus: "FLYING" }),
      bindDevice: jest
        .fn()
        .mockResolvedValue({ id: 61, staffId: 7, uavId: 3, boundAt: "2026-08-22T00:00:00+08:00" }),
      unbindDevice: jest.fn().mockResolvedValue(null),
      updatePod: jest.fn().mockResolvedValue({
        id: 71,
        name: "POD-09",
        region: "南京",
        doorStatus: "OPEN",
        uavId: 3,
      }),
      ...overrides,
    }
  }

  it("starts empty and pending so simulator rows never leak into a live console", async () => {
    const store = await loadRemoteStore(buildApi())
    const state = store.getState()
    expect(state.authenticated).toBe(false)
    expect(state.staff).toBeNull()
    expect(state.realtimeState).toBe("offline")
    expect(state.dataSyncPending).toBe(true)
    expect(state.uavs).toEqual([])
    expect(state.goods).toEqual([])
    expect(state.orders).toEqual([])
  })

  it("wipes every cached collection on logout", async () => {
    const store = await loadRemoteStore(buildApi())
    const { seedUavs, seedGoods } = await import("@/lib/mock-data")
    store.setState({ authenticated: true, staff, uavs: seedUavs, goods: seedGoods })

    store.getState().logout()
    const state = store.getState()
    expect(state.authenticated).toBe(false)
    expect(state.uavs).toEqual([])
    expect(state.goods).toEqual([])
    expect(state.realtimeState).toBe("offline")
  })

  it("clearNonAuthCache empties data and re-arms the pending flag", async () => {
    const store = await loadRemoteStore(buildApi())
    const { seedUavs } = await import("@/lib/mock-data")
    store.setState({ uavs: seedUavs, dataSyncPending: false, selectedUavId: 9 })

    store.getState().clearNonAuthCache()
    expect(store.getState().uavs).toEqual([])
    expect(store.getState().dataSyncPending).toBe(true)
    expect(store.getState().selectedUavId).toBe(1)
  })

  it("sends the profile patch to the server and keeps the server's answer", async () => {
    const api = buildApi()
    const store = await loadRemoteStore(api)
    store.setState({ staff })

    await store.getState().updateStaff({ displayName: "远程改名" })
    expect(api.updateProfile).toHaveBeenCalledWith("远程改名", staff.phone)
    expect(store.getState().staff?.displayName).toBe("远程改名")
  })

  it("adopts the server-issued command id instead of minting a local one", async () => {
    const api = buildApi()
    const store = await loadRemoteStore(api)
    store.setState({ staff })

    const id = await store.getState().sendCommand(2, "TAKE_OFF", "VOICE", "起飞")
    expect(id).toBe("srv-1")
    expect(api.command).toHaveBeenCalledWith(2, {
      type: "TAKE_OFF",
      source: "VOICE",
      transcript: "起飞",
    })
    expect(store.getState().commands[0]).toMatchObject({ id: "srv-1", status: "QUEUED" })
    expect(store.getState().auditLogs[0]).toMatchObject({
      id: "C-srv-1",
      category: "VOICE",
      operatorName: staff.displayName,
    })
  })

  it("applies the server's alert rows verbatim", async () => {
    const api = buildApi()
    const store = await loadRemoteStore(api)
    store.setState({
      alerts: [
        {
          id: 1,
          uavId: 2,
          title: "本地告警",
          level: "HIGH",
          occurredAt: "2026-08-22T00:00:00+08:00",
          resolved: false,
          status: "OPEN",
        },
      ],
    })

    await store.getState().acknowledgeAlert(1)
    expect(store.getState().alerts[0].title).toBe("服务端告警")
    await store.getState().resolveAlert(1)
    expect(store.getState().alerts[0].status).toBe("RESOLVED")
  })

  it("routes customer, address and goods writes through the API", async () => {
    const api = buildApi()
    const store = await loadRemoteStore(api)

    await store.getState().saveUser({ username: "服务端客户", phone: "13800000011" })
    expect(store.getState().users).toHaveLength(1)
    await store.getState().saveUser({ id: 11, username: "服务端客户", phone: "13800000011" })
    expect(store.getState().users).toHaveLength(1)

    await store.getState().saveAddress(11, {
      receiverName: "服务端收件人",
      receiverPhone: "13800000012",
      detail: "服务端地址",
      latitude: 30,
      longitude: 120,
      isDefault: true,
    })
    expect(store.getState().users[0].addresses).toHaveLength(1)
    await store.getState().saveAddress(11, {
      id: 21,
      receiverName: "服务端收件人",
      receiverPhone: "13800000012",
      detail: "改过的地址",
      latitude: 30,
      longitude: 120,
      isDefault: true,
    })
    expect(store.getState().users[0].addresses).toHaveLength(1)

    await store.getState().setDefaultAddress(11, 21)
    expect(store.getState().users[0].addresses[0].isDefault).toBe(true)

    await store.getState().deleteAddress(11, 21)
    expect(api.deleteAddress).toHaveBeenCalledWith(11, 21)
    expect(store.getState().users[0].addresses).toHaveLength(0)

    await store.getState().deleteUser(11)
    expect(api.deleteUser).toHaveBeenCalledWith(11)
    expect(store.getState().users).toHaveLength(0)

    await store.getState().saveGoods({
      name: "服务端商品",
      category: "life",
      price: 12,
      stock: 9,
      weight: 1,
      status: 1,
    })
    expect(store.getState().goods).toHaveLength(1)
    await store.getState().saveGoods({
      id: 31,
      name: "服务端商品",
      category: "life",
      price: 12,
      stock: 9,
      weight: 1,
      status: 1,
    })
    expect(store.getState().goods).toHaveLength(1)

    await store.getState().toggleGoods(31)
    expect(store.getState().goods[0].status).toBe(0)

    await store.getState().deleteGoods([31])
    expect(api.deleteGoods).toHaveBeenCalledWith([31])
    expect(store.getState().goods).toHaveLength(0)
  })

  it("creates an order from the server response and still trims local stock", async () => {
    const api = buildApi()
    const store = await loadRemoteStore(api)
    store.setState({
      goods: [
        {
          id: 31,
          name: "服务端商品",
          category: "life",
          price: 12,
          stock: 9,
          weight: 1,
          status: 1,
          reservedStock: 0,
        },
      ],
    })

    await store.getState().createOrder(11, 21, [{ goodsId: 31, count: 2 }])
    expect(api.createOrder).toHaveBeenCalledWith(
      11,
      21,
      [{ goodsId: 31, count: 2 }],
      expect.stringMatching(/.+/)
    )
    expect(store.getState().orders[0].orderNo).toBe("ZY-2")
    expect(store.getState().goods[0]).toMatchObject({ stock: 7, reservedStock: 2 })
  })

  it("sends a fresh idempotency key for each distinct create", async () => {
    const api = buildApi()
    const store = await loadRemoteStore(api)
    store.setState({
      goods: [
        {
          id: 31,
          name: "服务端商品",
          category: "life",
          price: 12,
          stock: 9,
          weight: 1,
          status: 1,
          reservedStock: 0,
        },
      ],
    })

    await store.getState().createOrder(11, 21, [{ goodsId: 31, count: 1 }])
    await store.getState().createOrder(11, 21, [{ goodsId: 31, count: 1 }])

    const [firstKey, secondKey] = api.createOrder.mock.calls.map((call) => call[3])
    expect(firstKey).toEqual(expect.any(String))
    expect(secondKey).not.toBe(firstKey)
  })

  it("cancels through the API and refuses illegal transitions before calling it", async () => {
    const api = buildApi()
    const store = await loadRemoteStore(api)
    store.setState({
      orders: [
        {
          id: 41,
          orderNo: "ZY-1",
          userId: 11,
          addressId: 21,
          totalPrice: 12,
          status: "FINISHED",
          createdAt: "2026-08-22T00:00:00+08:00",
          items: [],
        },
      ],
    })
    expect(await store.getState().transitionOrder(41, "CANCELLED")).toBe(false)
    expect(api.cancelOrder).not.toHaveBeenCalled()

    store.setState((state) => ({
      orders: state.orders.map((order) => ({ ...order, status: "CREATED" as const })),
    }))
    expect(await store.getState().transitionOrder(41, "CANCELLED")).toBe(true)
    expect(api.cancelOrder).toHaveBeenCalledWith(41)
    expect(store.getState().orders[0].status).toBe("CANCELLED")
  })

  it("dispatches through the API, replacing an existing task row rather than duplicating it", async () => {
    const api = buildApi()
    const store = await loadRemoteStore(api)
    store.setState({
      orders: [
        {
          id: 41,
          orderNo: "ZY-1",
          userId: 11,
          addressId: 21,
          totalPrice: 12,
          status: "CREATED",
          createdAt: "2026-08-22T00:00:00+08:00",
          items: [],
        },
      ],
      tasks: [{ id: 51, orderId: 41, uavId: 9, taskStatus: "FAILED" }],
    })

    expect(await store.getState().dispatchOrder(41, 2)).toBe(true)
    expect(store.getState().tasks).toHaveLength(1)
    expect(store.getState().tasks[0]).toMatchObject({ uavId: 2, taskStatus: "WAITING" })
  })

  it("mirrors the task transition onto the order status", async () => {
    const api = buildApi()
    const store = await loadRemoteStore(api)
    store.setState({
      orders: [
        {
          id: 41,
          orderNo: "ZY-1",
          userId: 11,
          addressId: 21,
          totalPrice: 12,
          status: "DISPATCHING",
          createdAt: "2026-08-22T00:00:00+08:00",
          items: [],
        },
      ],
      tasks: [{ id: 51, orderId: 41, uavId: 2, taskStatus: "WAITING" }],
    })

    expect(await store.getState().transitionTask(51, "FLYING")).toBe(true)
    expect(store.getState().orders[0].status).toBe("DELIVERING")
  })

  it("binds, unbinds and updates pods through the API", async () => {
    const api = buildApi()
    const store = await loadRemoteStore(api)
    store.setState({
      staff,
      pods: [{ id: 71, name: "POD-09", region: "南京", doorStatus: "CLOSED" }],
    })

    await store.getState().bindDevice(3)
    expect(api.bindDevice).toHaveBeenCalledWith(7, 3)
    expect(store.getState().bindings).toHaveLength(1)

    await store.getState().unbindDevice(61)
    expect(api.unbindDevice).toHaveBeenCalledWith(61)
    expect(store.getState().bindings[0].unboundAt).toBeDefined()

    await store.getState().updatePod(71, "OPEN", 3)
    expect(api.updatePod).toHaveBeenCalledWith(71, "OPEN", 3)
    expect(store.getState().pods[0].doorStatus).toBe("OPEN")
  })
})
