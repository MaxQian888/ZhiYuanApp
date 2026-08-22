import type { ReactNode } from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { UavDetailView } from "@/components/product/views/fleet-view"
import { api } from "@/lib/api/client"
import { useProductStore } from "@/stores/product-store"

// The readiness query only runs against a real platform, and the store branches on the same
// flag at module scope. Mocking the module keeps one React instance in play.
jest.mock("@/lib/env", () => ({ ...jest.requireActual("@/lib/env"), isRemoteApi: true }))

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}))

jest.mock("@/lib/api/client", () => ({
  api: {
    readiness: jest.fn(),
    flightLogs: jest.fn(() => Promise.resolve([])),
    command: jest.fn(() => Promise.resolve({ commandId: "cmd-1", status: "QUEUED" })),
  },
  resumeSessionRecovery: jest.fn(),
  suppressSessionRecovery: jest.fn(),
}))

const mockedApi = api as unknown as Record<string, jest.Mock>

const uav = {
  id: 1,
  code: "UAV-01",
  name: "巡检一号",
  rfidTag: "RFID-0001",
  model: "DJI Mavic 3",
  ownerName: "陈屿",
  status: "FLYING" as const,
  battery: 78,
  inHibernatePod: false,
  region: "南京",
  altitude: 30,
  speed: 5.2,
  latitude: 32.06,
  longitude: 118.78,
  updatedAt: "2026-08-22T10:00:00+08:00",
}

function renderDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  )
  return { ...render(<UavDetailView />, { wrapper }), queryClient }
}

beforeEach(() => {
  window.history.replaceState({}, "", "/uavs/detail?id=1")
  useProductStore.setState({
    locale: "zh-CN",
    authenticated: true,
    uavs: [uav],
    commands: [],
    flightLogs: [],
  })
  mockedApi.readiness.mockReset()
  mockedApi.readiness.mockResolvedValue({
    uavCode: "UAV-01",
    commandable: true,
    readiness: "COMMANDABLE",
    reason: "Ready",
  })
})

describe("UavDetailView readiness gate", () => {
  it("leaves the controls live while the platform would accept a command", async () => {
    renderDetail()

    await waitFor(() => expect(mockedApi.readiness).toHaveBeenCalledWith(1))
    expect(screen.getByRole("button", { name: /起飞/ })).toBeEnabled()
    expect(screen.getByRole("button", { name: /停止任务/ })).toBeEnabled()
  })

  it("disables every control and says why when telemetry has gone stale", async () => {
    // A greyed-out button that explains nothing invites the operator to keep clicking it.
    mockedApi.readiness.mockResolvedValue({
      uavCode: "UAV-01",
      commandable: false,
      readiness: "STALE_TELEMETRY",
      reason: "遥测数据过期，无法下发指令",
    })

    renderDetail()

    expect(await screen.findByText("遥测数据过期，无法下发指令")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /起飞/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /降落/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /返航/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /停止任务/ })).toBeDisabled()
  })

  it("keeps the controls usable when the readiness check itself fails", async () => {
    // Losing the ability to land a drone because a status endpoint is down is a worse
    // outcome than offering a button the server may still refuse.
    mockedApi.readiness.mockRejectedValue(new Error("readiness unavailable"))

    renderDetail()

    await waitFor(() => expect(mockedApi.readiness).toHaveBeenCalled())
    expect(screen.getByRole("button", { name: /返航/ })).toBeEnabled()
  })

  it("withdraws confirmation from an open dialog when the device drops offline", async () => {
    // The dialog can outlive the readiness that opened it: an operator picks a command while
    // the device is fine, then it goes offline before they press confirm. Sending anyway
    // would put a stale instruction on a link the platform already knows is dead.
    const user = userEvent.setup()
    const { queryClient } = renderDetail()

    await waitFor(() => expect(mockedApi.readiness).toHaveBeenCalled())
    await user.click(screen.getByRole("button", { name: /返航/ }))
    const confirm = await screen.findByRole("button", { name: "确认" })
    expect(confirm).toBeEnabled()

    mockedApi.readiness.mockResolvedValue({
      uavCode: "UAV-01",
      commandable: false,
      readiness: "OFFLINE",
      reason: "设备离线",
      online: false,
    })
    await queryClient.invalidateQueries({ queryKey: ["readiness", 1] })

    await waitFor(() => expect(screen.getByRole("button", { name: "确认" })).toBeDisabled())
    expect(await screen.findAllByText("设备离线")).not.toHaveLength(0)
    expect(mockedApi.command).not.toHaveBeenCalled()
  })
})
