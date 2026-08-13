import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@/components/ui/tooltip"
import { closeAppWindow, minimizeAppWindow, toggleMaximizeAppWindow } from "@/lib/tauri"
import { DesktopTitlebar } from "./desktop-titlebar"

jest.mock("@/lib/tauri", () => ({
  closeAppWindow: jest.fn().mockResolvedValue(true),
  minimizeAppWindow: jest.fn().mockResolvedValue(true),
  toggleMaximizeAppWindow: jest.fn().mockResolvedValue(true),
}))

jest.mock("@/lib/i18n-product", () => ({
  useCopy: () => ({ brand: "智鸢", console: "无人机运营控制台" }),
}))

jest.mock("@/stores/product-store", () => ({
  useProductStore: (selector: (state: { locale: "zh-CN" }) => unknown) =>
    selector({ locale: "zh-CN" }),
}))

describe("DesktopTitlebar", () => {
  it("exposes a drag region and all frameless window controls", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <TooltipProvider>
        <DesktopTitlebar />
      </TooltipProvider>
    )

    expect(container.querySelector("[data-tauri-drag-region]")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "最小化窗口" }))
    await user.click(screen.getByRole("button", { name: "最大化或还原窗口" }))
    await user.click(screen.getByRole("button", { name: "关闭窗口" }))

    expect(minimizeAppWindow).toHaveBeenCalledTimes(1)
    expect(toggleMaximizeAppWindow).toHaveBeenCalledTimes(1)
    expect(closeAppWindow).toHaveBeenCalledTimes(1)
  })

  it("toggles maximize when the drag region is double-clicked", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <TooltipProvider>
        <DesktopTitlebar />
      </TooltipProvider>
    )

    await user.dblClick(container.querySelector(".desktop-titlebar-drag")!)

    expect(toggleMaximizeAppWindow).toHaveBeenCalled()
  })
})
