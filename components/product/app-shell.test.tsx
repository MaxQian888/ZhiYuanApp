import type { ReactNode } from "react"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppShell } from "@/components/product/app-shell"
import { toast } from "sonner"
import { useProductStore } from "@/stores/product-store"
import { seedGoods, seedOrders, seedUavs, seedUsers } from "@/lib/mock-data"

const push = jest.fn()
let pathname = "/"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: jest.fn(), prefetch: jest.fn(), back: jest.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock("sonner", () => ({
  toast: { info: jest.fn(), error: jest.fn(), success: jest.fn() },
}))

jest.mock("@/lib/tauri", () => ({
  isTauri: jest.fn(() => false),
  listenForSecondInstance: jest.fn(() => Promise.resolve(() => {})),
  extractSingleInstanceRoute: jest.requireActual("@/lib/tauri").extractSingleInstanceRoute,
}))

function renderShell(children: ReactNode = <p>内容</p>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // app/layout.tsx mounts TooltipProvider globally; the desktop titlebar relies on it.
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppShell>{children}</AppShell>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  pathname = "/"
  useProductStore.setState({
    locale: "zh-CN",
    realtimeState: "live",
    dataSyncPending: false,
    dataSyncErrors: [],
    uavs: seedUavs,
    users: seedUsers,
    orders: seedOrders,
    goods: seedGoods,
  })
})

describe("AppShell chrome", () => {
  it("renders the brand, the children and both navigations", () => {
    renderShell()
    expect(screen.getByText("内容")).toBeInTheDocument()
    expect(screen.getByLabelText("智鸢 运营控制台")).toBeInTheDocument()
    expect(screen.getByLabelText("主导航")).toBeInTheDocument()
    expect(screen.getByLabelText("移动导航")).toBeInTheDocument()
  })

  it("marks the active route in the sidebar without matching the root on every page", () => {
    pathname = "/uavs/detail"
    renderShell()
    const sidebar = screen.getByLabelText("主导航")
    expect(within(sidebar).getByRole("link", { name: /设备/ })).toHaveClass("is-active")
    expect(within(sidebar).getByRole("link", { name: /首页/ })).not.toHaveClass("is-active")
  })

  it("shows the route context for the active page", () => {
    pathname = "/orders"
    renderShell()
    expect(screen.getByText("OPS / 订单")).toBeInTheDocument()
  })

  it("names the map route even though it has no sidebar entry", () => {
    pathname = "/map"
    renderShell()
    expect(screen.getByText("OPS / 地图定位")).toBeInTheDocument()
  })

  it("toggles the interface language", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("button", { name: "Switch language" }))
    expect(useProductStore.getState().locale).toBe("en")
    expect(screen.getByLabelText("Primary navigation")).toBeInTheDocument()
  })

  it.each([
    ["live", "实时"],
    ["reconnecting", "重连中"],
    ["offline", "离线"],
  ] as const)("reports the %s connection state", (state, label) => {
    useProductStore.setState({ realtimeState: state })
    renderShell()
    expect(screen.getByText(new RegExp(label))).toBeInTheDocument()
  })

  it("hides the sync strip in simulator mode even while data is pending", () => {
    useProductStore.setState({ dataSyncPending: true, dataSyncErrors: ["goods"] })
    renderShell()
    expect(screen.queryByText("部分运营数据同步失败")).toBeNull()
  })
})

describe("AppShell command palette", () => {
  it("opens on ⌘K, closes on a second press", async () => {
    const user = userEvent.setup()
    renderShell()

    await user.keyboard("{Meta>}k{/Meta}")
    expect(await screen.findByRole("dialog")).toBeInTheDocument()

    await user.keyboard("{Meta>}k{/Meta}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("opens from the search button and navigates to the chosen page", async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole("button", { name: "搜索设备、用户、订单或页面" }))
    const dialog = await screen.findByRole("dialog")

    await user.click(within(dialog).getByRole("option", { name: /告警/ }))
    expect(push).toHaveBeenCalledWith("/alerts")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("offers seeded business records alongside pages in simulator mode", async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole("button", { name: "搜索设备、用户、订单或页面" }))
    const dialog = await screen.findByRole("dialog")

    await user.type(within(dialog).getByRole("combobox"), "UAV-02")
    const option = await within(dialog).findByRole("option", { name: /UAV-02/ })
    await user.click(option)
    expect(push).toHaveBeenCalledWith("/uavs/detail?id=2")
  })

  it("reports when nothing matches", async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole("button", { name: "搜索设备、用户、订单或页面" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByRole("combobox"), "zzzz-no-such-record")
    expect(await within(dialog).findByText("没有符合条件的记录")).toBeInTheDocument()
  })
})

describe("AppShell desktop integration", () => {
  it("adds the desktop frame and titlebar when running inside Tauri", async () => {
    const tauri = jest.requireMock("@/lib/tauri")
    tauri.isTauri.mockReturnValue(true)
    const { container } = renderShell()

    expect(container.querySelector(".app-frame")).toHaveClass("is-desktop")
    await waitFor(() => expect(tauri.listenForSecondInstance).toHaveBeenCalled())
    tauri.isTauri.mockReturnValue(false)
  })

  it("routes a second-instance launch request to its target page", async () => {
    const tauri = jest.requireMock("@/lib/tauri")
    tauri.isTauri.mockReturnValue(true)
    let deliver: ((payload: { args: string[] }) => void) | undefined
    tauri.listenForSecondInstance.mockImplementation((handler: (p: { args: string[] }) => void) => {
      deliver = handler
      return Promise.resolve(() => {})
    })

    renderShell()
    await waitFor(() => expect(deliver).toBeDefined())
    deliver!({ args: ["zhiyuan.exe", "--route=/tasks"] })

    await waitFor(() => expect(push).toHaveBeenCalledWith("/tasks"))
    expect(toast.info).toHaveBeenCalledWith("已接收新的启动请求并打开目标页面")
    tauri.isTauri.mockReturnValue(false)
    tauri.listenForSecondInstance.mockImplementation(() => Promise.resolve(() => {}))
  })

  it("surfaces a listener failure instead of failing silently", async () => {
    const tauri = jest.requireMock("@/lib/tauri")
    tauri.isTauri.mockReturnValue(true)
    tauri.listenForSecondInstance.mockRejectedValueOnce(new Error("ipc closed"))

    renderShell()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("单实例事件监听失败：ipc closed"))
    tauri.isTauri.mockReturnValue(false)
  })
})
