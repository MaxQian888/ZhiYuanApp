import type { ReactNode } from "react"
import { render, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RemoteDataBridge } from "@/components/product/remote-data-bridge"
import { api, streamTelemetry } from "@/lib/api/client"
import { useProductStore } from "@/stores/product-store"

// The bridge and the store both branch on this flag at module scope. Mocking the
// module keeps a single React instance in play — `jest.resetModules()` would give
// the component a second copy and every hook call would fail.
jest.mock("@/lib/env", () => ({ ...jest.requireActual("@/lib/env"), isRemoteApi: true }))

jest.mock("@/lib/api/client", () => ({
  api: {
    me: jest.fn(),
    allUavs: jest.fn(),
    alerts: jest.fn(),
    pods: jest.fn(),
    bindings: jest.fn(),
    allUsers: jest.fn(),
    allGoods: jest.fn(),
    allOrders: jest.fn(),
    allTasks: jest.fn(),
    commands: jest.fn(),
  },
  isSessionRecoverySuppressed: () => false,
  streamTelemetry: jest.fn(),
}))

const staff = {
  id: 1,
  username: "admin",
  displayName: "陈屿",
  role: "admin" as const,
  phone: "13900000001",
}

const uavRow = {
  id: 1,
  code: "UAV-01",
  name: "巡检一号",
  rfidTag: "RFID-0001",
  model: "DJI Mavic 3",
  ownerName: "陈屿",
  status: "ONLINE" as const,
  battery: 78,
  inHibernatePod: true,
  region: "南京",
  altitude: 30,
  speed: 5.2,
  latitude: 32.06,
  longitude: 118.78,
  updatedAt: "2026-08-22T10:00:00+08:00",
}

type StreamHandlers = {
  onEvent: (event: { event: string; data: unknown }) => void
  onState: (state: "live" | "reconnecting" | "offline") => void
}

const mockedApi = api as unknown as Record<string, jest.Mock>
const mockedStream = streamTelemetry as unknown as jest.Mock

const emptyState = {
  authenticated: false,
  staff: null,
  realtimeState: "offline" as const,
  dataSyncPending: true,
  dataSyncErrors: [],
  uavs: [],
  alerts: [],
  auditLogs: [],
  flightLogs: [],
  commands: [],
  users: [],
  goods: [],
  orders: [],
  tasks: [],
  pods: [],
  bindings: [],
}

function scriptApi(failing: string[] = []) {
  const resource = (key: string, value: unknown) =>
    failing.includes(key) ? Promise.reject(new Error(`${key} down`)) : Promise.resolve(value)

  mockedApi.me.mockResolvedValue(staff)
  mockedApi.allUavs.mockImplementation(() => resource("uavs", [uavRow]))
  mockedApi.alerts.mockImplementation(() => resource("alerts", []))
  mockedApi.pods.mockImplementation(() => resource("pods", []))
  mockedApi.bindings.mockImplementation(() => resource("bindings", []))
  mockedApi.allUsers.mockImplementation(() => resource("users", []))
  mockedApi.allGoods.mockImplementation(() => resource("goods", []))
  mockedApi.allOrders.mockImplementation(() => resource("orders", []))
  mockedApi.allTasks.mockImplementation(() => resource("tasks", []))
  mockedApi.commands.mockImplementation(() => resource("commands", []))
}

let handlers: StreamHandlers | undefined

function mount() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(<RemoteDataBridge />, { wrapper })
}

/** Resolves once the bridge has handed its callbacks to the stream. */
async function stream() {
  await waitFor(() => expect(handlers).toBeDefined())
  return handlers!
}

beforeEach(() => {
  handlers = undefined
  useProductStore.setState(emptyState)
  mockedStream.mockImplementation(
    (
      onEvent: StreamHandlers["onEvent"],
      onState: StreamHandlers["onState"],
      signal: AbortSignal
    ) => {
      handlers = { onEvent, onState }
      return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()))
    }
  )
  scriptApi()
})

describe("RemoteDataBridge", () => {
  it("recovers a session, then loads every resource into the store", async () => {
    mount()

    await waitFor(() => expect(useProductStore.getState().authenticated).toBe(true))
    expect(useProductStore.getState().staff).toMatchObject({ username: "admin" })

    await waitFor(() => expect(useProductStore.getState().dataSyncPending).toBe(false))
    expect(useProductStore.getState().uavs).toHaveLength(1)
    expect(mockedApi.allUavs).toHaveBeenCalled()
    expect(useProductStore.getState().dataSyncErrors).toEqual([])
  })

  it("names the resources that failed instead of hiding them behind a spinner", async () => {
    scriptApi(["goods", "orders"])
    mount()

    await waitFor(() => expect(useProductStore.getState().dataSyncPending).toBe(false))
    expect([...useProductStore.getState().dataSyncErrors].sort()).toEqual(["goods", "orders"])
  })

  it("skips session recovery when a session is already established", async () => {
    useProductStore.setState({ authenticated: true, staff })
    mount()

    await waitFor(() => expect(useProductStore.getState().dataSyncPending).toBe(false))
    expect(mockedApi.me).not.toHaveBeenCalled()
  })

  it("applies telemetry, alert and task frames from the stream", async () => {
    mount()
    const { onEvent } = await stream()

    onEvent({ event: "telemetry", data: [{ ...uavRow, battery: 41 }] })
    expect(useProductStore.getState().uavs[0].battery).toBe(41)

    onEvent({
      event: "alert",
      data: [
        {
          id: 9,
          uavId: 1,
          title: "电量低",
          level: "HIGH",
          occurredAt: "2026-08-22T10:00:00+08:00",
          resolved: false,
          status: "OPEN",
        },
      ],
    })
    expect(useProductStore.getState().alerts).toHaveLength(1)

    onEvent({ event: "task-status", data: [{ id: 3, orderId: 4, uavId: 1, taskStatus: "FLYING" }] })
    expect(useProductStore.getState().tasks[0].taskStatus).toBe("FLYING")
  })

  it("mirrors a command-status frame onto the matching audit row", async () => {
    mount()
    const { onEvent } = await stream()

    useProductStore.setState({
      auditLogs: [
        {
          id: "C-cmd-1",
          category: "CONTROL",
          uavId: 1,
          title: "RETURN_HOME",
          detail: "SENT",
          status: "SENT",
          source: "MANUAL",
          occurredAt: "2026-08-22T10:00:00+08:00",
        },
        {
          id: "C-other",
          category: "CONTROL",
          uavId: 2,
          title: "LAND",
          detail: "SENT",
          status: "SENT",
          source: "MANUAL",
          occurredAt: "2026-08-22T10:00:00+08:00",
        },
      ],
    })

    onEvent({
      event: "command-status",
      data: [
        {
          id: "cmd-1",
          uavId: 1,
          type: "RETURN_HOME",
          status: "ACKNOWLEDGED",
          source: "MANUAL",
          createdAt: "2026-08-22T10:00:00+08:00",
        },
      ],
    })

    expect(useProductStore.getState().commands).toHaveLength(1)
    expect(useProductStore.getState().auditLogs[0].status).toBe("ACKNOWLEDGED")
    expect(useProductStore.getState().auditLogs[1].status).toBe("SENT")
  })

  it("merges a telemetry delta by device id instead of replacing the fleet", async () => {
    mount()
    const { onEvent } = await stream()

    const second = { ...uavRow, id: 2, code: "UAV-02", battery: 55 }
    onEvent({ event: "telemetry", data: [uavRow, second] })
    expect(useProductStore.getState().uavs).toHaveLength(2)

    // Only UAV-02 moved. UAV-01 must survive.
    onEvent({ event: "telemetry-delta", data: [{ ...second, battery: 41 }] })

    const fleet = useProductStore.getState().uavs
    expect(fleet).toHaveLength(2)
    expect(fleet.find((uav) => uav.id === 1)?.battery).toBe(78)
    expect(fleet.find((uav) => uav.id === 2)?.battery).toBe(41)
  })

  it("a delta for an unseen device adds it, keeping the fleet ordered by id", async () => {
    mount()
    const { onEvent } = await stream()

    onEvent({ event: "telemetry", data: [{ ...uavRow, id: 3, code: "UAV-03" }] })
    onEvent({ event: "telemetry-delta", data: [uavRow] })

    expect(useProductStore.getState().uavs.map((uav) => uav.id)).toEqual([1, 3])
  })

  it("ignores a telemetry delta that fails schema validation", async () => {
    mount()
    const { onEvent } = await stream()

    onEvent({ event: "telemetry", data: [uavRow] })
    onEvent({ event: "telemetry-delta", data: [{ id: 1, battery: 999 }] })

    expect(useProductStore.getState().uavs[0].battery).toBe(78)
  })

  it("ignores unknown event names and frames that fail schema validation", async () => {
    mount()
    const { onEvent } = await stream()

    const before = useProductStore.getState().uavs
    onEvent({ event: "something-else", data: [uavRow] })
    onEvent({ event: "telemetry", data: [{ id: 1, battery: 999 }] })
    expect(useProductStore.getState().uavs).toBe(before)
  })

  it("publishes the stream connection state", async () => {
    mount()
    const { onState } = await stream()

    onState("live")
    expect(useProductStore.getState().realtimeState).toBe("live")
    onState("reconnecting")
    expect(useProductStore.getState().realtimeState).toBe("reconnecting")
  })

  it("aborts the stream when the bridge unmounts", async () => {
    const view = mount()
    await stream()

    const signal = mockedStream.mock.calls[0][2] as AbortSignal
    view.unmount()
    expect(signal.aborted).toBe(true)
  })
})
