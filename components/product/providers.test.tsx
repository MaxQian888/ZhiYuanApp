import { render, screen } from "@testing-library/react"
import { useQueryClient } from "@tanstack/react-query"
import { ProductProviders } from "@/components/product/providers"

jest.mock("@/components/product/remote-data-bridge", () => ({
  RemoteDataBridge: () => <span data-testid="bridge" />,
}))

function QueryDefaults() {
  const defaults = useQueryClient().getDefaultOptions()
  return <span data-testid="defaults">{JSON.stringify(defaults)}</span>
}

describe("ProductProviders", () => {
  it("mounts the data bridge, the toaster and the children under one query client", () => {
    render(
      <ProductProviders>
        <p>控制台</p>
      </ProductProviders>
    )
    expect(screen.getByTestId("bridge")).toBeInTheDocument()
    expect(screen.getByText("控制台")).toBeInTheDocument()
    expect(screen.getByLabelText(/Notifications/)).toBeInTheDocument()
  })

  it("configures queries so a background refetch never surprises an operator mid-task", () => {
    render(
      <ProductProviders>
        <QueryDefaults />
      </ProductProviders>
    )
    const defaults = JSON.parse(screen.getByTestId("defaults").textContent!)
    expect(defaults.queries).toMatchObject({
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
    })
    expect(defaults.mutations).toMatchObject({ retry: 0 })
  })
})
