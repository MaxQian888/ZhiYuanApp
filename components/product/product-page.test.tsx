import type { ReactNode } from "react"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { toast } from "sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ProductPage, type ProductView } from "@/components/product/product-page"
import { useProductStore } from "@/stores/product-store"
import * as tauri from "@/lib/tauri"
import { api } from "@/lib/api/client"

const push = jest.fn()
const replace = jest.fn()

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, prefetch: jest.fn(), back: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}))

// The page relies on toasts for every action outcome, but mounts no Toaster of its
// own — ProductProviders does that. Asserting on the API keeps the two decoupled.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}))

jest.mock("@/lib/tauri", () => ({
  isTauri: jest.fn(() => false),
  listenForSecondInstance: jest.fn(() => Promise.resolve(() => {})),
  extractSingleInstanceRoute: jest.fn(() => null),
  getPlatformInfo: jest.fn(() => Promise.resolve(null)),
  checkForAppUpdate: jest.fn(() => Promise.resolve({ available: false })),
  installAppUpdate: jest.fn(() => Promise.resolve({ ok: true })),
  moveAppWindow: jest.fn(() => Promise.resolve()),
  saveAppWindowState: jest.fn(() => Promise.resolve()),
  restoreAppWindowState: jest.fn(() => Promise.resolve()),
}))

jest.mock("@/lib/api/client", () => ({
  api: {
    version: jest.fn(),
    sessions: jest.fn(() => Promise.resolve([])),
    revokeSession: jest.fn(() => Promise.resolve(null)),
    changePassword: jest.fn(() => Promise.resolve(null)),
    forgetAuthentication: jest.fn(() => Promise.resolve()),
    logout: jest.fn(() => Promise.resolve()),
    login: jest.fn(),
    staffAccounts: jest.fn(() => Promise.resolve([])),
    createStaffAccount: jest.fn(),
    updateStaffAccount: jest.fn(),
    disableStaffAccount: jest.fn(),
    uavs: jest.fn(),
    goods: jest.fn(),
    auditLogs: jest.fn(),
    flightLogs: jest.fn(() => Promise.resolve([])),
  },
  resumeSessionRecovery: jest.fn(),
  suppressSessionRecovery: jest.fn(),
  // The real class: the login view narrows on it with `instanceof`, so a mock that leaves it
  // out turns a wrong password into a TypeError inside the catch block.
  ApiError: jest.requireActual("@/lib/api/client").ApiError,
}))

const mockedTauri = tauri as jest.Mocked<typeof tauri>
const mockedApi = api as unknown as Record<string, jest.Mock>

function renderView(view: ProductView) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  )
  return render(<ProductPage view={view} />, { wrapper })
}

/** Restores the simulator seed so each test starts from the same fleet. */
async function resetStore(url = "/") {
  const {
    demoStaff,
    seedAlerts,
    seedAuditLogs,
    seedBindings,
    seedCommands,
    seedFlightLogs,
    seedGoods,
    seedOrders,
    seedPods,
    seedTasks,
    seedUavs,
    seedUsers,
  } = await import("@/lib/mock-data")
  useProductStore.setState({
    locale: "zh-CN",
    staff: demoStaff,
    authenticated: true,
    realtimeState: "live",
    dataSyncPending: false,
    dataSyncErrors: [],
    selectedUavId: 1,
    uavs: seedUavs,
    alerts: seedAlerts,
    auditLogs: seedAuditLogs,
    flightLogs: seedFlightLogs,
    commands: seedCommands,
    users: seedUsers,
    goods: seedGoods,
    orders: seedOrders,
    tasks: seedTasks,
    pods: seedPods,
    bindings: seedBindings,
  })
  window.history.replaceState({}, "", url)
}

beforeEach(async () => {
  await resetStore()
  mockedTauri.isTauri.mockReturnValue(false)
})

describe("ProductPage routing", () => {
  it("renders the login view for the login route", () => {
    renderView("login")
    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument()
  })

  it("falls back to login for any view when the operator is not signed in", () => {
    useProductStore.setState({ authenticated: false })
    renderView("orders")
    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument()
  })

  it("stamps the view on the main region and reports the data mode in the footer", () => {
    renderView("dashboard")
    expect(screen.getByRole("main")).toHaveAttribute("data-view", "dashboard")
    expect(screen.getByText(/SIMULATOR/)).toBeInTheDocument()
  })
})

describe("LoginView", () => {
  it("prefills the demo credentials in simulator mode", () => {
    renderView("login")
    expect(screen.getByLabelText("账号")).toHaveValue("admin")
    expect(screen.getByLabelText("密码")).toHaveValue("admin123")
    expect(screen.getByText("演示账号：admin / admin123")).toBeInTheDocument()
  })

  it("rejects the wrong password with an inline error and stays signed out", async () => {
    const user = userEvent.setup()
    useProductStore.setState({ authenticated: false })
    renderView("login")

    const password = screen.getByLabelText("密码")
    await user.clear(password)
    await user.type(password, "wrong-password")
    await user.click(screen.getByRole("button", { name: "登录" }))

    expect(await screen.findByText("账号或密码错误")).toBeInTheDocument()
    expect(useProductStore.getState().authenticated).toBe(false)
  })

  it("signs in with the demo credentials", async () => {
    const user = userEvent.setup()
    useProductStore.setState({ authenticated: false })
    renderView("login")

    await user.click(screen.getByRole("button", { name: "登录" }))
    await waitFor(() => expect(useProductStore.getState().authenticated).toBe(true))
  })

  it("switches the login page language", async () => {
    const user = userEvent.setup()
    renderView("login")
    await user.click(screen.getByRole("button", { name: "EN" }))
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument()
  })

  it("adds the desktop chrome when running inside Tauri", () => {
    mockedTauri.isTauri.mockReturnValue(true)
    const { container } = renderView("login")
    expect(container.querySelector(".login-window")).toHaveClass("is-desktop")
  })
})

describe("DashboardView", () => {
  it("summarises the fleet, alerts and active tasks", () => {
    renderView("dashboard")
    expect(screen.getByRole("heading", { name: "智鸢运行总览" })).toBeInTheDocument()
    expect(screen.getByText("无人机总数")).toBeInTheDocument()
    expect(screen.getByText("在线无人机")).toBeInTheDocument()
    expect(screen.getByText("未处理告警")).toBeInTheDocument()
    expect(screen.getByText("活动任务")).toBeInTheDocument()
  })

  it("lists at most five telemetry rows even with a larger fleet", () => {
    const { container } = renderView("dashboard")
    expect(container.querySelectorAll(".telemetry-row").length).toBeLessThanOrEqual(5)
  })

  it("acknowledges an open alert straight from the dashboard", async () => {
    const user = userEvent.setup()
    renderView("dashboard")

    const [firstAcknowledge] = screen.getAllByRole("button", { name: "确认处理" })
    await user.click(firstAcknowledge)

    await waitFor(() =>
      expect(
        useProductStore.getState().alerts.some((alert) => alert.status === "ACKNOWLEDGED")
      ).toBe(true)
    )
    expect(toast.success).toHaveBeenCalledWith("确认处理")
  })

  it("resolves an already acknowledged alert", async () => {
    const user = userEvent.setup()
    useProductStore.setState((state) => ({
      alerts: state.alerts.map((alert, index) =>
        index === 0 ? { ...alert, status: "ACKNOWLEDGED" as const } : alert
      ),
    }))
    renderView("dashboard")

    await user.click(screen.getAllByRole("button", { name: "解除" })[0])
    await waitFor(() =>
      expect(useProductStore.getState().alerts.some((alert) => alert.resolved)).toBe(true)
    )
  })

  it("renders an empty dashboard without crashing when the fleet is empty", () => {
    useProductStore.setState({ uavs: [], alerts: [], tasks: [], pods: [] })
    renderView("dashboard")
    expect(screen.getByRole("heading", { name: "智鸢运行总览" })).toBeInTheDocument()
    expect(screen.getByText("—")).toBeInTheDocument()
  })
})

describe("UavListView", () => {
  it("lists the fleet with its status, owner and battery", () => {
    renderView("uavs")
    expect(screen.getByText("UAV-01")).toBeInTheDocument()
    expect(screen.getByText(/设备 · 6/)).toBeInTheDocument()
  })

  it("filters by free text", async () => {
    const user = userEvent.setup()
    renderView("uavs")

    await user.type(screen.getByPlaceholderText("搜索名称 / RFID / 型号"), "UAV-02")
    expect(await screen.findByText(/设备 · 1/)).toBeInTheDocument()
    expect(screen.queryByText("UAV-01")).toBeNull()
  })

  it("filters by status and by region", async () => {
    const user = userEvent.setup()
    renderView("uavs")

    await user.selectOptions(screen.getByLabelText("状态"), "FLYING")
    expect(await screen.findByText(/设备 · 1/)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText("状态"), "ALL")
    await user.selectOptions(screen.getByLabelText("区域"), "南京")
    expect(await screen.findByText(/设备 · 2/)).toBeInTheDocument()
  })

  it("shows the empty state when nothing matches", async () => {
    const user = userEvent.setup()
    renderView("uavs")

    await user.type(screen.getByPlaceholderText("搜索名称 / RFID / 型号"), "no-such-device")
    expect(await screen.findByText("没有符合条件的记录")).toBeInTheDocument()
  })

  it("pages the fleet once it exceeds one page", async () => {
    const user = userEvent.setup()
    const { seedUavs } = await import("@/lib/mock-data")
    useProductStore.setState({
      uavs: Array.from({ length: 24 }, (_, index) => ({
        ...seedUavs[index % seedUavs.length],
        id: index + 1,
        code: `UAV-${String(index + 1).padStart(2, "0")}`,
        rfidTag: `RFID-${index}`,
      })),
    })
    renderView("uavs")

    expect(screen.getByText("1 / 3")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /下一页/ }))
    expect(await screen.findByText("2 / 3")).toBeInTheDocument()
  })
})

describe("UavDetailView", () => {
  it("opens the device named by the URL", async () => {
    await resetStore("/uavs/detail?id=3")
    renderView("uav-detail")
    expect(screen.getByRole("heading", { name: /UAV-03/ })).toBeInTheDocument()
  })

  it("falls back to the selected device when the URL carries no id", () => {
    renderView("uav-detail")
    expect(screen.getByRole("heading", { name: /UAV-01/ })).toBeInTheDocument()
  })

  it("confirms a control command before sending it", async () => {
    const user = userEvent.setup()
    renderView("uav-detail")

    await user.click(screen.getByRole("button", { name: /返航/ }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("确认下发指令")).toBeInTheDocument()
    expect(within(dialog).getByText("RETURN_HOME")).toBeInTheDocument()

    const before = useProductStore.getState().commands.length
    await user.click(within(dialog).getByRole("button", { name: "确认" }))

    await waitFor(() => expect(useProductStore.getState().commands.length).toBe(before + 1))
    expect(toast.success).toHaveBeenCalledWith("指令已进入队列")
  })

  it("dismisses the confirmation without sending anything", async () => {
    const user = userEvent.setup()
    renderView("uav-detail")

    await user.click(screen.getByRole("button", { name: /起飞/ }))
    const dialog = await screen.findByRole("dialog")
    const before = useProductStore.getState().commands.length

    await user.click(within(dialog).getByRole("button", { name: "取消" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(useProductStore.getState().commands.length).toBe(before)
  })

  it("offers every quick control", async () => {
    renderView("uav-detail")
    for (const label of [/起飞/, /降落/, /返航/, /停止任务/]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
    }
  })
})

describe("MapView", () => {
  it("plots the selected device and its track", () => {
    renderView("map")
    expect(screen.getByRole("heading", { name: "地图定位" })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "地图定位: UAV-01" })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "UAV-01 飞行轨迹" })).toBeInTheDocument()
    expect(screen.getByText("当前位置")).toBeInTheDocument()
  })

  it("switches the plotted device", async () => {
    const user = userEvent.setup()
    renderView("map")

    const select = screen.getByRole("combobox")
    await user.selectOptions(select, "2")
    expect(select).toHaveValue("2")
  })

  it("zooms in and out", async () => {
    const user = userEvent.setup()
    renderView("map")

    await user.click(screen.getByRole("button", { name: "放大" }))
    await user.click(screen.getByRole("button", { name: "缩小" }))
    expect(screen.getByRole("img", { name: "地图定位: UAV-01" })).toBeInTheDocument()
  })

  it("recenters on the device", async () => {
    const user = userEvent.setup()
    renderView("map")
    await user.click(screen.getByRole("button", { name: "定位设备" }))
    expect(screen.getByRole("img", { name: "地图定位: UAV-01" })).toBeInTheDocument()
  })

  it("says so when the device has no recorded track", async () => {
    useProductStore.setState({ flightLogs: [] })
    renderView("map")
    expect(screen.getByText("暂无轨迹数据，仅显示当前位置")).toBeInTheDocument()
  })
})

describe("VoiceView", () => {
  it("reports that the browser cannot listen and refuses to record", async () => {
    const user = userEvent.setup()
    renderView("voice")

    expect(screen.getByRole("heading", { name: "语音控制" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "开始语音输入" }))
    // The hint under the microphone and the field error both carry this sentence.
    expect(await screen.findAllByText("当前环境不支持语音识别，请使用文本输入。")).toHaveLength(2)
  })

  it("parses a text command, then sends it only after confirmation", async () => {
    const user = userEvent.setup()
    renderView("voice")

    await user.type(screen.getByLabelText("文本指令"), "无人机一号返航")
    await user.click(screen.getByRole("button", { name: "解析指令" }))

    expect(await screen.findByText("RETURN_HOME")).toBeInTheDocument()
    const before = useProductStore.getState().commands.length

    await user.click(screen.getByRole("button", { name: "确认" }))
    await waitFor(() => expect(useProductStore.getState().commands.length).toBe(before + 1))
    expect(useProductStore.getState().commands[0].source).toBe("VOICE")
  })

  it("refuses to guess when the transcript names no device or action", async () => {
    const user = userEvent.setup()
    renderView("voice")

    await user.type(screen.getByLabelText("文本指令"), "今天天气不错")
    await user.click(screen.getByRole("button", { name: "解析指令" }))

    expect(await screen.findByText("未识别到明确的设备和动作。")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "确认" })).toBeNull()
  })

  it("drives the browser recogniser when one is available", async () => {
    const user = userEvent.setup()
    const start = jest.fn()
    class FakeRecognition {
      lang = ""
      onresult: ((event: { results: { 0: { transcript: string } }[] }) => void) | null = null
      onerror: (() => void) | null = null
      onend: (() => void) | null = null
      start = start.mockImplementation(() => {
        this.onresult?.({ results: [{ 0: { transcript: "无人机二号降落" } }] } as never)
        this.onend?.()
      })
      stop = jest.fn()
      abort = jest.fn()
    }
    ;(window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition

    renderView("voice")
    await user.click(screen.getByRole("button", { name: "开始语音输入" }))

    expect(start).toHaveBeenCalled()
    expect(await screen.findByText("LAND")).toBeInTheDocument()
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition
  })
})

describe("OperationsView · alerts", () => {
  it("lists alerts and filters them by level", async () => {
    const user = userEvent.setup()
    renderView("alerts")

    expect(screen.getByRole("heading", { name: "告警" })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText("告警等级"), "HIGH")
    expect(await screen.findByText(/电量低于 45%/)).toBeInTheDocument()
  })

  it("walks an alert from open through acknowledged to resolved", async () => {
    const user = userEvent.setup()
    renderView("alerts")

    await user.click(screen.getAllByRole("button", { name: "确认处理" })[0])
    await waitFor(() =>
      expect(
        useProductStore.getState().alerts.some((alert) => alert.status === "ACKNOWLEDGED")
      ).toBe(true)
    )

    await user.click(await screen.findByRole("button", { name: "解除" }))
    await waitFor(() =>
      expect(useProductStore.getState().alerts.some((alert) => alert.resolved)).toBe(true)
    )
  })
})

describe("OperationsView · logs", () => {
  it("lists audit records and filters by type and free text", async () => {
    const user = userEvent.setup()
    renderView("logs")

    expect(screen.getByRole("heading", { name: "日志", level: 1 })).toBeInTheDocument()
    const typeFilter = screen.getByRole("tablist", { name: "日志类型" })
    await user.click(within(typeFilter).getByRole("tab", { name: "语音" }))
    await waitFor(() => expect(screen.queryByText("遥测同步")).toBeNull())

    await user.click(within(typeFilter).getByRole("tab", { name: "全部" }))
    await user.type(screen.getByPlaceholderText("搜索事件、详情或操作人"), "遥测")
    expect(await screen.findByText("遥测同步")).toBeInTheDocument()
  })

  it("shows the empty state when the filters exclude everything", async () => {
    const user = userEvent.setup()
    renderView("logs")
    await user.type(screen.getByPlaceholderText("搜索事件、详情或操作人"), "zzz-nothing")
    expect(await screen.findByText("暂无匹配日志")).toBeInTheDocument()
  })
})

describe("OperationsView · pods", () => {
  it("lists pods and saves a door change", async () => {
    const user = userEvent.setup()
    renderView("pods")

    expect(screen.getByRole("heading", { name: "休眠仓", level: 1 })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText("POD-01 舱门状态"), "OPEN")

    await waitFor(() => expect(useProductStore.getState().pods[0].doorStatus).toBe("OPEN"))
    expect(toast.success).toHaveBeenCalledWith("保存")
  })
})

describe("UsersView", () => {
  it("lists customers and adds one", async () => {
    const user = userEvent.setup()
    renderView("users")

    const before = useProductStore.getState().users.length
    await user.click(screen.getByRole("button", { name: "新增" }))
    const dialog = await screen.findByRole("dialog")

    await user.type(within(dialog).getByLabelText("用户"), "新客户")
    await user.type(within(dialog).getByLabelText("手机号"), "13800000001")
    await user.click(within(dialog).getByRole("button", { name: "保存" }))

    await waitFor(() => expect(useProductStore.getState().users.length).toBe(before + 1))
  })

  it("refuses an invalid mobile number without touching the store", async () => {
    const user = userEvent.setup()
    renderView("users")

    const before = useProductStore.getState().users.length
    await user.click(screen.getByRole("button", { name: "新增" }))
    const dialog = await screen.findByRole("dialog")

    await user.type(within(dialog).getByLabelText("用户"), "错号客户")
    await user.type(within(dialog).getByLabelText("手机号"), "12345")
    await user.click(within(dialog).getByRole("button", { name: "保存" }))

    expect(await within(dialog).findByText("请输入有效手机号")).toBeInTheDocument()
    expect(useProductStore.getState().users.length).toBe(before)
  })

  it("deletes a customer only after the confirmation", async () => {
    const user = userEvent.setup()
    renderView("users")

    const before = useProductStore.getState().users.length
    await user.click(screen.getAllByRole("button", { name: "删除" })[0])
    const confirmation = await screen.findByRole("alertdialog")
    expect(within(confirmation).getByText("确认删除用户")).toBeInTheDocument()

    await user.click(within(confirmation).getByRole("button", { name: "删除" }))
    await waitFor(() => expect(useProductStore.getState().users.length).toBe(before - 1))
  })

  it("adds an address to a customer", async () => {
    const user = userEvent.setup()
    renderView("users")

    // The address column renders "<count> · 编辑" as its trigger.
    await user.click(screen.getAllByRole("button", { name: /· 编辑$/ })[0])
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/收货地址/)).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText("收件人"), "新收件人")
    await user.type(within(dialog).getByLabelText("收件手机号"), "13800000002")
    await user.type(within(dialog).getByLabelText("详细地址"), "南京市鼓楼区")
    await user.type(within(dialog).getByLabelText("纬度"), "32.06")
    await user.type(within(dialog).getByLabelText("经度"), "118.78")
    await user.click(within(dialog).getByRole("button", { name: "新增" }))

    await waitFor(() =>
      expect(useProductStore.getState().users[0].addresses.length).toBeGreaterThan(1)
    )
    expect(useProductStore.getState().users[0].addresses.at(-1)).toMatchObject({
      receiverName: "新收件人",
      latitude: 32.06,
    })
  })

  it("keeps the address save button locked until the coordinates are valid", async () => {
    const user = userEvent.setup()
    renderView("users")

    await user.click(screen.getAllByRole("button", { name: /· 编辑$/ })[0])
    const dialog = await screen.findByRole("dialog")
    const save = within(dialog).getByRole("button", { name: "新增" })
    expect(save).toBeDisabled()

    await user.type(within(dialog).getByLabelText("详细地址"), "南京市鼓楼区")
    await user.type(within(dialog).getByLabelText("纬度"), "999")
    await user.type(within(dialog).getByLabelText("经度"), "118.78")
    expect(save).toBeDisabled()
  })

  it("flags an invalid receiver phone inline", async () => {
    const user = userEvent.setup()
    renderView("users")

    await user.click(screen.getAllByRole("button", { name: /· 编辑$/ })[0])
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("收件手机号"), "123")
    expect(await within(dialog).findByText("请输入有效手机号")).toBeInTheDocument()
  })

  it("edits an existing address through the same form", async () => {
    const user = userEvent.setup()
    renderView("users")

    await user.click(screen.getAllByRole("button", { name: /· 编辑$/ })[0])
    const dialog = await screen.findByRole("dialog")

    await user.click(within(dialog).getAllByRole("button", { name: "编辑" })[0])
    const detail = within(dialog).getByLabelText("详细地址")
    await user.clear(detail)
    await user.type(detail, "改过的详细地址")
    await user.click(within(dialog).getByRole("button", { name: "保存" }))

    await waitFor(() =>
      expect(useProductStore.getState().users[0].addresses[0].detail).toBe("改过的详细地址")
    )
  })
})

describe("GoodsView", () => {
  it("lists products and searches them", async () => {
    const user = userEvent.setup()
    renderView("goods")

    expect(screen.getByText("应急药品包")).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText("搜索商品"), "冷链")
    await waitFor(() => expect(screen.queryByText("应急药品包")).toBeNull())
  })

  it("shows available, reserved and on-hand stock as three separate numbers", async () => {
    renderView("goods")

    expect(screen.getByText("可用库存")).toBeInTheDocument()
    expect(screen.getByText("预留")).toBeInTheDocument()
    expect(screen.getByText("在手")).toBeInTheDocument()

    const product = useProductStore.getState().goods[0]
    const row = screen.getByText(product.name).closest(".table-row") as HTMLElement
    expect(within(row).getByText(String(product.stock))).toBeInTheDocument()
    expect(within(row).getByText(String(product.stock + product.reservedStock))).toBeInTheDocument()
  })

  it("filters by category", async () => {
    const user = userEvent.setup()
    renderView("goods")
    await user.selectOptions(screen.getByLabelText("分类"), "MEDICINE")
    await waitFor(() => expect(screen.queryByText("冷链餐食 A")).toBeNull())
  })

  it("creates a product from the dialog", async () => {
    const user = userEvent.setup()
    renderView("goods")

    const before = useProductStore.getState().goods.length
    await user.click(screen.getByRole("button", { name: "新增" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("价格、库存和重量必须为非负数。")).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText("商品"), "测试商品")
    await user.clear(within(dialog).getByLabelText("Price"))
    await user.type(within(dialog).getByLabelText("Price"), "12")
    await user.selectOptions(within(dialog).getByLabelText("Category"), "medicine")
    await user.click(within(dialog).getByRole("button", { name: "保存" }))

    await waitFor(() => expect(useProductStore.getState().goods.length).toBe(before + 1))
    expect(useProductStore.getState().goods.at(-1)).toMatchObject({
      name: "测试商品",
      price: 12,
      category: "medicine",
    })
  })

  it("edits an existing product in place", async () => {
    const user = userEvent.setup()
    renderView("goods")

    const before = useProductStore.getState().goods.length
    await user.click(screen.getAllByRole("button", { name: "编辑" })[0])
    const dialog = await screen.findByRole("dialog")

    const name = within(dialog).getByLabelText("商品")
    await user.clear(name)
    await user.type(name, "改过的商品")
    await user.click(within(dialog).getByRole("button", { name: "保存" }))

    await waitFor(() => expect(useProductStore.getState().goods[0].name).toBe("改过的商品"))
    expect(useProductStore.getState().goods.length).toBe(before)
  })

  it("bulk-deletes the selected products after confirmation", async () => {
    const user = userEvent.setup()
    renderView("goods")

    const before = useProductStore.getState().goods.length
    const [firstCheckbox] = screen.getAllByRole("checkbox")
    await user.click(firstCheckbox)

    await user.click(screen.getByRole("button", { name: /删除 \(1\)/ }))
    const confirmation = await screen.findByRole("alertdialog")
    await user.click(within(confirmation).getByRole("button", { name: "删除" }))

    await waitFor(() => expect(useProductStore.getState().goods.length).toBe(before - 1))
  })

  it("toggles a product between listed and delisted", async () => {
    const user = userEvent.setup()
    renderView("goods")

    const status = useProductStore.getState().goods[0].status
    await user.click(screen.getAllByRole("button", { name: status === 1 ? "下架" : "上架" })[0])
    await waitFor(() => expect(useProductStore.getState().goods[0].status).not.toBe(status))
  })
})

describe("OrdersView", () => {
  it("lists orders with their status", () => {
    renderView("orders")
    expect(screen.getByRole("heading", { name: "订单" })).toBeInTheDocument()
    expect(screen.getByText("ZY-20260812-001")).toBeInTheDocument()
  })

  it("creates an order and reduces available stock", async () => {
    const user = userEvent.setup()
    renderView("orders")

    const goodsBefore = useProductStore.getState().goods[0].stock
    const ordersBefore = useProductStore.getState().orders.length

    await user.click(screen.getByRole("button", { name: "新增" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("创建订单")).toBeInTheDocument()

    const quantity = within(dialog).getAllByRole("spinbutton")[0]
    await user.clear(quantity)
    await user.type(quantity, "1")
    await user.click(within(dialog).getByRole("button", { name: "保存" }))

    await waitFor(() => expect(useProductStore.getState().orders.length).toBe(ordersBefore + 1))
    expect(useProductStore.getState().goods[0].stock).toBe(goodsBefore - 1)
  })

  it("opens the order detail named by the URL", async () => {
    await resetStore("/orders/detail?id=2")
    renderView("order-detail")
    expect(screen.getByText("ZY-20260812-002")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "订单明细" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "订单操作" })).toBeInTheDocument()
  })

  it("renders the delivery snapshot when the order carries one", async () => {
    await resetStore("/orders/detail?id=1")
    useProductStore.setState((state) => ({
      orders: state.orders.map((order) =>
        order.id === 1
          ? {
              ...order,
              addressSnapshot: {
                receiverName: "王宁",
                receiverPhone: "13900000001",
                detail: "南京市玄武区珠江路 1 号",
              },
            }
          : order
      ),
    }))
    renderView("order-detail")
    expect(screen.getByRole("heading", { name: "配送地址快照" })).toBeInTheDocument()
    expect(screen.getByText("南京市玄武区珠江路 1 号")).toBeInTheDocument()
  })

  it("dispatches a created order onto a device", async () => {
    const user = userEvent.setup()
    await resetStore("/orders/detail?id=1")
    renderView("order-detail")

    await user.click(screen.getByRole("button", { name: "调度" }))
    await waitFor(() =>
      expect(useProductStore.getState().orders.find((order) => order.id === 1)?.status).toBe(
        "DISPATCHING"
      )
    )
  })

  it("cancels an order from its detail page", async () => {
    const user = userEvent.setup()
    await resetStore("/orders/detail?id=1")
    renderView("order-detail")

    await user.click(screen.getByRole("button", { name: "取消订单" }))
    await waitFor(() =>
      expect(useProductStore.getState().orders.find((order) => order.id === 1)?.status).toBe(
        "CANCELLED"
      )
    )
  })

  it("locks dispatch and cancel once an order is already delivering", async () => {
    await resetStore("/orders/detail?id=3")
    renderView("order-detail")
    expect(screen.getByRole("button", { name: "调度" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "取消订单" })).toBeDisabled()
  })
})

describe("TasksView", () => {
  it("lists tasks and starts a waiting one", async () => {
    const user = userEvent.setup()
    renderView("tasks")

    expect(screen.getByRole("heading", { name: "任务" })).toBeInTheDocument()
    await user.click(screen.getAllByRole("button", { name: "开始任务" })[0])

    await waitFor(() =>
      expect(useProductStore.getState().tasks.some((task) => task.taskStatus === "FLYING")).toBe(
        true
      )
    )
  })

  it("marks a flying task as arrived", async () => {
    const user = userEvent.setup()
    renderView("tasks")

    await user.click(screen.getAllByRole("button", { name: "确认到达" })[0])
    await waitFor(() =>
      expect(useProductStore.getState().tasks.some((task) => task.taskStatus === "ARRIVED")).toBe(
        true
      )
    )
  })

  it("records a failure reason when a task fails", async () => {
    const user = userEvent.setup()
    renderView("tasks")

    await user.click(screen.getAllByRole("button", { name: "标记失败" })[0])
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("失败原因"), "强风")
    await user.click(within(dialog).getByRole("button", { name: "标记失败" }))

    await waitFor(() => {
      const failed = useProductStore.getState().tasks.find((task) => task.taskStatus === "FAILED")
      expect(failed?.failureReason).toBe("强风")
    })
  })
})

describe("SettingsView", () => {
  it("shows the operator profile and saves an edit", async () => {
    const user = userEvent.setup()
    renderView("settings")

    expect(screen.getByRole("heading", { name: "账户", level: 1 })).toBeInTheDocument()
    const displayName = screen.getByLabelText("显示名称")
    await user.clear(displayName)
    await user.type(displayName, "新的名字")
    await user.click(screen.getAllByRole("button", { name: "保存" })[0])

    await waitFor(() => expect(useProductStore.getState().staff?.displayName).toBe("新的名字"))
  })

  it("rejects a profile edit with an invalid phone number", async () => {
    const user = userEvent.setup()
    renderView("settings")

    const phone = screen.getByLabelText("手机号")
    await user.clear(phone)
    await user.type(phone, "0000")
    await user.click(screen.getAllByRole("button", { name: "保存" })[0])

    expect(await screen.findByText("请输入有效的中国大陆手机号")).toBeInTheDocument()
  })

  it("clears the non-auth cache on request", async () => {
    const user = userEvent.setup()
    renderView("settings")

    await user.click(screen.getByRole("button", { name: /清理缓存/ }))
    expect(toast.success).toHaveBeenCalledWith("非认证缓存已清理")
  })

  it("reports an unconfigured updater instead of pretending to check", async () => {
    const user = userEvent.setup()
    mockedApi.version.mockResolvedValue({ configured: false, currentVersion: "0.1.0" })
    renderView("settings")

    await user.click(screen.getByRole("button", { name: /检查更新/ }))
    expect(await screen.findByText(/更新服务未配置/)).toBeInTheDocument()
  })

  it("signs the operator out and returns to the login route", async () => {
    const user = userEvent.setup()
    renderView("settings")

    await user.click(screen.getByRole("button", { name: /退出登录/ }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"))
    expect(useProductStore.getState().authenticated).toBe(false)
  })

  it("binds and unbinds a device", async () => {
    const user = userEvent.setup()
    renderView("settings")

    const before = useProductStore.getState().bindings.filter((item) => !item.unboundAt).length
    // The binding picker has no label of its own; it is the select whose placeholder
    // option carries the prompt.
    const bindingSelect = screen
      .getAllByRole("combobox")
      .find((select) => within(select).queryByText("绑定其他设备"))!
    await user.selectOptions(bindingSelect, "5")

    await waitFor(() =>
      expect(useProductStore.getState().bindings.filter((item) => !item.unboundAt).length).toBe(
        before + 1
      )
    )

    await user.click(screen.getAllByRole("button", { name: "解绑" })[0])

    await waitFor(() =>
      expect(useProductStore.getState().bindings.filter((item) => !item.unboundAt).length).toBe(
        before
      )
    )
  })

  it("hides the desktop window panel outside Tauri", () => {
    renderView("settings")
    expect(screen.queryByText("桌面窗口")).toBeNull()
  })

  it("offers window placement controls on the desktop", async () => {
    const user = userEvent.setup()
    mockedTauri.isTauri.mockReturnValue(true)
    renderView("settings")

    expect(await screen.findAllByText("桌面窗口")).not.toHaveLength(0)
    await user.click(screen.getByRole("button", { name: "立即保存布局" }))
    await waitFor(() => expect(mockedTauri.saveAppWindowState).toHaveBeenCalled())

    await user.click(screen.getByRole("button", { name: "恢复保存布局" }))
    await waitFor(() => expect(mockedTauri.restoreAppWindowState).toHaveBeenCalled())
  })
})
