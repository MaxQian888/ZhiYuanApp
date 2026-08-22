import type { ReactNode } from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LoginView } from "@/components/product/views/login-view"
import { MfaPanel } from "@/components/product/views/mfa-panel"
import { api, ApiError } from "@/lib/api/client"
import { useProductStore } from "@/stores/product-store"

jest.mock("@/lib/env", () => ({ ...jest.requireActual("@/lib/env"), isRemoteApi: true }))

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}))

jest.mock("@/lib/api/client", () => ({
  api: {
    login: jest.fn(),
    verifyMfa: jest.fn(),
    mfaStatus: jest.fn(),
    beginMfaEnrolment: jest.fn(),
    confirmMfaEnrolment: jest.fn(),
    regenerateRecoveryCodes: jest.fn(),
    disableMfa: jest.fn(),
  },
  ApiError: jest.requireActual("@/lib/api/client").ApiError,
  resumeSessionRecovery: jest.fn(),
  suppressSessionRecovery: jest.fn(),
}))

jest.mock("@/hooks/use-tauri-runtime", () => ({ useTauriRuntime: () => false }))

const mockedApi = api as unknown as Record<string, jest.Mock>

const staff = {
  id: 1,
  username: "admin",
  displayName: "陈屿",
  role: "admin" as const,
  phone: "13900000001",
}

function mount(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  Object.values(mockedApi).forEach((fn) => fn.mockReset())
  useProductStore.setState({ locale: "zh-CN", authenticated: false, staff: null })
})

// The view navigates on success and jsdom cannot; it reports that as a console error rather
// than throwing, so it is silenced here instead of stubbing window.location.
let notImplemented: jest.SpyInstance
beforeAll(() => {
  notImplemented = jest.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("Not implemented: navigation")) {
      console.warn(...args)
    }
  })
})
afterAll(() => notImplemented.mockRestore())

describe("LoginView · second factor", () => {
  it("asks for a code instead of signing in when one is owed", async () => {
    const user = userEvent.setup()
    mockedApi.login.mockResolvedValue({ kind: "second-factor", mfaToken: "challenge-1" })
    mount(<LoginView />)

    await user.type(screen.getByLabelText("账号"), "admin")
    await user.type(screen.getByLabelText("密码"), "correct-password")
    await user.click(screen.getByRole("button", { name: "登录" }))

    expect(await screen.findByLabelText("验证码")).toBeInTheDocument()
    // Still signed out: a password alone establishes nothing.
    expect(useProductStore.getState().authenticated).toBe(false)
    expect(screen.queryByLabelText("密码")).toBeNull()
  })

  it("completes the sign-in once the code is accepted", async () => {
    const user = userEvent.setup()
    mockedApi.login.mockResolvedValue({ kind: "second-factor", mfaToken: "challenge-1" })
    mockedApi.verifyMfa.mockResolvedValue({ kind: "signed-in", staff })
    mount(<LoginView />)

    await user.type(screen.getByLabelText("账号"), "admin")
    await user.type(screen.getByLabelText("密码"), "correct-password")
    await user.click(screen.getByRole("button", { name: "登录" }))
    await user.type(await screen.findByLabelText("验证码"), "123456")
    await user.click(screen.getByRole("button", { name: "验证" }))

    await waitFor(() => expect(useProductStore.getState().authenticated).toBe(true))
    expect(mockedApi.verifyMfa).toHaveBeenCalledWith("challenge-1", "123456")
  })

  it("keeps the operator on the code step when the code is wrong", async () => {
    const user = userEvent.setup()
    mockedApi.login.mockResolvedValue({ kind: "second-factor", mfaToken: "challenge-1" })
    mockedApi.verifyMfa.mockRejectedValue(new ApiError(401, "验证码无效"))
    mount(<LoginView />)

    await user.type(screen.getByLabelText("账号"), "admin")
    await user.type(screen.getByLabelText("密码"), "correct-password")
    await user.click(screen.getByRole("button", { name: "登录" }))
    await user.type(await screen.findByLabelText("验证码"), "000000")
    await user.click(screen.getByRole("button", { name: "验证" }))

    // The server's own words, not a generic "wrong password": at this step the password was
    // already right, and saying otherwise sends the operator back to re-type it.
    expect(await screen.findByText("验证码无效")).toBeInTheDocument()
    expect(screen.getByLabelText("验证码")).toBeInTheDocument()
  })

  it("offers a way back to the password step", async () => {
    const user = userEvent.setup()
    mockedApi.login.mockResolvedValue({ kind: "second-factor", mfaToken: "challenge-1" })
    mount(<LoginView />)

    await user.type(screen.getByLabelText("账号"), "admin")
    await user.type(screen.getByLabelText("密码"), "correct-password")
    await user.click(screen.getByRole("button", { name: "登录" }))
    await user.click(await screen.findByRole("button", { name: "返回登录" }))

    expect(screen.getByLabelText("密码")).toBeInTheDocument()
  })

  it("passes a lockout message through instead of blaming the password", async () => {
    // "Try again in 240 seconds" is actionable. "Incorrect password" costs the operator
    // another attempt out of a budget they have already spent.
    const user = userEvent.setup()
    mockedApi.login.mockRejectedValue(
      new ApiError(429, "Too many sign-in attempts. Try again in 240 seconds.")
    )
    mount(<LoginView />)

    await user.type(screen.getByLabelText("账号"), "admin")
    await user.type(screen.getByLabelText("密码"), "whatever")
    await user.click(screen.getByRole("button", { name: "登录" }))

    expect(await screen.findByText(/Try again in 240 seconds/)).toBeInTheDocument()
  })
})

describe("MfaPanel", () => {
  const off = { enabled: false, pendingEnrolment: false, remainingRecoveryCodes: 0 }
  const on = { enabled: true, pendingEnrolment: false, remainingRecoveryCodes: 7 }

  it("offers enrolment when no second factor is set", async () => {
    mockedApi.mfaStatus.mockResolvedValue(off)
    mount(<MfaPanel />)

    expect(await screen.findByText("启用二次验证")).toBeInTheDocument()
    expect(screen.queryByText("关闭二次验证")).toBeNull()
  })

  it("shows the secret in typeable groups before anything is switched on", async () => {
    const user = userEvent.setup()
    mockedApi.mfaStatus.mockResolvedValue(off)
    mockedApi.beginMfaEnrolment.mockResolvedValue({
      secret: "JBSWY3DPEHPK3PXP",
      provisioningUri: "otpauth://totp/ZhiYuan:admin?secret=JBSWY3DPEHPK3PXP",
    })
    mount(<MfaPanel />)

    await user.click(await screen.findByText("启用二次验证"))

    // Grouped, because people retype these by hand from a phone screen.
    expect(await screen.findByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "在验证器应用中打开" })).toHaveAttribute(
      "href",
      "otpauth://totp/ZhiYuan:admin?secret=JBSWY3DPEHPK3PXP"
    )
  })

  it("shows the recovery codes once, and says so", async () => {
    const user = userEvent.setup()
    mockedApi.mfaStatus.mockResolvedValue(off)
    mockedApi.beginMfaEnrolment.mockResolvedValue({
      secret: "JBSWY3DP",
      provisioningUri: "otpauth://x",
    })
    mockedApi.confirmMfaEnrolment.mockResolvedValue({
      recoveryCodes: ["AAAA-BBBB-CCCC", "DDDD-EEEE-FFFF"],
    })
    mount(<MfaPanel />)

    await user.click(await screen.findByText("启用二次验证"))
    await user.type(await screen.findByLabelText("验证码"), "123456")
    await user.click(screen.getByRole("button", { name: "确认启用" }))

    expect(await screen.findByText("AAAA-BBBB-CCCC")).toBeInTheDocument()
    expect(screen.getByText(/关闭此窗口后将无法再次查看/)).toBeInTheDocument()
  })

  it("keeps the dialog open and reports why when the code is refused", async () => {
    const user = userEvent.setup()
    mockedApi.mfaStatus.mockResolvedValue(off)
    mockedApi.beginMfaEnrolment.mockResolvedValue({
      secret: "JBSWY3DP",
      provisioningUri: "otpauth://x",
    })
    mockedApi.confirmMfaEnrolment.mockRejectedValue(new ApiError(401, "验证码无效或已过期"))
    mount(<MfaPanel />)

    await user.click(await screen.findByText("启用二次验证"))
    await user.type(await screen.findByLabelText("验证码"), "000000")
    await user.click(screen.getByRole("button", { name: "确认启用" }))

    expect(await screen.findByText("验证码无效或已过期")).toBeInTheDocument()
    expect(screen.getByLabelText("验证码")).toBeInTheDocument()
  })

  it("reports how many recovery codes are left, because that is what runs out", async () => {
    mockedApi.mfaStatus.mockResolvedValue(on)
    mount(<MfaPanel />)

    expect(await screen.findByText(/剩余 7 个恢复码/)).toBeInTheDocument()
  })

  it("requires a code to turn the factor off", async () => {
    const user = userEvent.setup()
    mockedApi.mfaStatus.mockResolvedValue(on)
    mockedApi.disableMfa.mockResolvedValue(null)
    mount(<MfaPanel />)

    await user.click(await screen.findByText("关闭二次验证"))
    await user.type(await screen.findByLabelText("验证码"), "654321")
    await user.click(screen.getByRole("button", { name: "关闭" }))

    await waitFor(() => expect(mockedApi.disableMfa).toHaveBeenCalledWith("654321"))
  })
})
