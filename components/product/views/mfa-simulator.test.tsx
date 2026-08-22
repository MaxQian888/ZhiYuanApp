import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MfaPanel } from "@/components/product/views/mfa-panel"

// No env mock here: this file exercises the default simulator mode, which is the one branch
// mfa.test.tsx cannot reach because it mocks remote mode on for the whole file.
jest.mock("@/lib/api/client", () => ({
  api: { mfaStatus: jest.fn() },
  resumeSessionRecovery: jest.fn(),
  suppressSessionRecovery: jest.fn(),
}))

describe("MfaPanel in simulator mode", () => {
  it("says why the second factor is unavailable instead of offering a dead control", () => {
    // A button that calls an endpoint which does not exist is worse than no button: the
    // operator learns nothing from the failure.
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MfaPanel />
      </QueryClientProvider>
    )

    expect(screen.getByText(/模拟器模式没有后端/)).toBeInTheDocument()
    expect(screen.queryByText("启用二次验证")).toBeNull()
  })
})
