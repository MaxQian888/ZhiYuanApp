import type { ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ProductPage } from "@/components/product/product-page"
import { useProductStore } from "@/stores/product-store"

jest.mock("@/lib/env", () => ({ ...jest.requireActual("@/lib/env"), isRemoteApi: true }))

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}))

jest.mock("@/lib/api/client", () => ({
  api: { login: jest.fn() },
  resumeSessionRecovery: jest.fn(),
  suppressSessionRecovery: jest.fn(),
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  )
  return render(<ProductPage view="dashboard" />, { wrapper })
}

describe("session recovery", () => {
  it("waits rather than showing a sign-in prompt to someone who is already signed in", () => {
    // "Not authenticated" and "we do not know yet" are different facts. Collapsing them is
    // what makes the login form flash on every reload — and operators reasonably read that
    // as having been logged out, and start typing.
    useProductStore.setState({ authenticated: false, sessionRecoveryPending: true })

    renderPage()

    expect(screen.getByText("正在恢复会话…")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "登录" })).toBeNull()
  })

  it("shows the login form once recovery has settled without a session", () => {
    useProductStore.setState({ authenticated: false, sessionRecoveryPending: false })

    renderPage()

    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument()
    expect(screen.queryByText("正在恢复会话…")).toBeNull()
  })

  it("never withholds the login route behind recovery", () => {
    // /login is where an operator goes to switch accounts. Making them wait for a recovery
    // that is about to fail would be the wrong answer to an explicit request.
    useProductStore.setState({ authenticated: false, sessionRecoveryPending: true })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <ProductPage view="login" />
        </TooltipProvider>
      </QueryClientProvider>
    )

    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument()
  })
})
