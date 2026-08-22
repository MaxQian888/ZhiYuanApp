import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"
import {
  ActionTooltip,
  ConfirmAction,
  EmptyState,
  Field,
  MetricStrip,
  PageHeader,
  PaginationControls,
  Section,
  StatusPill,
} from "@/components/product/primitives"

describe("PageHeader", () => {
  it("renders the title, description and optional actions", () => {
    const { rerender } = render(<PageHeader title="设备" description="车队总览" />)
    expect(screen.getByRole("heading", { name: "设备" })).toBeInTheDocument()
    expect(screen.getByText("车队总览")).toBeInTheDocument()
    expect(document.querySelector(".page-actions")).toBeNull()

    rerender(<PageHeader title="设备" description="车队总览" actions={<button>新增</button>} />)
    expect(screen.getByRole("button", { name: "新增" })).toBeInTheDocument()
  })
})

describe("Section", () => {
  it("renders children under a titled section and supports the dark tone", () => {
    const { container, rerender } = render(
      <Section title="遥测状态">
        <p>内容</p>
      </Section>
    )
    expect(screen.getByRole("heading", { name: "遥测状态" })).toBeInTheDocument()
    expect(container.querySelector(".flat-section")).not.toHaveClass("section-dark")

    rerender(
      <Section title="活动任务" tone="dark" action={<span>操作</span>}>
        <p>内容</p>
      </Section>
    )
    expect(container.querySelector(".section-dark")).toBeInTheDocument()
    expect(screen.getByText("操作")).toBeInTheDocument()
  })
})

describe("StatusPill", () => {
  it.each([
    ["ONLINE", "status-success"],
    ["RESOLVED", "status-success"],
    ["FLYING", "status-info"],
    ["OPEN", "status-info"],
    ["CHARGING", "status-warning"],
    ["CREATED", "status-warning"],
    ["FAILED", "status-danger"],
    ["HIGH", "status-danger"],
    ["OFFLINE", "status-neutral"],
  ])("maps %s to %s", (value, expected) => {
    const { container } = render(<StatusPill value={value} />)
    expect(container.querySelector(`.${expected}`)).toBeInTheDocument()
    expect(screen.getByText(value)).toBeInTheDocument()
  })
})

describe("MetricStrip", () => {
  it("numbers each metric and only renders a detail when one is supplied", () => {
    render(
      <MetricStrip
        items={[
          { label: "无人机总数", value: 6, detail: "5 实时" },
          { label: "在线无人机", value: 5 },
        ]}
      />
    )
    expect(screen.getByText("01")).toBeInTheDocument()
    expect(screen.getByText("02")).toBeInTheDocument()
    expect(screen.getByText("5 实时")).toBeInTheDocument()
    expect(screen.getAllByRole("definition")).toHaveLength(2)
  })
})

describe("EmptyState", () => {
  it("shows the title and only renders the action slot when given one", () => {
    const { rerender } = render(<EmptyState title="没有匹配记录" />)
    expect(screen.getByText("没有匹配记录")).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()

    rerender(<EmptyState title="没有匹配记录" action={<button>清除筛选</button>} />)
    expect(screen.getByRole("button", { name: "清除筛选" })).toBeInTheDocument()
  })
})

describe("ConfirmAction", () => {
  it("only fires the callback after the destructive confirmation", async () => {
    const user = userEvent.setup()
    const onConfirm = jest.fn()
    render(
      <ConfirmAction
        trigger={<button>删除</button>}
        title="确认删除"
        description="此操作不可撤销"
        cancelLabel="取消"
        confirmLabel="删除"
        onConfirm={onConfirm}
      />
    )

    await user.click(screen.getByRole("button", { name: "删除" }))
    expect(await screen.findByText("此操作不可撤销")).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "取消" }))
    expect(onConfirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "删除" }))
    const dialog = await screen.findByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: "删除" }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe("ActionTooltip", () => {
  it("labels its trigger on hover", async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <ActionTooltip label="发送返航指令">
          <button>返航</button>
        </ActionTooltip>
      </TooltipProvider>
    )
    await user.hover(screen.getByRole("button", { name: "返航" }))
    expect(await screen.findAllByText("发送返航指令")).not.toHaveLength(0)
  })
})

describe("PaginationControls", () => {
  it("renders nothing when there is only one page", () => {
    const { container } = render(
      <PaginationControls page={1} totalPages={1} locale="zh-CN" onPageChange={jest.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("disables the edges and reports the position", async () => {
    const user = userEvent.setup()
    const onPageChange = jest.fn()
    const { rerender } = render(
      <PaginationControls page={1} totalPages={3} locale="zh-CN" onPageChange={onPageChange} />
    )
    expect(screen.getByRole("button", { name: /上一页/ })).toBeDisabled()
    expect(screen.getByText("1 / 3")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /下一页/ }))
    expect(onPageChange).toHaveBeenCalledWith(2)

    rerender(
      <PaginationControls page={3} totalPages={3} locale="zh-CN" onPageChange={onPageChange} />
    )
    expect(screen.getByRole("button", { name: /下一页/ })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: /上一页/ }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it("locks both buttons while a page request is in flight", () => {
    render(
      <PaginationControls page={2} totalPages={3} pending locale="en" onPageChange={jest.fn()} />
    )
    expect(screen.getByRole("button", { name: /Previous/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled()
    expect(screen.getByLabelText("Pagination")).toBeInTheDocument()
  })
})

describe("Field", () => {
  it("wires the generated id to the control and flags invalid state", () => {
    const { rerender } = render(
      <Field label="用户名">
        <Input defaultValue="admin" />
      </Field>
    )
    const control = screen.getByLabelText("用户名")
    expect(control).toBeInTheDocument()
    expect(control).not.toHaveAttribute("aria-invalid", "true")

    rerender(
      <Field label="用户名" error="不能为空">
        <Input defaultValue="" />
      </Field>
    )
    expect(screen.getByText("不能为空")).toBeInTheDocument()
    expect(screen.getByLabelText("用户名")).toHaveAttribute("aria-invalid", "true")
  })

  it("keeps an explicit control id instead of generating one", () => {
    render(
      <Field label="手机号">
        <Input id="phone-field" />
      </Field>
    )
    expect(screen.getByLabelText("手机号")).toHaveAttribute("id", "phone-field")
  })

  it("passes non-element children straight through", () => {
    render(<Field label="只读">纯文本</Field>)
    expect(screen.getByText("纯文本")).toBeInTheDocument()
  })
})
